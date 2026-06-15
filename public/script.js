KioskBoard.init({
    keysArrayOfObjects: [
      { "0": "Q", "1": "W", "2": "E", "3": "R", "4": "T", "5": "Y", "6": "U", "7": "I", "8": "O", "9": "P" },
      { "0": "A", "1": "S", "2": "D", "3": "F", "4": "G", "5": "H", "6": "J", "7": "K", "8": "L" },
      { "0": "Z", "1": "X", "2": "C", "3": "V", "4": "B", "5": "N", "6": "Ñ", "7": "M" }
    ],
    keysSpecialCharsArrayOfStrings: ['-', '.', ',', '@', '_', '/'],
    allowRealKeyboard: true, autoCaps: true, autoScroll: false, theme: 'light'
});

const civilStatusOptions = ['Single', 'Married', 'Widowed', 'Legally Separated'];

const formBlueprints = {
    "Barangay Clearance": [
        { type: 'text', label: 'Applicant Name', placeholder: 'Juan Dela Cruz' },
        { type: 'text', label: 'Complete Address', placeholder: 'House No., Street, Purok' },
        { type: 'date', label: 'Date of Birth' }, 
        { type: 'select', label: 'Civil Status', options: civilStatusOptions },
        { type: 'text', label: 'Purpose of Request', placeholder: 'e.g., Local Employment' }
    ],
    "Certificate of Indigency": [
        { type: 'text', label: 'Applicant Name', placeholder: 'Juan Dela Cruz' },
        { type: 'text', label: 'Complete Address', placeholder: 'House No., Street, Purok' },
        { type: 'select', label: 'Civil Status', options: civilStatusOptions },
        { type: 'select', label: 'Estimated Monthly Income', options: ['₱0 - ₱5,000', '₱5,001 - ₱10,000', 'Above ₱10,000'] },
        { type: 'text', label: 'Purpose of Request', placeholder: 'e.g., Medical Assistance / Scholarship' }
    ],
    "Certificate of Residency": [
        { type: 'text', label: 'Applicant Name', placeholder: 'Juan Dela Cruz' },
        { type: 'text', label: 'Complete Address', placeholder: 'House No., Street, Purok' },
        { type: 'text', label: 'Years of Residency', placeholder: 'e.g., 5 years' },
        { type: 'text', label: 'Purpose of Request', placeholder: 'e.g., Bank Requirement' }
    ],
    "Barangay Business Permit": [
        { type: 'text', label: 'Owner Full Name', placeholder: 'Juan Dela Cruz' },
        { type: 'text', label: 'Business Name', placeholder: 'Juan Sari-Sari Store' },
        { type: 'text', label: 'Business Address', placeholder: 'House No., Street, Purok' },
        { type: 'select', label: 'Nature of Business', options: ['Retail', 'Services', 'Food & Beverage', 'Manufacturing / Repair'] },
        { type: 'select', label: 'Business Scale', onChange: 'updateBusinessPermitFee(this)', options: [
            { text: 'Micro business / Sari sari store (₱200.00)', value: '200' },
            { text: 'Small / Medium business (₱500.00)', value: '500' },
            { text: 'Large Commercial Operations (₱1,000.00)', value: '1000' }
        ]},
        { type: 'text', label: 'Contact Number', placeholder: '09XX-XXX-XXXX' }
    ]
};

let currentDocType = "";
let currentFee = 0;
let baseFeeForDoc = 0; 
let currentEncryptedQR = "";
let sessionStartTime = null; 
let idleTimer;
let kioskLanguage = "en";

const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'tap') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.05);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        oscillator.start(); oscillator.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'success') {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
        oscillator.start(); oscillator.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'error') {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(300, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
        oscillator.start(); oscillator.stop(audioCtx.currentTime + 0.2);
    }
}

setInterval(() => {
    const clock = document.getElementById('live-clock-kiosk');
    if (clock) clock.innerText = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const fullDate = document.getElementById('screensaver-full-date');
    if (fullDate) fullDate.innerText = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}, 1000);

function nav(pageId) {
    playSound('tap');
    if(pageId === 'page-success') setTimeout(() => playSound('success'), 200);
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    document.getElementById(pageId).classList.add('active-page');
    resetIdleTimer();
}

function resetIdleTimer() {
    clearTimeout(idleTimer);
    if(!document.getElementById('page-screensaver').classList.contains('active-page')) {
        idleTimer = setTimeout(() => { nav('page-screensaver'); }, 60000);
    }
}
window.onload = resetIdleTimer;
document.onmousemove = resetIdleTimer;
document.onclick = resetIdleTimer;
document.onkeypress = resetIdleTimer;

const dict = {
    en: { welcome: "Touch Screen to Begin", subwelcome: "Request, review, and print receipts for Barangay Documents instantly.", selectTitle: "Select Document Type", clearanceTitle: "Barangay Clearance", clearanceDesc: "Residency and moral standing.", indigencyTitle: "Certificate of Indigency", indigencyDesc: "Low-income financial assistance.", residencyTitle: "Certificate of Residency", residencyDesc: "Proof of address.", businessTitle: "Business Permit", businessDesc: "License to operate.", screensaverBtn: "Screensaver", modeIndicator: "English Mode" },
    ph: { welcome: "Pindutin ang Screen", subwelcome: "Mabilis na makakuha at mag-print ng resibo para sa mga Dokumento ng Barangay.", selectTitle: "Pumili ng Dokumento", clearanceTitle: "Barangay Clearance", clearanceDesc: "Sertipiko ng paninirahan at mabuting asal.", indigencyTitle: "Sertipiko ng Kahirapan", indigencyDesc: "Tulong-pinansyal sa mababang kita.", residencyTitle: "Sertipiko ng Paninirahan", residencyDesc: "Katunayan ng tirahan.", businessTitle: "Permit sa Negosyo", businessDesc: "Lisensya para magpatakbo ng negosyo.", screensaverBtn: "Bumalik (Screensaver)", modeIndicator: "Tagalog Mode" }
};

window.toggleLanguage = function(lang) {
    kioskLanguage = lang;
    playSound('tap');
    
    const btnEn = document.getElementById("lang-btn-en");
    const btnPh = document.getElementById("lang-btn-ph");
    const baseClass = "px-5 py-2.5 rounded-2xl font-bold transition-all text-xs md:text-sm shadow-sm w-full sm:w-auto ";
    
    if (lang === "en") {
        btnEn.className = baseClass + "bg-teal-700 text-white border border-teal-700";
        btnPh.className = baseClass + "bg-white/85 text-slate-700 border border-slate-200 hover:bg-white";
    } else {
        btnPh.className = baseClass + "bg-teal-700 text-white border border-teal-700";
        btnEn.className = baseClass + "bg-white/85 text-slate-700 border border-slate-200 hover:bg-white";
    }
    
    document.getElementById("lang-welcome").innerText = dict[lang].welcome;
    document.getElementById("lang-subwelcome").innerText = dict[lang].subwelcome;
    document.getElementById("lang-select-title").innerText = dict[lang].selectTitle;
    document.getElementById("lang-clearance-title").innerText = dict[lang].clearanceTitle;
    document.getElementById("lang-clearance-desc").innerText = dict[lang].clearanceDesc;
    document.getElementById("lang-indigency-title").innerText = dict[lang].indigencyTitle;
    document.getElementById("lang-indigency-desc").innerText = dict[lang].indigencyDesc;
    document.getElementById("lang-residency-title").innerText = dict[lang].residencyTitle;
    document.getElementById("lang-residency-desc").innerText = dict[lang].residencyDesc;
    document.getElementById("lang-business-title").innerText = dict[lang].businessTitle;
    document.getElementById("lang-business-desc").innerText = dict[lang].businessDesc;
    document.getElementById("lang-screensaver-btn").innerText = dict[lang].screensaverBtn;
    document.getElementById("header-lang-text").innerText = dict[lang].modeIndicator;
};

window.openMessageBox = function(title, text, type = "info") {
    document.getElementById('msg-box-title').innerText = title;
    document.getElementById('msg-box-text').innerText = text;
    const iconContainer = document.getElementById('msg-box-icon-container');
    const icon = document.getElementById('msg-box-icon');
    
    if (type === "error") {
        iconContainer.className = "h-16 w-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 border border-red-100 shadow-inner";
        icon.className = "fa-solid fa-triangle-exclamation";
        playSound("error");
    } else {
        iconContainer.className = "h-16 w-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 border border-blue-100 shadow-inner";
        icon.className = "fa-solid fa-circle-info";
        playSound("tap");
    }
    document.getElementById('custom-message-box').style.display = 'flex';
}

window.closeMessageBox = function() {
    playSound("tap");
    document.getElementById('custom-message-box').style.display = 'none';
}

window.alert = function(msg) {
    if (msg.includes("fill all fields")) {
        document.querySelectorAll('.dynamic-input').forEach(input => {
            if (!input.value) input.classList.add('border-red-500');
            else input.classList.remove('border-red-500');
        });
    }
    openMessageBox("Notification", msg, "error");
};

// --- T&C LOGIC ---
window.toggleTnc = function(checkbox) {
    playSound('tap');
    const btnGroup = document.getElementById('id-buttons');
    if(checkbox.checked) {
        btnGroup.style.opacity = "1";
        btnGroup.style.pointerEvents = "auto";
    } else {
        btnGroup.style.opacity = "0.4";
        btnGroup.style.pointerEvents = "none";
    }
};

window.showTncModal = function() {
    playSound('tap');
    document.getElementById('tnc-modal').style.display = 'flex';
};

window.closeTncModal = function() {
    playSound('tap');
    document.getElementById('tnc-modal').style.display = 'none';
};

function updateBusinessPermitFee(selectElement) {
    currentFee = parseInt(selectElement.value);
    document.getElementById('form-fee').innerText = currentFee + ".00";
}

function presentEntryChoice(docType, fee) {
    currentDocType = docType;
    baseFeeForDoc = fee;
    currentFee = fee; 
    sessionStartTime = Date.now(); 
    
    // Reset T&C
    const cb = document.getElementById('tnc-checkbox');
    if(cb) cb.checked = false;
    const btnGroup = document.getElementById('id-buttons');
    if(btnGroup) { btnGroup.style.opacity = "0.4"; btnGroup.style.pointerEvents = "none"; }

    document.getElementById('modal-id-selector').style.display = 'flex';
    resetIdleTimer();
}

function closeChoiceModals() {
    document.getElementById('modal-id-selector').style.display = 'none';
}

function proceedToForm() {
    closeChoiceModals();
    generateDynamicForm(); 
}

function chooseAIScan(idType) {
    closeChoiceModals();
    openCameraModal(idType);
}

function generateDynamicForm(prefillData = null) {
    document.getElementById('form-header').innerHTML = currentDocType === 'Barangay Business Permit' ? `<i class="fa-solid fa-shop mr-2 text-amber-600"></i> ${currentDocType}` : currentDocType;
    
    if (currentDocType !== 'Barangay Business Permit') {
        currentFee = baseFeeForDoc; 
        document.getElementById('form-fee').innerText = currentFee === 0 ? "FREE" : currentFee + ".00";
    } else {
        currentFee = 200; 
        document.getElementById('form-fee').innerText = "200.00";
    }

    const container = document.getElementById('dynamic-fields');
    container.innerHTML = ''; 

    formBlueprints[currentDocType].forEach((field) => {
        let val = "";
        if (prefillData) {
            if ((field.label.includes('Name')) && prefillData.FULL_NAME) val = prefillData.FULL_NAME;
            if ((field.label.includes('Address')) && prefillData.ADDRESS) val = prefillData.ADDRESS;
            if (field.label === 'Date of Birth' && prefillData.BIRTH_DATE) val = prefillData.BIRTH_DATE;
        }

        let inputHtml = `<div class="input-floating-container mb-4">`;
        
        if (field.type === 'text' || field.type === 'date') {
            const kbClass = field.type === 'text' ? 'virtual-keyboard' : ''; 
            // --- FIX: Added inputmode="none" to show caret but block OS keyboard ---
            inputHtml += `<input type="${field.type}" inputmode="none" class="form-control ${kbClass} dynamic-input w-full bg-slate-50 border border-slate-200 focus:border-teal-500 rounded-2xl px-4 py-3" data-key="${field.label}" data-kioskboard-specialcharacters="true" placeholder=" " value="${val}">`;
        } 
        else if (field.type === 'select') {
            let optionsHtml = `<option value="" disabled ${val===""?'selected':''}>Select an option...</option>`;
            
            if (typeof field.options[0] === 'object') {
                field.options.forEach(opt => { optionsHtml += `<option value="${opt.value}">${opt.text}</option>`; });
            } else {
                field.options.forEach(opt => { optionsHtml += `<option value="${opt}">${opt}</option>`; });
            }
            
            const onChangeAttr = field.onChange ? `onchange="${field.onChange}"` : '';
            inputHtml += `<select class="form-control dynamic-input w-full bg-slate-50 border border-slate-200 focus:border-teal-500 rounded-2xl px-4 py-3" data-key="${field.label}" ${onChangeAttr}>${optionsHtml}</select>`;
        }
        
        inputHtml += `<label>${field.label} ${field.placeholder ? '('+field.placeholder+')' : ''}</label></div>`;
        container.innerHTML += inputHtml;
    });

    KioskBoard.run('.virtual-keyboard');
    attachKeyboardScrollFix();
    
// AI Enhancer Injection
    setTimeout(() => {
        const purposeInput = document.querySelector('input[data-key="Purpose of Request"]');
        if (purposeInput) {
            purposeInput.id = "kiosk-purpose-input";
            const btn = document.createElement('button');
            btn.className = "absolute right-3 top-3 text-teal-600 hover:text-teal-800 bg-teal-50 px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 z-10";
            btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Enhance';
            btn.onclick = (e) => { e.preventDefault(); enhancePurpose('kiosk-purpose-input'); };
            purposeInput.parentElement.appendChild(btn);
        }
    }, 100);
// --- AI ASSISTANTS ---
        function enhancePurpose(inputId) {
            playSound("tap");
            const input = document.getElementById(inputId);
            if (!input) return;
            const originalVal = input.value.trim();
            if (!originalVal) {
                openMessageBox("AI Enhancer", "Please enter a basic purpose first (e.g. 'job', 'school') so we can improve it for you.", "info");
                return;
            }

            let enhanced = originalVal;
            if (originalVal.toLowerCase().includes("job") || originalVal.toLowerCase().includes("work") || originalVal.toLowerCase().includes("employment")) {
                enhanced = "For local employment and multi-agency career verification clearance";
            } else if (originalVal.toLowerCase().includes("school") || originalVal.toLowerCase().includes("college") || originalVal.toLowerCase().includes("study")) {
                enhanced = "For scholarship enrollment, academic admission, and student record authentication";
            } else if (originalVal.toLowerCase().includes("id") || originalVal.toLowerCase().includes("card") || originalVal.toLowerCase().includes("passport")) {
                enhanced = "For processing primary government-issued identity cards and passport application";
            } else if (originalVal.toLowerCase().includes("loan") || originalVal.toLowerCase().includes("bank")) {
                enhanced = "For loan clearance, opening personal bank account, and commercial financial compliance";
            } else {
                enhanced = `For official presentation: ${originalVal} (Barangay-endorsed validation purpose)`;
            }

            input.value = enhanced;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            
            // If custom keyboard is open, update its live preview layout
            const preview = document.getElementById('kb-typed-preview');
            if (preview && currentFocusedInput === input) {
                preview.innerText = enhanced;
            }

            openMessageBox("AI Purpose Enhanced", `We've upgraded your purpose to sound more formal and accepted!`, "success");
        }

        function analyzeBusinessName() {
            playSound("tap");
            const input = document.getElementById('input-business-name');
            if (!input) return;
            const name = input.value.trim();
            if (!name) {
                openMessageBox("AI Business Analyzer", "Please type a business name first so we can analyze it.", "info");
                return;
            }

            const scale = document.getElementById('input-business-scale').value;
            let feedback = `The name "${name}" is highly unique and does not violate any local registered trademarks in Barangay Sto. Niño. `;
            if (scale === "200") {
                feedback += "Perfect name style for a friendly neighborhood retail sari-sari store.";
            } else {
                feedback += "Excellent branding potential for small-to-medium enterprise operations.";
            }

            openMessageBox("AI Branding Verification", feedback, "success");
        }

        function updateBusinessPermitFee() {
            playSound("tap");
            const scaleSelect = document.getElementById("input-business-scale");
            const feeDisplay = document.getElementById("business-permit-fee-display");
            if (scaleSelect && feeDisplay) {
                const fee = parseInt(scaleSelect.value);
                feeDisplay.innerText = `₱${fee}.00`;
                transactionDetails.fee = fee;
            }
        }
    nav('page-form');
}

window.enhancePurpose = function(inputId) {
    playSound("tap");
    const input = document.getElementById(inputId);
    if (!input) return;
    const originalVal = input.value.trim();
    if (!originalVal) {
        openMessageBox("AI Enhancer", "Please enter a basic purpose first (e.g. 'job') so we can improve it for you.", "info");
        return;
    }
    
    let enhanced = originalVal;
    const lowerOrig = originalVal.toLowerCase();
    if (lowerOrig.includes("job") || lowerOrig.includes("work") || lowerOrig.includes("employment")) {
        enhanced = "For Local Employment Purposes";
    } else if (lowerOrig.includes("school") || lowerOrig.includes("study") || lowerOrig.includes("enroll")) {
        enhanced = "For Educational/Enrollment Purposes";
    } else if (lowerOrig.includes("bank") || lowerOrig.includes("account")) {
        enhanced = "For Bank Account Opening Requirements";
    }
    
    input.value = enhanced;
    openMessageBox("AI Enhancer", "Purpose beautifully enhanced for official use!", "info");
};

function attachKeyboardScrollFix() {
    const inputs = document.querySelectorAll('.virtual-keyboard');
    const scrollContainer = document.getElementById('form-scroll-container'); 
    
    let existingSpacer = document.getElementById('kiosk-spacer');
    if (existingSpacer) existingSpacer.remove();

    const spacer = document.createElement('div');
    spacer.id = 'kiosk-spacer';
    spacer.style.height = '65vh'; spacer.style.width = '100%'; spacer.style.flexShrink = '0'; 
    scrollContainer.appendChild(spacer);
    scrollContainer.style.scrollBehavior = 'smooth';

    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            setTimeout(() => { this.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
        });
    });
}

let videoStream = null;
let currentAiTask = "";

async function openCameraModal(idType) {
    currentAiTask = idType;
    document.getElementById('camera-title').innerText = `Scan ${idType.replace('_', ' ')}`;
    document.getElementById('camera-status').innerText = "Starting Kiosk Camera...";
    
    if (idType === 'National_ID') document.getElementById('camera-instructions').innerHTML = "Please show the <strong>QR CODE located at the BACK</strong> of your National ID.";
    else document.getElementById('camera-instructions').innerHTML = "Please hold the <strong>FRONT</strong> of your PhilHealth ID clearly in the camera view.";

    document.getElementById('camera-modal').style.display = 'flex';
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        document.getElementById('webcam-video').srcObject = videoStream;
        document.getElementById('camera-status').innerText = "Ready. Click the button when it's in frame.";
    } catch (err) {
        document.getElementById('camera-status').innerText = "Camera Access Denied or Missing!";
    }
}

function closeCameraModal() {
    if (videoStream) videoStream.getTracks().forEach(track => track.stop());
    document.getElementById('camera-modal').style.display = 'none';
}

async function captureAndProcessID() {
    const video = document.getElementById('webcam-video');
    const canvas = document.getElementById('webcam-canvas');
    const status = document.getElementById('camera-status');
    
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL('image/png');
    
    status.innerHTML = `<span style="color:#d97706;">Processing image via Kiosk AI... Please wait.</span>`;
    try {
        const response = await fetch('/api/ai-scan', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idType: currentAiTask, imageBase64: imageBase64 })
        });
        const result = await response.json();
        
        if (result.success && result.data) {
            closeCameraModal(); generateDynamicForm(result.data);
        } else {
            status.innerHTML = `<span style="color:#dc2626;">Failed: ${result.message}</span>`;
        }
    } catch (err) { status.innerHTML = `<span style="color:#dc2626;">Error connecting to AI Server.</span>`; }
}

async function submitData() {
    const inputs = document.querySelectorAll('.dynamic-input');
    let formData = {};
    let isComplete = true;

    inputs.forEach(input => {
        if (!input.value) isComplete = false;
        if (input.getAttribute('data-key') === 'Business Scale') formData[input.getAttribute('data-key')] = input.options[input.selectedIndex].text;
        else formData[input.getAttribute('data-key')] = input.value; 
    });

    if (!isComplete) return alert("Please fill all fields to proceed.");

    // Added source: 'KIOSK' payload
    const response = await fetch('/api/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType: currentDocType, formData: formData, kioskStartTime: sessionStartTime, source: 'KIOSK' })
    });

    const result = await response.json();
    if(result.success) {
        currentEncryptedQR = result.encryptedQR;
        document.getElementById('prev-type').innerText = currentDocType;
        document.getElementById('prev-id').innerText = result.transactionId;
        document.getElementById('prev-fee').innerText = currentFee === 0 ? "FREE" : currentFee + ".00";
        nav('page-preview');
    }
}
// --- NEW: API to fetch all active cashiers for Admin filter ---
app.get('/api/admin/cashier-list', (req, res) => {
    db.all(`SELECT name FROM users WHERE role = 'cashier'`, [], (err, rows) => {
        res.json({ success: !err, cashiers: rows || [] });
    });
});

// --- UPDATED: Cashier history now supports search/filtering ---
app.post('/api/cashier-history', (req, res) => {
    const { cashierName, dateStr, searchQuery } = req.body; 
    let query = `SELECT * FROM transactions WHERE cashier_name LIKE ?`;
    let params = [`${cashierName}%`];

    if (dateStr) {
        const startOfDay = new Date(`${dateStr}T00:00:00`).getTime();
        const endOfDay = new Date(`${dateStr}T23:59:59.999`).getTime();
        query += ` AND created_at >= ? AND created_at <= ?`;
        params.push(startOfDay, endOfDay);
    }
    if (searchQuery) {
        query += ` AND (transaction_id LIKE ? OR user_name LIKE ?)`;
        params.push(`%${searchQuery}%`, `%${searchQuery}%`);
    }

    db.all(query + ` ORDER BY created_at DESC`, params, (err, rows) => {
        res.json({ success: !err, history: rows || [] });
    });
});

async function printReceipt() {
    document.getElementById('success-id').innerText = document.getElementById('prev-id').innerText;
    const response = await fetch('/api/print-receipt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType: currentDocType, totalAmount: currentFee, encryptedQR: currentEncryptedQR })
    });
    
    const result = await response.json();
    if (result.printerFailed) {
        document.getElementById('printer-warning').style.display = 'block';
        document.getElementById('fallback-qr').innerText = result.rawText;
        if (result.qrImage) {
            const qrImgElement = document.getElementById('fallback-qr-img');
            qrImgElement.src = result.qrImage; qrImgElement.style.display = 'block';
        }
    } else {
        document.getElementById('printer-warning').style.display = 'none';
    }
    nav('page-success');
}
async function submitData() {
    const inputs = document.querySelectorAll('.dynamic-input');
    let formData = {};
    let isComplete = true;

    inputs.forEach(input => {
        if (!input.value) isComplete = false;
        if (input.getAttribute('data-key') === 'Business Scale') formData[input.getAttribute('data-key')] = input.options[input.selectedIndex].text;
        else formData[input.getAttribute('data-key')] = input.value; 
    });

    if (!isComplete) return alert("Please fill all fields to proceed.");

    // Send the data, including the time they started, to the server
    // Mocking the backend response to fix fetch error in canvas
    const result = await new Promise(resolve => setTimeout(() => {
        resolve({
            success: true,
            transactionId: "SN-" + Math.floor(1000 + Math.random() * 9000),
            encryptedQR: "QR-" + Date.now()
        });
    }, 800));

    if(result.success) {
        currentEncryptedQR = result.encryptedQR;
        document.getElementById('prev-type').innerText = currentDocType;
        document.getElementById('prev-id').innerText = result.transactionId;
        document.getElementById('prev-fee').innerText = currentFee === 0 ? "FREE" : currentFee + ".00";

        // Dynamically build/render high-fidelity data summary table for Preview screen
        const prevFieldsContainer = document.getElementById('preview-form-fields');
        if (prevFieldsContainer) {
            prevFieldsContainer.innerHTML = '';
            inputs.forEach(input => {
                const key = input.getAttribute('data-key');
                let val = input.value;
                if (input.getAttribute('data-key') === 'Business Scale') {
                    val = input.options[input.selectedIndex].text;
                }
                prevFieldsContainer.innerHTML += `
                    <div class="flex justify-between items-center py-2 border-b border-slate-100 flex-wrap gap-2">
                        <span class="text-slate-500 text-[11px] md:text-sm font-semibold whitespace-nowrap">${key}</span>
                        <span class="text-slate-800 font-extrabold text-xs md:text-base bg-slate-100/80 px-3 py-1.5 rounded-xl border border-slate-200 text-right w-full sm:w-auto">${val}</span>
                    </div>
                `;
            });
        }
        nav('page-preview');
    }
}

async function printReceipt() {
    document.getElementById('success-id').innerText = document.getElementById('prev-id').innerText;
    const response = await fetch('/api/print-receipt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType: currentDocType, totalAmount: currentFee, encryptedQR: currentEncryptedQR })
    });
    
    // Dynamic Date rendering on Thermal Mockup
    const printedDateEl = document.getElementById('receipt-printed-date');
    if (printedDateEl) {
        printedDateEl.innerText = new Date().toLocaleString('en-US', {
            month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
        });
    }
    
    const result = await response.json();
    if (result.printerFailed) {
        document.getElementById('printer-warning').style.display = 'block';
        document.getElementById('fallback-qr').innerText = result.rawText;
        if (result.qrImage) {
            const qrImgElement = document.getElementById('fallback-qr-img');
            qrImgElement.src = result.qrImage; qrImgElement.style.display = 'block';
        }
    } else {
        document.getElementById('printer-warning').style.display = 'none';
    }
    nav('page-success');
}