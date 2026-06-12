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

const SCANNER_COM_PORT = 'COM7'; 
const ESP32_COM_PORT = 'COM8';

const systemConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

const CASHIER_ACCOUNTS = {
    "maria_c": { password: "password123", name: "Cashier Maria" },
    "juan_d": { password: "secure456", name: "Cashier Juan" }
};

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

const db = new sqlite3.Database('./kiosk.db');

db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT UNIQUE,
    user_name TEXT, 
    doc_type TEXT,
    document_data TEXT, 
    status TEXT, 
    cashier_name TEXT,
    created_at INTEGER,
    completed_at INTEGER
)`);

let a4ScreenClients = [];
app.get('/api/a4-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    a4ScreenClients.push(res);
    req.on('close', () => { a4ScreenClients = a4ScreenClients.filter(c => c !== res); });
});

function sendUpdateToA4Webpage(dataObj) {
    a4ScreenClients.forEach(client => client.write(`data: ${JSON.stringify(dataObj)}\n\n`));
}

let esp32Port;
try {
    esp32Port = new SerialPort({ path: ESP32_COM_PORT, baudRate: 115200 });
    esp32Port.on('error', (err) => console.error(`ESP32 Screen Error: ${err.message}`));
} catch (e) {
    console.error(`Could not connect to ESP32`);
}

function updateEsp32Screen(message) {
    if (esp32Port && esp32Port.isOpen) esp32Port.write(`${message}\n`);
}

function getOrdinal(n) {
    let s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// --- ADVANCED PDF GENERATOR (Replicates your Classmate's Design) ---
function generateAndPrintA4(transactionRow) {
    return new Promise((resolve, reject) => {
        const filePath = `./temp_${transactionRow.transaction_id}.pdf`;
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const dataObj = JSON.parse(transactionRow.document_data);
        const docType = transactionRow.doc_type;
        
        // Date Logic
        const today = new Date();
        const dayStr = getOrdinal(today.getDate());
        const monthStr = today.toLocaleString('default', { month: 'long' });
        const yearStr = today.getFullYear().toString();

        // Standard Header (You can add doc.image('logo.png', 50, 50, {width: 50}) here later)
        doc.font('Helvetica-Bold').fontSize(14).text('REPUBLIC OF THE PHILIPPINES', { align: 'center' });
        doc.text('CITY OF PARAÑAQUE', { align: 'center' });
        doc.text('BARANGAY STO. NIÑO', { align: 'center' });
        doc.moveDown(3);
        
        doc.fontSize(18).text(docType.toUpperCase(), { align: 'center', underline: true });
        doc.moveDown(3);

        doc.font('Helvetica-Bold').fontSize(12).text('TO WHOM IT MAY CONCERN:', { align: 'left' });
        doc.moveDown(1);

        doc.font('Helvetica').fontSize(12);

        // --- SPECIFIC DOCUMENT TEMPLATES ---
        if (docType === 'Barangay Clearance') {
            doc.text('This is to certify that Mr./Ms. ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Applicant Name'] || 'N/A', { continued: true })
               .font('Helvetica').text(' of legal age, Filipino, and a resident of ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Complete Address'] || 'N/A', { continued: true })
               .font('Helvetica').text(', Barangay Sto. Niño, Parañaque City, is personally known to this office and is a bona fide resident of this barangay.', { align: 'justify' });
            
            doc.moveDown(1);
            doc.text('This further certifies that, based on the records available in this office as of this date, he/she has no pending derogatory record, complaint, or violation filed before the Barangay Sto. Niño authorities.', { align: 'justify' });
            
            doc.moveDown(1);
            doc.text('This certification is being issued upon the request of the above-named person for ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Purpose of Request'] || 'N/A', { continued: true })
               .font('Helvetica').text(' and for whatever lawful purpose it may serve.', { align: 'justify' });

        } else if (docType === 'Certificate of Indigency') {
            doc.text('This is to certify that Mr./Ms. ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Applicant Name'] || 'N/A', { continued: true })
               .font('Helvetica').text(' of legal age, Filipino, and a resident of ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Complete Address'] || 'N/A', { continued: true })
               .font('Helvetica').text(', Barangay Sto. Niño, Parañaque City, has been verified by this office and is considered an indigent resident of this barangay.', { align: 'justify' });
            
            doc.moveDown(1);
            doc.text('Based on the records and verification conducted by this office, the above-named individual belongs to a low-income family and has insufficient financial resources to adequately support his/her basic needs and/or expenses.', { align: 'justify' });
            
            doc.moveDown(1);
            doc.text('This certification is being issued upon the request of the above-named person for ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Purpose of Request'] || 'N/A', { continued: true })
               .font('Helvetica').text(' and for whatever lawful purpose it may serve.', { align: 'justify' });

        } else if (docType === 'Certificate of Residency') {
            doc.text('This is to certify that Mr./Ms. ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Applicant Name'] || 'N/A', { continued: true })
               .font('Helvetica').text(' of legal age, Filipino, and a resident of ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Complete Address'] || 'N/A', { continued: true })
               .font('Helvetica').text(', Barangay Sto. Niño, Parañaque City, is personally known to this office and is a bona fide resident of this barangay.', { align: 'justify' });
            
            doc.moveDown(1);
            doc.text('Further, this office certifies that he/she has been residing in the above-mentioned address for ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Years of Residency'] || 'N/A', { continued: true })
               .font('Helvetica').text(' as verified by the records of this barangay.', { align: 'justify' });
            
            doc.moveDown(1);
            doc.text('This certification is being issued upon the request of the above-named person for ', { continued: true })
               .font('Helvetica-Bold').text(dataObj['Purpose of Request'] || 'N/A', { continued: true })
               .font('Helvetica').text(' and for whatever lawful purpose it may serve.', { align: 'justify' });

        } else if (docType === 'Barangay Business Permit') {
            doc.text('This is to certify that the business establishment described below has applied for a Barangay Business Clearance and has complied with the requirements of this barangay:', { align: 'justify' });
            doc.moveDown(2);

            // Drawing the Business Table
            const startX = 50;
            let currentY = doc.y;
            
            doc.rect(startX, currentY, 495, 120).stroke(); // Outer Box
            doc.moveTo(startX, currentY + 30).lineTo(startX + 495, currentY + 30).stroke(); // Header Row
            doc.moveTo(startX + 180, currentY).lineTo(startX + 180, currentY + 120).stroke(); // Vertical Divider

            // Table Headers
            doc.font('Helvetica-Bold').text('Particulars', startX + 10, currentY + 10);
            doc.text('Details', startX + 190, currentY + 10);
            
            // Table Rows
            doc.font('Helvetica');
            currentY += 30;
            doc.text('Business Name', startX + 10, currentY + 7);
            doc.font('Helvetica-Bold').text(dataObj['Business Name'] || 'N/A', startX + 190, currentY + 7);
            
            currentY += 22.5;
            doc.font('Helvetica').text('Business Address', startX + 10, currentY + 7);
            doc.font('Helvetica-Bold').text(dataObj['Business Address'] || 'N/A', startX + 190, currentY + 7);
            
            currentY += 22.5;
            doc.font('Helvetica').text('Nature of Business', startX + 10, currentY + 7);
            doc.font('Helvetica-Bold').text(dataObj['Nature of Business'] || 'N/A', startX + 190, currentY + 7);
            
            currentY += 22.5;
            doc.font('Helvetica').text('Owner/Proprietor', startX + 10, currentY + 7);
            doc.font('Helvetica-Bold').text(dataObj['Owner Full Name'] || 'N/A', startX + 190, currentY + 7);

            doc.y = currentY + 40; // Move cursor below table
            doc.font('Helvetica').text('Based on the records of this office, the above-mentioned business establishment is located within the territorial jurisdiction of Barangay Sto. Niño, Parañaque City and has no known pending barangay case, complaint, or violation that would prevent the issuance of this clearance.', { align: 'justify' });
            doc.moveDown(1);
            doc.text('This Barangay Business Clearance is issued in connection with the application and/or renewal of a business permit and for whatever lawful purpose it may serve.', { align: 'justify' });
        }

        doc.moveDown(3);
        
        // Dynamic Footer Date
        doc.font('Helvetica').text('Issued this ', { continued: true })
           .font('Helvetica-Bold').text(dayStr, { continued: true })
           .font('Helvetica').text(', of ', { continued: true })
           .font('Helvetica-Bold').text(monthStr, { continued: true })
           .font('Helvetica').text(', ', { continued: true })
           .font('Helvetica-Bold').text(yearStr, { continued: true })
           .font('Helvetica').text(' at Barangay Sto. Niño, Parañaque City.');

        doc.moveDown(5);
        
        // Captain Signature Block
        doc.font('Helvetica-Bold').text('JOHNNY C. CO', { align: 'right' });
        doc.font('Helvetica').text('Punong Barangay        ', { align: 'right' });

        // Tiny hidden audit ID at bottom left
        doc.fontSize(8).fillColor('gray').text(`TXN: ${transactionRow.transaction_id}`, 50, 750);

        doc.end();

        stream.on('finish', () => {
            ptp.print(filePath, { printer: systemConfig.a4PrinterName })
                .then(() => { fs.unlinkSync(filePath); resolve(); })
                .catch(err => { reject(err); });
        });
    });
}

try {
    const scannerPort = new SerialPort({ path: SCANNER_COM_PORT, baudRate: 9600 });
    const parser = scannerPort.pipe(new ReadlineParser({ delimiter: '\r' }));
    scannerPort.on('error', (err) => console.error(`Scanner Error: ${err.message}`));

    parser.on('data', (scannedData) => {
        const cleanQR = scannedData.trim();
        const decryptedId = decrypt(cleanQR);
        if (!decryptedId) {
            updateEsp32Screen("ERROR:INVALID OR TAMPERED QR");
            return sendUpdateToA4Webpage({ success: false, message: "INVALID OR TAMPERED QR" });
        }

        db.get(`SELECT * FROM transactions WHERE transaction_id = ?`, [decryptedId], async (err, row) => {
            if (err || !row) {
                updateEsp32Screen("ERROR:Transaction not found.");
                return sendUpdateToA4Webpage({ success: false, message: "Not found." });
            }
            if (row.status === 'PENDING') {
                updateEsp32Screen("ERROR:NOT PAID YET. See Cashier.");
                return sendUpdateToA4Webpage({ success: false, message: "NOT PAID YET. See Cashier." });
            }
            if (row.status === 'COMPLETED') {
                updateEsp32Screen("ERROR:ALREADY PRINTED. See Cashier.");
                return sendUpdateToA4Webpage({ success: false, message: "ALREADY PRINTED. See Cashier for reprint." });
            }
            
            updateEsp32Screen("DONE");
            sendUpdateToA4Webpage({ success: true, dbData: row });

            const now = Date.now();
            db.run(`UPDATE transactions SET status = 'COMPLETED', completed_at = ? WHERE transaction_id = ?`, [now, decryptedId]);

            try {
                await generateAndPrintA4(row);
                setTimeout(() => { updateEsp32Screen("WAITING"); }, 5000); 
            } catch (printErr) {}
        });
    });
} catch (e) {}

app.post('/api/ai-scan', async (req, res) => {
    const payload = JSON.stringify(req.body);

    try {
        console.log(`[AI] Attempting Primary Server: ${PRIMARY_AI_URL}`);
        const response = await fetch(PRIMARY_AI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(10000) 
        });
        
        if (!response.ok) throw new Error("Primary returned error status.");
        const data = await response.json();
        return res.json(data);
        
    } catch (primaryError) {
        console.warn(`[AI] Primary failed (${primaryError.message}). Routing to Backup...`);
        
        try {
            console.log(`[AI] Attempting Backup Server: ${BACKUP_AI_URL}`);
            const backupResponse = await fetch(BACKUP_AI_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                signal: AbortSignal.timeout(10000) 
            });
            
            if (!backupResponse.ok) throw new Error("Backup returned error status.");
            const backupData = await backupResponse.json();
            return res.json(backupData);
            
        } catch (backupError) {
            console.error(`[AI] Backup also failed (${backupError.message}). Out of nodes.`);
            res.json({ success: false, message: "Both Primary and Backup AI Servers are unreachable." });
        }
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const account = CASHIER_ACCOUNTS[username];
    if (account && account.password === password) res.json({ success: true, name: account.name });
    else res.json({ success: false, message: "Invalid username or password." });
});

app.post('/api/submit', (req, res) => {
    const { docType, formData } = req.body;
    const now = Date.now();
    const transactionId = `DOC-${now.toString().slice(-6)}-${uuidv4().split('-')[0].toUpperCase()}`;
    const jsonData = JSON.stringify(formData);
    const userName = formData['Applicant Name'] || formData['Full Name'] || formData['Business Owner Name'] || formData['Owner Full Name'] || Object.values(formData)[0] || 'Unknown';

    db.run(`INSERT INTO transactions (transaction_id, user_name, doc_type, document_data, status, created_at) 
            VALUES (?, ?, ?, ?, 'PENDING', ?)`, 
        [transactionId, userName, docType, jsonData, now], function(err) {
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
    if (!cashierName) return res.json({ success: false, message: "Unauthorized. Please log in again." });

    if (action === 'AUTHORIZE') {
        db.run(`UPDATE transactions SET status = 'READY_TO_PRINT', cashier_name = ? WHERE transaction_id = ? AND status = 'PENDING'`, 
        [cashierName, transactionId], () => { res.json({ success: true, message: "Payment Authorized. Ready for A4 Print." }); });
    } else if (action === 'DENY') {
        db.run(`DELETE FROM transactions WHERE transaction_id = ? AND status = 'PENDING'`, [transactionId], () => { res.json({ success: true, message: "Transaction Denied and Deleted." }); });
    } else if (action === 'REPRINT') {
        db.run(`UPDATE transactions SET status = 'READY_TO_PRINT', cashier_name = ? WHERE transaction_id = ? AND status = 'COMPLETED'`, 
        [`${cashierName} (Reprint Auth)`, transactionId], () => { res.json({ success: true, message: "Reprint Authorized for the next 24 hours." }); });
    }
});

app.post('/api/cashier-history', (req, res) => {
    const { cashierName, dateStr } = req.body; 
    if (!cashierName || !dateStr) return res.json({success: false, message: "Missing required data."});

    const startOfDay = new Date(`${dateStr}T00:00:00`).getTime();
    const endOfDay = new Date(`${dateStr}T23:59:59.999`).getTime();

    db.all(
        `SELECT transaction_id, user_name, doc_type, status, created_at 
         FROM transactions 
         WHERE cashier_name LIKE ? AND created_at >= ? AND created_at <= ? 
         ORDER BY created_at DESC`,
        [`${cashierName}%`, startOfDay, endOfDay],
        (err, rows) => {
            if (err) return res.json({ success: false, message: err.message });
            res.json({ success: true, history: rows });
        }
    );
});

setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000); 
    db.run(`UPDATE transactions SET document_data = NULL WHERE status = 'COMPLETED' AND completed_at <= ? AND document_data IS NOT NULL`, 
    [oneHourAgo], function(err) { if (this.changes > 0) console.log(`[PRIVACY] Wiped sensitive data for ${this.changes} completed transactions.`); });
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    db.run(`DELETE FROM transactions WHERE status = 'PENDING' AND created_at <= ?`, [oneDayAgo]);
}, 60000); 

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=========================================`);
    console.log(`🚀 KIOSK SERVER IS LIVE ON THE NETWORK`);
    console.log(`Port: ${PORT}`);
    console.log(`Primary AI: ${PRIMARY_AI_URL}`);
    console.log(`Backup AI:  ${BACKUP_AI_URL}`);
    console.log(`=========================================\n`);
});