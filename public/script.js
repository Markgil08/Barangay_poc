// --- KIOSKBOARD INIT ---
KioskBoard.init({
    keysArrayOfObjects: [
      { "0": "Q", "1": "W", "2": "E", "3": "R", "4": "T", "5": "Y", "6": "U", "7": "I", "8": "O", "9": "P" },
      { "0": "A", "1": "S", "2": "D", "3": "F", "4": "G", "5": "H", "6": "J", "7": "K", "8": "L" },
      { "0": "Z", "1": "X", "2": "C", "3": "V", "4": "B", "5": "N", "6": "Ñ", "7": "M" }
    ],
    keysSpecialCharsArrayOfStrings: ['-', '.', ',', '@', '_', '/'],
    allowRealKeyboard: true, autoCaps: true, autoScroll: false, theme: 'light'
});
function updateClock() {
    const clock = document.getElementById('live-clock-kiosk');
    if (clock) {
        clock.innerText = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
}
setInterval(updateClock, 1000);
updateClock();
const civilStatusOptions = ['Single', 'Married', 'Widowed', 'Legally Separated'];

// --- VERIFIED FORM BLUEPRINTS (Approved UI Layouts) ---
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

function nav(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    document.getElementById(pageId).classList.add('active-page');
    resetIdleTimer();
}

let idleTimer;
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

// --- DYNAMIC PRICING LOGIC ---
function updateBusinessPermitFee(selectElement) {
    currentFee = parseInt(selectElement.value);
    document.getElementById('form-fee').innerText = currentFee + ".00";
}

function presentEntryChoice(docType, fee) {
    currentDocType = docType;
    baseFeeForDoc = fee;
    currentFee = fee; 
    
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

// --- DYNAMIC FORM GENERATOR ---
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
            inputHtml += `<input type="${field.type}" class="form-control ${kbClass} dynamic-input w-full bg-slate-50 border border-slate-200 focus:border-teal-500 rounded-2xl px-4 py-3" data-key="${field.label}" data-kioskboard-specialcharacters="true" placeholder=" " value="${val}">`;
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
    nav('page-form');
}

// --- BULLETPROOF KEYBOARD SCROLL FIX ---
function attachKeyboardScrollFix() {
    const inputs = document.querySelectorAll('.virtual-keyboard');
    const scrollContainer = document.getElementById('form-scroll-container'); 
    
    // 1. Remove old spacer to prevent duplicates
    let existingSpacer = document.getElementById('kiosk-spacer');
    if (existingSpacer) existingSpacer.remove();

    // 2. Create a permanent, invisible "safe space" block at the bottom of the form
    const spacer = document.createElement('div');
    spacer.id = 'kiosk-spacer';
    // 65vh ensures there is always enough space to scroll the lowest input above the keyboard
    spacer.style.height = '65vh'; 
    spacer.style.width = '100%';
    spacer.style.flexShrink = '0'; // Forces the browser to respect the space
    scrollContainer.appendChild(spacer);

    // 3. Enable smooth scrolling
    scrollContainer.style.scrollBehavior = 'smooth';

    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            // Because the spacer is permanent, we don't cause screen jumps. 
            // We just smoothly glide the active input into the middle of the screen.
            setTimeout(() => {
                this.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });
    });
}

// --- CAMERA & AI AUTO-FILL LOGIC ---
let videoStream = null;
let currentAiTask = "";

async function openCameraModal(idType) {
    currentAiTask = idType;
    document.getElementById('camera-title').innerText = `Scan ${idType.replace('_', ' ')}`;
    document.getElementById('camera-status').innerText = "Starting Kiosk Camera...";
    
    if (idType === 'National_ID') {
        document.getElementById('camera-instructions').innerHTML = "Please show the <strong>QR CODE located at the BACK</strong> of your National ID to the camera.";
    } else {
        document.getElementById('camera-instructions').innerHTML = "Please hold the <strong>FRONT</strong> of your PhilHealth ID clearly in the camera view.";
    }

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
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL('image/png');
    
    status.innerHTML = `<span style="color:#d97706;">Processing image via Kiosk AI... Please wait.</span>`;
    
    try {
        const response = await fetch('/api/ai-scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idType: currentAiTask, imageBase64: imageBase64 })
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            closeCameraModal();
            generateDynamicForm(result.data);
        } else {
            status.innerHTML = `<span style="color:#dc2626;">Failed: ${result.message}</span>`;
        }
    } catch (err) {
        status.innerHTML = `<span style="color:#dc2626;">Error connecting to AI Server.</span>`;
    }
}

// --- SUBMISSION LOGIC ---
async function submitData() {
    const inputs = document.querySelectorAll('.dynamic-input');
    let formData = {};
    let isComplete = true;

    inputs.forEach(input => {
        if (!input.value) isComplete = false;
        
        if (input.getAttribute('data-key') === 'Business Scale') {
            formData[input.getAttribute('data-key')] = input.options[input.selectedIndex].text;
        } else {
            formData[input.getAttribute('data-key')] = input.value; 
        }
    });

    if (!isComplete) return alert("Please fill all fields to proceed.");

    const userConfirmed = window.confirm(`Proceed to Assessment?\n\nBase Fee: ₱${currentFee}\nPlease ensure all your information is correct.`);
    if (!userConfirmed) return;

    const response = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType: currentDocType, formData: formData })
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

async function printReceipt() {
    document.getElementById('success-id').innerText = document.getElementById('prev-id').innerText;
    
    const response = await fetch('/api/print-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType: currentDocType, totalAmount: currentFee, encryptedQR: currentEncryptedQR })
    });
    
    const result = await response.json();
    
    if (result.printerFailed) {
        document.getElementById('printer-warning').style.display = 'block';
        document.getElementById('fallback-qr').innerText = result.rawText;
        if (result.qrImage) {
            const qrImgElement = document.getElementById('fallback-qr-img');
            qrImgElement.src = result.qrImage;
            qrImgElement.style.display = 'block';
        }
    } else {
        document.getElementById('printer-warning').style.display = 'none';
    }

    nav('page-success');
}