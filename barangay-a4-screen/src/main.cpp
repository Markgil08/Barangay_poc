const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs'); 
const QRCode = require('qrcode'); 
const ThermalPrinter = require("node-thermal-printer").printer;
const PrinterTypes = require("node-thermal-printer").types;
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const PDFDocument = require('pdfkit');
const ptp = require('pdf-to-printer');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- HIGH AVAILABILITY AI FAILOVER ---
const PRIMARY_AI_URL = 'http://100.66.185.78:5000/api/process-id'; 
const BACKUP_AI_URL = 'http://100.95.149.40:5000/api/process-id'; 

const systemConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

const ENCRYPTION_KEY = crypto.createHash('sha256').update('barangay-secret-key-2026').digest();
const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted; 
}

function decrypt(encryptedText) {
    try {
        const textParts = encryptedText.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedData = textParts.join(':');
        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        return null; 
    }
}

// --- DATABASE ARCHITECTURE & AUTO-MIGRATION ---
const db = new sqlite3.Database('./kiosk.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT UNIQUE,
        user_name TEXT, 
        doc_type TEXT,
        document_data TEXT, 
        status TEXT, 
        cashier_name TEXT,
        created_at INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT,
        name TEXT,
        role TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT
    )`);

    db.all("PRAGMA table_info(transactions)", (err, rows) => {
        if (!err && rows) {
            const hasKioskStartTime = rows.some(r => r.name === 'kiosk_start_time');
            const hasCompletedAt = rows.some(r => r.name === 'completed_at');
            
            if (!hasKioskStartTime) db.run("ALTER TABLE transactions ADD COLUMN kiosk_start_time INTEGER");
            if (!hasCompletedAt) db.run("ALTER TABLE transactions ADD COLUMN completed_at INTEGER");
        }
    });

    db.run(`INSERT OR IGNORE INTO users (username, password, name, role) VALUES ('admin', 'admin123', 'System Administrator', 'admin')`);
    db.run(`INSERT OR IGNORE INTO users (username, password, name, role) VALUES ('maria_c', 'password123', 'Cashier Maria', 'cashier')`);

    db.run(`INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES ('SCANNER_COM_PORT', 'COM7')`);
    db.run(`INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES ('ESP32_COM_PORT', 'COM8')`);
});

// --- HOT-SWAPPABLE HARDWARE MANAGEMENT ---
let esp32Port = null;
let scannerPort = null;
let a4ScreenClients = [];

function reconnectHardware() {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        if (err) return;
        let config = {};
        rows.forEach(r => config[r.setting_key] = r.setting_value);

        if (esp32Port && esp32Port.isOpen) esp32Port.close();
        if (scannerPort && scannerPort.isOpen) scannerPort.close();

        try {
            esp32Port = new SerialPort({ path: config.ESP32_COM_PORT, baudRate: 115200 });
            esp32Port.on('error', (err) => console.error(`[ESP32] Port Error: ${err.message}`));
            console.log(`[HARDWARE] ESP32 mapped to ${config.ESP32_COM_PORT}`);
        } catch (e) { console.error(`[HARDWARE] Failed to connect ESP32 to ${config.ESP32_COM_PORT}`); }

        try {
            scannerPort = new SerialPort({ path: config.SCANNER_COM_PORT, baudRate: 9600 });
            const parser = scannerPort.pipe(new ReadlineParser({ delimiter: '\r' }));
            scannerPort.on('error', (err) => console.error(`[SCANNER] Port Error: ${err.message}`));
            console.log(`[HARDWARE] Scanner mapped to ${config.SCANNER_COM_PORT}`);

            parser.on('data', (scannedData) => {
                const cleanQR = scannedData.trim();
                const decryptedId = decrypt(cleanQR);
                
                if (!decryptedId) {
                    updateEsp32Screen("ERROR:INVALID QR CODE");
                    return sendUpdateToA4Webpage({ success: false, message: "INVALID OR TAMPERED QR" });
                }

                db.get(`SELECT * FROM transactions WHERE transaction_id = ?`, [decryptedId], async (err, row) => {
                    
                    // --- FIX 2: Added screen updates for all error states ---
                    if (err || !row) {
                        updateEsp32Screen("ERROR:NOT FOUND");
                        return sendUpdateToA4Webpage({ success: false, message: "Not found." });
                    }
                    if (row.status === 'PENDING') {
                        updateEsp32Screen("ERROR:NOT PAID YET");
                        return sendUpdateToA4Webpage({ success: false, message: "NOT PAID YET. See Cashier." });
                    }
                    if (row.status === 'COMPLETED') {
                        updateEsp32Screen("ERROR:ALREADY PRINTED");
                        return sendUpdateToA4Webpage({ success: false, message: "ALREADY PRINTED. See Cashier for reprint." });
                    }
                    
                    // If everything is correct:
                    updateEsp32Screen("DONE");
                    sendUpdateToA4Webpage({ success: true, dbData: row });

                    const now = Date.now();
                    db.run(`UPDATE transactions SET status = 'COMPLETED', completed_at = ? WHERE transaction_id = ?`, [now, decryptedId]);

                    try {
                        await generateAndPrintA4(row);
                        
                        // --- FIX 1: Extended printer wait time to 15 seconds (15000ms) ---
                        setTimeout(() => { updateEsp32Screen("WAITING"); }, 15000); 
                    } catch (printErr) {}
                });
            });
        } catch (e) { console.error(`[HARDWARE] Failed to connect Scanner to ${config.SCANNER_COM_PORT}`); }
    });
}

setTimeout(reconnectHardware, 2000);

function updateEsp32Screen(message) {
    if (esp32Port && esp32Port.isOpen) esp32Port.write(`${message}\n`);
}

function sendUpdateToA4Webpage(dataObj) {
    a4ScreenClients.forEach(client => client.write(`data: ${JSON.stringify(dataObj)}\n\n`));
}

app.get('/api/a4-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    a4ScreenClients.push(res);
    req.on('close', () => { a4ScreenClients = a4ScreenClients.filter(c => c !== res); });
});

function getOrdinal(n) {
    let s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function generateAndPrintA4(transactionRow) {
    return new Promise((resolve, reject) => {
        const filePath = `./temp_${transactionRow.transaction_id}.pdf`;
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const dataObj = JSON.parse(transactionRow.document_data);
        const docType = transactionRow.doc_type;
        const today = new Date();
        const dayStr = getOrdinal(today.getDate());
        const monthStr = today.toLocaleString('default', { month: 'long' });
        const yearStr = today.getFullYear().toString();

        doc.font('Helvetica-Bold').fontSize(14).text('REPUBLIC OF THE PHILIPPINES', { align: 'center' });
        doc.text('CITY OF PARAÑAQUE', { align: 'center' });
        doc.text('BARANGAY STO. NIÑO', { align: 'center' });
        doc.moveDown(3);
        doc.fontSize(18).text(docType.toUpperCase(), { align: 'center', underline: true });
        doc.moveDown(3);
        doc.font('Helvetica-Bold').fontSize(12).text('TO WHOM IT MAY CONCERN:', { align: 'left' });
        doc.moveDown(1);
        doc.font('Helvetica').fontSize(12);

        if (docType === 'Barangay Clearance') {
            doc.text('This is to certify that Mr./Ms. ', { continued: true }).font('Helvetica-Bold').text(dataObj['Applicant Name'] || 'N/A', { continued: true }).font('Helvetica').text(' of legal age, Filipino, and a resident of ', { continued: true }).font('Helvetica-Bold').text(dataObj['Complete Address'] || 'N/A', { continued: true }).font('Helvetica').text(', Barangay Sto. Niño, Parañaque City, is personally known to this office and is a bona fide resident of this barangay.', { align: 'justify' });
            doc.moveDown(1);
            doc.text('This further certifies that, based on the records available in this office as of this date, he/she has no pending derogatory record, complaint, or violation filed before the Barangay Sto. Niño authorities.', { align: 'justify' });
            doc.moveDown(1);
            doc.text('This certification is being issued upon the request of the above-named person for ', { continued: true }).font('Helvetica-Bold').text(dataObj['Purpose of Request'] || 'N/A', { continued: true }).font('Helvetica').text(' and for whatever lawful purpose it may serve.', { align: 'justify' });
        } else if (docType === 'Certificate of Indigency') {
            doc.text('This is to certify that Mr./Ms. ', { continued: true }).font('Helvetica-Bold').text(dataObj['Applicant Name'] || 'N/A', { continued: true }).font('Helvetica').text(' of legal age, Filipino, and a resident of ', { continued: true }).font('Helvetica-Bold').text(dataObj['Complete Address'] || 'N/A', { continued: true }).font('Helvetica').text(', Barangay Sto. Niño, Parañaque City, has been verified by this office and is considered an indigent resident of this barangay.', { align: 'justify' });
            doc.moveDown(1);
            doc.text('Based on the records and verification conducted by this office, the above-named individual belongs to a low-income family and has insufficient financial resources to adequately support his/her basic needs and/or expenses.', { align: 'justify' });
            doc.moveDown(1);
            doc.text('This certification is being issued upon the request of the above-named person for ', { continued: true }).font('Helvetica-Bold').text(dataObj['Purpose of Request'] || 'N/A', { continued: true }).font('Helvetica').text(' and for whatever lawful purpose it may serve.', { align: 'justify' });
        } else if (docType === 'Certificate of Residency') {
            doc.text('This is to certify that Mr./Ms. ', { continued: true }).font('Helvetica-Bold').text(dataObj['Applicant Name'] || 'N/A', { continued: true }).font('Helvetica').text(' of legal age, Filipino, and a resident of ', { continued: true }).font('Helvetica-Bold').text(dataObj['Complete Address'] || 'N/A', { continued: true }).font('Helvetica').text(', Barangay Sto. Niño, Parañaque City, is personally known to this office and is a bona fide resident of this barangay.', { align: 'justify' });
            doc.moveDown(1);
            doc.text('Further, this office certifies that he/she has been residing in the above-mentioned address for ', { continued: true }).font('Helvetica-Bold').text(dataObj['Years of Residency'] || 'N/A', { continued: true }).font('Helvetica').text(' as verified by the records of this barangay.', { align: 'justify' });
            doc.moveDown(1);
            doc.text('This certification is being issued upon the request of the above-named person for ', { continued: true }).font('Helvetica-Bold').text(dataObj['Purpose of Request'] || 'N/A', { continued: true }).font('Helvetica').text(' and for whatever lawful purpose it may serve.', { align: 'justify' });
        } else if (docType === 'Barangay Business Permit') {
            doc.text('This is to certify that the business establishment described below has applied for a Barangay Business Clearance and has complied with the requirements of this barangay:', { align: 'justify' });
            doc.moveDown(2);
            const startX = 50; let currentY = doc.y;
            doc.rect(startX, currentY, 495, 120).stroke(); 
            doc.moveTo(startX, currentY + 30).lineTo(startX + 495, currentY + 30).stroke(); 
            doc.moveTo(startX + 180, currentY).lineTo(startX + 180, currentY + 120).stroke(); 
            doc.font('Helvetica-Bold').text('Particulars', startX + 10, currentY + 10);
            doc.text('Details', startX + 190, currentY + 10);
            doc.font('Helvetica');
            currentY += 30; doc.text('Business Name', startX + 10, currentY + 7); doc.font('Helvetica-Bold').text(dataObj['Business Name'] || 'N/A', startX + 190, currentY + 7);
            currentY += 22.5; doc.font('Helvetica').text('Business Address', startX + 10, currentY + 7); doc.font('Helvetica-Bold').text(dataObj['Business Address'] || 'N/A', startX + 190, currentY + 7);
            currentY += 22.5; doc.font('Helvetica').text('Nature of Business', startX + 10, currentY + 7); doc.font('Helvetica-Bold').text(dataObj['Nature of Business'] || 'N/A', startX + 190, currentY + 7);
            currentY += 22.5; doc.font('Helvetica').text('Owner/Proprietor', startX + 10, currentY + 7); doc.font('Helvetica-Bold').text(dataObj['Owner Full Name'] || 'N/A', startX + 190, currentY + 7);
            doc.y = currentY + 40; 
            doc.font('Helvetica').text('Based on the records of this office, the above-mentioned business establishment is located within the territorial jurisdiction of Barangay Sto. Niño, Parañaque City and has no known pending barangay case, complaint, or violation that would prevent the issuance of this clearance.', { align: 'justify' });
            doc.moveDown(1);
            doc.text('This Barangay Business Clearance is issued in connection with the application and/or renewal of a business permit and for whatever lawful purpose it may serve.', { align: 'justify' });
        }

        doc.moveDown(3);
        doc.font('Helvetica').text('Issued this ', { continued: true }).font('Helvetica-Bold').text(dayStr, { continued: true }).font('Helvetica').text(', of ', { continued: true }).font('Helvetica-Bold').text(monthStr, { continued: true }).font('Helvetica').text(', ', { continued: true }).font('Helvetica-Bold').text(yearStr, { continued: true }).font('Helvetica').text(' at Barangay Sto. Niño, Parañaque City.');
        doc.moveDown(5);
        doc.font('Helvetica-Bold').text('JOHNNY C. CO', { align: 'right' });
        doc.font('Helvetica').text('Punong Barangay        ', { align: 'right' });
        doc.fontSize(8).fillColor('gray').text(`TXN: ${transactionRow.transaction_id}`, 50, 750);
        doc.end();

        stream.on('finish', () => {
            ptp.print(filePath, { printer: systemConfig.a4PrinterName }).then(() => { fs.unlinkSync(filePath); resolve(); }).catch(err => { reject(err); });
        });
    });
}

// --- STANDARD KIOSK APIS ---
app.post('/api/ai-scan', async (req, res) => {
    const payload = JSON.stringify(req.body);
    try {
        const response = await fetch(PRIMARY_AI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("Primary returned error status.");
        return res.json(await response.json());
    } catch (primaryError) {
        try {
            const backupResponse = await fetch(BACKUP_AI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: AbortSignal.timeout(10000) });
            if (!backupResponse.ok) throw new Error("Backup returned error status.");
            return res.json(await backupResponse.json());
        } catch (backupError) {
            res.json({ success: false, message: "Both Primary and Backup AI Servers are unreachable." });
        }
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
        if (err || !row) return res.json({ success: false, message: "Invalid credentials." });
        res.json({ success: true, name: row.name, role: row.role });
    });
});

app.post('/api/submit', (req, res) => {
    const { docType, formData, kioskStartTime } = req.body;
    const now = Date.now();
    const transactionId = `DOC-${now.toString().slice(-6)}-${uuidv4().split('-')[0].toUpperCase()}`;
    const jsonData = JSON.stringify(formData);
    const userName = formData['Applicant Name'] || formData['Full Name'] || formData['Business Owner Name'] || formData['Owner Full Name'] || Object.values(formData)[0] || 'Unknown';
    const startTime = kioskStartTime || now;

    db.run(`INSERT INTO transactions (transaction_id, user_name, doc_type, document_data, status, kiosk_start_time, created_at) 
            VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`, 
        [transactionId, userName, docType, jsonData, startTime, now], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, transactionId, docType, encryptedQR: encrypt(transactionId) });
    });
});

app.post('/api/print-receipt', async (req, res) => {
    const { docType, totalAmount, encryptedQR } = req.body;
    try {
        let printer = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: 'dummy', characterSet: 'PC852_LATIN2' });
        printer.alignCenter(); printer.bold(true); printer.println("BARANGAY SANTO NINO"); printer.bold(false);
        printer.println("Document Request Slip"); printer.drawLine(); printer.alignLeft();
        printer.println(`Type: ${docType}`); printer.println(`Fee: P${totalAmount}`); printer.drawLine();
        printer.alignCenter(); printer.println("Please present this QR"); printer.println("code to the cashier."); printer.newLine();
        printer.printQR(encryptedQR, { cellSize: 6 }); printer.newLine(); printer.cut();
        fs.writeFileSync('\\\\localhost\\POS-58', printer.getBuffer());
        res.json({ success: true, printerFailed: false });
    } catch (error) {
        try {
            const qrImageBase64 = await QRCode.toDataURL(encryptedQR);
            res.json({ success: true, printerFailed: true, qrImage: qrImageBase64, rawText: encryptedQR });
        } catch (qrErr) {
            res.json({ success: true, printerFailed: true, rawText: encryptedQR });
        }
    }
});

app.post('/api/cashier-scan', (req, res) => {
    const { scannedQR } = req.body;
    const decryptedId = decrypt(scannedQR);
    if (!decryptedId) return res.json({ success: false, message: "INVALID OR TAMPERED QR CODE" });
    db.get(`SELECT * FROM transactions WHERE transaction_id = ?`, [decryptedId], (err, row) => {
        if (err || !row) return res.json({ success: false, message: "Transaction not found." });
        if (!row.document_data) return res.json({ success: false, message: "Data wiped for privacy. Must re-apply." });
        res.json({ success: true, dbData: row });
    });
});

app.post('/api/cashier-action', (req, res) => {
    const { transactionId, action, cashierName } = req.body;
    if (!cashierName) return res.json({ success: false, message: "Unauthorized." });
    if (action === 'AUTHORIZE') {
        db.run(`UPDATE transactions SET status = 'READY_TO_PRINT', cashier_name = ? WHERE transaction_id = ? AND status = 'PENDING'`, 
        [cashierName, transactionId], () => { res.json({ success: true, message: "Payment Authorized." }); });
    } else if (action === 'DENY') {
        db.run(`DELETE FROM transactions WHERE transaction_id = ? AND status = 'PENDING'`, [transactionId], () => { res.json({ success: true, message: "Transaction Denied." }); });
    } else if (action === 'REPRINT') {
        db.run(`UPDATE transactions SET status = 'READY_TO_PRINT', cashier_name = ? WHERE transaction_id = ? AND status = 'COMPLETED'`, 
        [`${cashierName} (Reprint Auth)`, transactionId], () => { res.json({ success: true, message: "Reprint Authorized." }); });
    }
});

app.post('/api/cashier-history', (req, res) => {
    const { cashierName, dateStr } = req.body; 
    const startOfDay = new Date(`${dateStr}T00:00:00`).getTime();
    const endOfDay = new Date(`${dateStr}T23:59:59.999`).getTime();
    db.all(`SELECT transaction_id, user_name, doc_type, status, created_at FROM transactions WHERE cashier_name LIKE ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC`,
        [`${cashierName}%`, startOfDay, endOfDay], (err, rows) => {
            res.json({ success: !err, history: rows || [] });
        });
});

// --- ADMIN APIS ---
app.get('/api/admin/logs', (req, res) => {
    db.all(`SELECT transaction_id, user_name, doc_type, status, cashier_name, kiosk_start_time, created_at, completed_at FROM transactions ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.json({ success: false, message: err.message });
        res.json({ success: true, logs: rows });
    });
});

app.get('/api/admin/cashiers', (req, res) => {
    db.all(`SELECT username, name, role FROM users WHERE role = 'cashier'`, [], (err, rows) => {
        res.json({ success: !err, cashiers: rows || [] });
    });
});

app.post('/api/admin/cashiers', (req, res) => {
    const { username, password, name } = req.body;
    db.run(`INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, 'cashier')`, [username, password, name], function(err) {
        if (err) return res.json({ success: false, message: "Username already exists." });
        res.json({ success: true, message: "Cashier added." });
    });
});

app.delete('/api/admin/cashiers/:username', (req, res) => {
    db.run(`DELETE FROM users WHERE username = ? AND role = 'cashier'`, [req.params.username], () => {
        res.json({ success: true });
    });
});

app.get('/api/admin/settings', (req, res) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        let config = {};
        rows.forEach(r => config[r.setting_key] = r.setting_value);
        res.json({ success: true, settings: config });
    });
});

app.post('/api/admin/settings', (req, res) => {
    const { esp32, scanner } = req.body;
    db.run(`UPDATE settings SET setting_value = ? WHERE setting_key = 'ESP32_COM_PORT'`, [esp32]);
    db.run(`UPDATE settings SET setting_value = ? WHERE setting_key = 'SCANNER_COM_PORT'`, [scanner], () => {
        reconnectHardware();
        res.json({ success: true, message: "Ports updated and hardware restarted." });
    });
});

setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000); 
    db.run(`UPDATE transactions SET document_data = NULL WHERE status = 'COMPLETED' AND completed_at <= ? AND document_data IS NOT NULL`, [oneHourAgo]);
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    db.run(`DELETE FROM transactions WHERE status = 'PENDING' AND created_at <= ?`, [oneDayAgo]);
}, 60000); 

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=========================================`);
    console.log(`🚀 KIOSK SYSTEM & ADMIN PANEL ONLINE`);
    console.log(`Port: ${PORT}`);
    console.log(`=========================================\n`);
});