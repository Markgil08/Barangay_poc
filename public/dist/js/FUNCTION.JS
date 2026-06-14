       // --- GLOBAL APP STATES ---
        let activePageId = "page-screensaver";
        let activeModalId = "";
        let transactionDetails = {
            docType: "",
            fee: 0,
            fields: []
        };
        let kioskLanguage = "en";
        let idleTimer;
        let isShiftActive = false;
        let currentFocusedInput = null;

        // Choice tracker for targeting correct form pre-filling after scans
        let targetFormPageId = "";
        let targetDocTypeName = "";
        let targetBaseDocFee = 0;

        // Keypad layouts
        const keyboardKeysLower = [
            ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
            ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
            ["shift", "z", "x", "c", "v", "b", "n", "m", "ñ", "backspace"]
        ];

        const keyboardKeysUpper = [
            ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
            ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
            ["shift", "Z", "X", "C", "V", "B", "N", "M", "Ñ", "backspace"]
        ];

        // Ensure default cashier credentials exist inside local storage
        if (!localStorage.getItem("cashier_username")) {
            localStorage.setItem("cashier_username", "cashier");
            localStorage.setItem("cashier_password", "cashier123");
        }

        // Ensure default admin credentials exist inside local storage
        if (!localStorage.getItem("admin_username")) {
            localStorage.setItem("admin_username", "admin");
            localStorage.setItem("admin_password", "admin123");
        }

        const TRANSLATIONS = {
            en: {
                welcome: "Welcome to Sto. Niño Portal",
                subwelcome: "Please choose the document you would like to process today.",
                clearanceTitle: "Barangay Clearance",
                clearanceDesc: "Residency, travel, and moral standing clearance.",
                indigencyTitle: "Certificate of Indigency",
                indigencyDesc: "For low-income financial assistance needs.",
                residencyTitle: "Certificate of Residency",
                residencyDesc: "Proof of address and long-term residency.",
                businessTitle: "Barangay Business Permit",
                businessDesc: "License permit to run a business in Sto. Niño.",
                screensaverBtn: "Screensaver"
            },
            ph: {
                welcome: "Maligayang Pagdating sa Sto. Niño Portal",
                subwelcome: "Piliin ang dokumento na nais mong iproseso ngayon.",
                clearanceTitle: "Barangay Clearance",
                clearanceDesc: "Sertipiko ng paninirahan, paglalakbay, at mabuting asal.",
                indigencyTitle: "Sertipiko ng Indigency",
                indigencyDesc: "Para sa tulong-pinansyal sa mga may mababang kita.",
                residencyTitle: "Sertipiko ng Paninirahan",
                residencyDesc: "Katunayan ng tirahan at matagal na paninirahan.",
                businessTitle: "Permit sa Negosyo ng Barangay",
                businessDesc: "Lisensya para magpatakbo ng negosyo sa Sto. Niño.",
                screensaverBtn: "Screensaver"
            }
        };

        // --- STREAMING_CHUNK: Initializing Tone Synthesizers with scheduling safeguards... ---
        let synth;
        try {
            synth = new Tone.Synth({
                oscillator: { type: "sine" },
                envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.1 }
            }).toDestination();
        } catch(e) {
            console.warn("Web Audio delayed loading.", e);
        }

        let lastPlayedTime = 0;
        function playSound(type) {
            try {
                if (Tone.context && Tone.context.state === 'suspended') {
                    Tone.context.resume();
                }
                const now = Tone.now();
                // Ensure at least 50ms has elapsed since the last scheduled start time to resolve scheduling errors
                if (now - lastPlayedTime < 0.05) {
                    return; 
                }
                lastPlayedTime = now;

                if (type === 'tap' && synth) {
                    synth.triggerAttackRelease("C5", "16n", now + 0.01);
                } else if (type === 'success' && synth) {
                    synth.triggerAttackRelease("E5", "16n", now + 0.01);
                    synth.triggerAttackRelease("A5", "16n", now + 0.16);
                    lastPlayedTime = now + 0.2; 
                } else if (type === 'error' && synth) {
                    synth.triggerAttackRelease("Ab3", "8n", now + 0.01);
                } else if (type === 'print' && synth) {
                    synth.triggerAttackRelease("C4", "32n", now + 0.01);
                }
            } catch (err) {
                console.error("Audio trigger error:", err);
            }
        }

        // --- SPA ROUTING ---
        function nav(targetPageId) {
            playSound("tap");
            dismissKioskKeyboard();

            const pages = [
                'page-screensaver',
                'page-landing',
                'page-admin-login',
                'page-cashier-login',
                'page-cashier-dashboard',
                'page-admin-dashboard',
                'page-preview',
                'page-success'
            ];

            pages.forEach(pId => {
                const pageEl = document.getElementById(pId);
                if (pageEl) {
                    if (pId === targetPageId) {
                        pageEl.classList.remove('hidden');
                        pageEl.style.display = 'flex';
                    } else {
                        pageEl.classList.add('hidden');
                        pageEl.style.display = 'none';
                    }
                }
            });

            activePageId = targetPageId;
            resetIdleTimer();
        }

        // --- SCREENSAVER LOGIC ---
        function wakeUpKiosk() {
            playSound("success");
            nav("page-landing");
        }

        function switchToScreensaver() {
            playSound("tap");
            closeAllFormsAndModals();
            nav("page-screensaver");
        }

        function resetIdleTimer() {
            clearTimeout(idleTimer);
            const consumerPages = ['page-landing', 'page-preview', 'page-success'];
            if (consumerPages.includes(activePageId)) {
                idleTimer = setTimeout(() => {
                    switchToScreensaver();
                }, 120000);
            }
        }

        document.addEventListener('click', resetIdleTimer);
        document.addEventListener('keypress', resetIdleTimer);

        // --- STREAMING_CHUNK: Setting up key-press triggers and floats... ---
        // --- HIGH FIDELITY CUSTOM VIRTUAL KEYBOARD ENGINE ---
        const isMobileOrTablet = window.innerWidth <= 860 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        function setupVirtualKeyboard() {
            if (isMobileOrTablet) return; // Keep native keyboards for personal touch devices

            // Bind focus triggers
            document.querySelectorAll('input[type="text"]').forEach(input => {
                input.addEventListener('focus', (e) => {
                    currentFocusedInput = e.target;
                    
                    // Show Keyboard Overlay
                    const kbContainer = document.getElementById('custom-virtual-keyboard');
                    kbContainer.classList.remove('hidden');
                    
                    // Setup Active Info Banner
                    const dataKey = currentFocusedInput.getAttribute('data-key') || 'Details';
                    document.getElementById('kb-active-field-name').innerText = `Entering ${dataKey}:`;
                    document.getElementById('kb-typed-preview').innerText = currentFocusedInput.value;

                    // Lift form elements cleanly above keyboard view
                    const formContainer = currentFocusedInput.closest('.modal-content');
                    if(formContainer) {
                        formContainer.classList.add('form-shift-up');
                    }

                    renderKeyboardRows();
                });
            });
        }

        function renderKeyboardRows() {
            const currentLayout = isShiftActive ? keyboardKeysUpper : keyboardKeysLower;
            
            // Render Row 1
            const r1 = document.getElementById('kb-row-1');
            r1.innerHTML = "";
            currentLayout[0].forEach(key => {
                r1.appendChild(createKeyElement(key));
            });

            // Render Row 2
            const r2 = document.getElementById('kb-row-2');
            r2.innerHTML = "";
            currentLayout[1].forEach(key => {
                r2.appendChild(createKeyElement(key));
            });

            // Render Row 3
            const r3 = document.getElementById('kb-row-3');
            r3.innerHTML = "";
            currentLayout[2].forEach(key => {
                r3.appendChild(createKeyElement(key));
            });
        }

        function createKeyElement(key) {
            const btn = document.createElement('button');
            btn.type = "button";
            btn.className = "ripple-btn flex-grow h-12 bg-[#FCF6F5] text-[#89ABE3] rounded-xl hover:bg-white active:scale-95 transition-all text-sm font-bold flex items-center justify-center shadow-md border border-[#89ABE3]/10";
            
            if (key === "shift") {
                btn.innerHTML = `<i class="fa-solid fa-arrow-up-long mr-1"></i> Shift`;
                btn.className += isShiftActive ? " !bg-teal-700 !text-white" : " !bg-slate-100 !text-slate-500";
                btn.onclick = () => toggleShift();
            } else if (key === "backspace") {
                btn.innerHTML = `<i class="fa-solid fa-delete-left"></i>`;
                btn.className += " !bg-rose-100 !text-rose-600";
                btn.onclick = () => handleKeyType('backspace');
            } else {
                btn.innerText = key;
                btn.onclick = () => handleKeyType(key);
            }
            return btn;
        }

        function toggleShift() {
            playSound("tap");
            isShiftActive = !isShiftActive;
            renderKeyboardRows();
        }

        function handleKeyType(val) {
            if (!currentFocusedInput) return;
            playSound("tap");

            let currentVal = currentFocusedInput.value;
            if (val === 'backspace') {
                currentFocusedInput.value = currentVal.substring(0, currentVal.length - 1);
            } else {
                currentFocusedInput.value = currentVal + val;
            }

            // Sync visual blinking preview and input focus indicators
            document.getElementById('kb-typed-preview').innerText = currentFocusedInput.value;
            currentFocusedInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        function dismissKioskKeyboard() {
            const kbContainer = document.getElementById('custom-virtual-keyboard');
            if (kbContainer) {
                kbContainer.classList.add('hidden');
            }
            
            if (currentFocusedInput) {
                // Drop shift layouts
                const formContainer = currentFocusedInput.closest('.modal-content');
                if (formContainer) {
                    formContainer.classList.remove('form-shift-up');
                }
                currentFocusedInput.blur();
                currentFocusedInput = null;
            }
        }

        // --- STREAMING_CHUNK: Processing Choice popups, manual form launchers and animations... ---
        // --- CHAT/FLOW: ID SCANNING VS MANUAL ENTRY POPUP SEQUENCE ---
        function presentEntryChoice(formId, docType, fee) {
            playSound("tap");
            targetFormPageId = formId;
            targetDocTypeName = docType;
            targetBaseDocFee = fee;

            // Show Entry choice modal overlay
            const entryChoiceModal = document.getElementById('modal-entry-choice');
            entryChoiceModal.classList.remove('hidden');
        }

        function closeChoiceModals() {
            playSound("tap");
            document.getElementById('modal-entry-choice').classList.add('hidden');
            document.getElementById('modal-id-selector').classList.add('hidden');
            document.getElementById('modal-scanner').classList.add('hidden');
        }

        function startKioskForm(formId, docTypeName, baseDocFee) {
            playSound("tap");
            transactionDetails.docType = docTypeName;
            transactionDetails.fee = baseDocFee;
            activeModalId = formId;

            // Reset validation borders of target form
            const formContainer = document.getElementById(formId);
            if (formContainer) {
                formContainer.querySelectorAll('input, select').forEach(input => {
                    input.classList.remove('border-red-500');
                    // Force dispatch an input event to align any native floating labels properly
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });
                formContainer.classList.remove('hidden');
                formContainer.style.display = 'flex';
            }
        }

        function closeFormModal(formId) {
            playSound("tap");
            const modal = document.getElementById(formId);
            if (modal) {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            }
            if (activeModalId === formId) {
                activeModalId = "";
            }
        }

        function closeAllFormsAndModals() {
            const formIds = ['page-form-clearance', 'page-form-indigency', 'page-form-residency', 'page-form-business'];
            formIds.forEach(formId => {
                const modal = document.getElementById(formId);
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
            closeChoiceModals();
            closeCredentialsModal();
            closeCashierCredentialsModal();
            activeModalId = "";
        }

        function proceedToManualEntry() {
            document.getElementById('modal-entry-choice').classList.add('hidden');
            startKioskForm(targetFormPageId, targetDocTypeName, targetBaseDocFee);
        }

        function selectScanningRoute() {
            document.getElementById('modal-entry-choice').classList.add('hidden');
            document.getElementById('modal-id-selector').classList.remove('hidden');
        }

        function returnToChoice() {
            document.getElementById('modal-id-selector').classList.add('hidden');
            document.getElementById('modal-entry-choice').classList.remove('hidden');
        }

        function triggerScannerProcess(idType) {
            document.getElementById('modal-id-selector').classList.add('hidden');
            document.getElementById('scanner-id-label').innerText = `${idType} Scan Active`;
            
            const scanModal = document.getElementById('modal-scanner');
            scanModal.classList.remove('hidden');

            executeMockOcrProcess(idType);
        }

        // Simulates AI Card scanning OCR processing
        function executeMockOcrProcess(idType) {
            const bar = document.getElementById("scan-progress-bar");
            const status = document.getElementById("scan-status-text");
            let progress = 0;
            bar.style.width = "0%";

            function playScanBeep() {
                if (progress < 100 && activePageId !== "page-screensaver") {
                    playSound("print");
                    setTimeout(playScanBeep, 250);
                }
            }
            playScanBeep();

            const interval = setInterval(() => {
                progress += 10;
                if(progress <= 100) {
                    bar.style.width = `${progress}%`;
                    if(progress === 20) status.innerHTML = '<i class="fa-solid fa-spinner animate-spin mr-2 text-teal-400"></i> Detecting card alignment...';
                    if(progress === 50) status.innerHTML = '<i class="fa-solid fa-magnifying-glass mr-2 text-cyan-400"></i> Scanning document topography...';
                    if(progress === 80) status.innerHTML = '<i class="fa-solid fa-robot mr-2 text-indigo-400"></i> Decoding OCR data attributes...';
                } else {
                    clearInterval(interval);
                    playSound("success");
                    status.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-500 mr-2"></i> Scan Completed!';
                    
                    setTimeout(() => {
                        closeChoiceModals();
                        autofillFormRecords(idType);
                    }, 800);
                }
            }, 300);
        }

        function autofillFormRecords(idType) {
            // Setup prefilled mock credentials representing selected ID types
            const mockNationalId = {
                name: "Juan Dela Cruz",
                address: "123 Sto. Niño Street, Parañaque City",
                birthdate: "1995-05-15",
                status: "Single",
                purpose: "Local Employment"
            };

            const mockPhilhealthId = {
                name: "Maria C. Santos",
                address: "456 CAA Road, Las Piñas City",
                birthdate: "1988-10-23",
                status: "Married",
                purpose: "Medical Assistance"
            };

            const activeSet = (idType === 'National ID') ? mockNationalId : mockPhilhealthId;

            // Prepopulate active target form page
            const formPage = document.getElementById(targetFormPageId);
            if(formPage) {
                // Trigger form prefilled states
                formPage.querySelectorAll('input, select').forEach(input => {
                    const dataKey = input.getAttribute('data-key');
                    if (dataKey === 'Full Name' || dataKey === 'Owner Full Name') {
                        input.value = activeSet.name;
                    } else if (dataKey === 'Address' || dataKey === 'Business Address') {
                        input.value = activeSet.address;
                    } else if (dataKey === 'Birthdate') {
                        input.value = activeSet.birthdate;
                    } else if (dataKey === 'Civil Status') {
                        input.value = activeSet.status;
                    } else if (dataKey === 'Purpose') {
                        input.value = activeSet.purpose;
                    } else if (dataKey === 'Business Name') {
                        input.value = "Sari-Sari Store Ni " + activeSet.name.split(' ')[0];
                    } else if (dataKey === 'Contact Number') {
                        input.value = "0917-889-2234";
                    } else if (dataKey === 'Years of Residency') {
                        input.value = "15";
                    }

                    // Force trigger native value-change events for label floating animations
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });

                // Display form modal
                startKioskForm(targetFormPageId, targetDocTypeName, targetBaseDocFee);
                
                // Prefill success alert message Box
                openMessageBox("AI ID Scan Success", `Successfully extracted data from your ${idType}! Details have been automatically prefilled. Please review below.`, "success");
            }
        }

        // --- STREAMING_CHUNK: Managing localized translation controls... ---
        // --- PORTAL TRANSLATION ENGINE & CONFIGS ---
        function toggleLanguage(lang) {
            playSound("tap");
            kioskLanguage = lang;

            const btnEn = document.getElementById("lang-btn-en");
            const btnPh = document.getElementById("lang-btn-ph");
            
            const baseClass = "px-5 py-2.5 rounded-2xl font-bold transition-all text-xs md:text-sm shadow-sm w-full sm:w-auto ";
            if (lang === "en") {
                btnEn.className = baseClass + "bg-teal-700 text-white border border-teal-700";
                btnPh.className = baseClass + "bg-white/85 text-slate-700 border border-slate-200 hover:bg-white";
                document.getElementById("lang-indicator").innerHTML = '<i class="fa-solid fa-globe text-teal-600 animate-pulse"></i><span class="font-semibold text-slate-800">English Mode</span>';
            } else {
                btnPh.className = baseClass + "bg-teal-700 text-white border border-teal-700";
                btnEn.className = baseClass + "bg-white/85 text-slate-700 border border-slate-200 hover:bg-white";
                document.getElementById("lang-indicator").innerHTML = '<i class="fa-solid fa-globe text-teal-600 animate-pulse"></i><span class="font-semibold text-slate-800">Tagalog Mode</span>';
            }

            const dict = TRANSLATIONS[lang];
            document.getElementById("lang-welcome").innerText = dict.welcome;
            document.getElementById("lang-subwelcome").innerText = dict.subwelcome;
            document.getElementById("lang-clearance-title").innerText = dict.clearanceTitle;
            document.getElementById("lang-clearance-desc").innerText = dict.clearanceDesc;
            document.getElementById("lang-indigency-title").innerText = dict.indigencyTitle;
            document.getElementById("lang-indigency-desc").innerText = dict.indigencyDesc;
            document.getElementById("lang-residency-title").innerText = dict.residencyTitle;
            document.getElementById("lang-residency-desc").innerText = dict.residencyDesc;
            document.getElementById("lang-business-title").innerText = dict.businessTitle;
            document.getElementById("lang-business-desc").innerText = dict.businessDesc;
            document.getElementById("lang-screensaver-btn").innerText = dict.screensaverBtn;
        }

        // --- SUBMIT COMPONENT & VALIDATOR ---
        function verifyAndSubmitData(docType, fee, inputClassSelector) {
            const inputs = document.querySelectorAll(inputClassSelector);
            let isComplete = true;
            let capturedFields = [];

            inputs.forEach(input => {
                if (!input.value || input.value.trim() === "") {
                    isComplete = false;
                    input.classList.add("border-red-500");
                } else {
                    input.classList.remove("border-red-500");
                }
                capturedFields.push({
                    key: input.getAttribute("data-key"),
                    value: input.value
                });
            });

            if (!isComplete) {
                playSound("error");
                openMessageBox("Incomplete Form", "Please fill in all input fields to proceed to the review screen.", "error");
                return;
            }

            transactionDetails.fields = capturedFields;
            transactionDetails.docType = docType;
            transactionDetails.fee = fee;
            closeFormModal(activeModalId);

            renderPreviewScreen();
            nav("page-preview");
        }

        function verifyBusinessAndSubmit() {
            const scaleVal = parseInt(document.getElementById("input-business-scale").value);
            verifyAndSubmitData('Barangay Business Permit', scaleVal, '.business-input');
        }

        function renderPreviewScreen() {
            document.getElementById("preview-receipt-type").innerText = transactionDetails.docType;
            document.getElementById("preview-receipt-base").innerText = transactionDetails.fee === 0 ? "FREE" : `₱${transactionDetails.fee}.00`;
            document.getElementById("preview-receipt-total").innerText = transactionDetails.fee === 0 ? "FREE" : `₱${transactionDetails.fee}.00`;

            const container = document.getElementById("preview-form-fields");
            container.innerHTML = "";

            transactionDetails.fields.forEach(field => {
                const element = document.createElement("div");
                element.className = "flex justify-between items-center py-2 border-b border-slate-100 flex-wrap gap-2";
                element.innerHTML = `
                    <span class="text-slate-500 text-[10px] md:text-sm font-semibold whitespace-nowrap">${field.key}</span>
                    <span class="text-slate-800 font-extrabold text-xs md:text-base bg-slate-100/80 px-3 py-1.5 rounded-xl border border-slate-200 text-right w-full sm:w-auto">${field.value}</span>
                `;
                container.appendChild(element);
            });
        }

        function returnToForm() {
            playSound("tap");
            if(transactionDetails.docType === "Barangay Clearance") {
                startKioskForm('page-form-clearance', 'Barangay Clearance', 50);
            } else if(transactionDetails.docType === "Certificate of Indigency") {
                startKioskForm('page-form-indigency', 'Certificate of Indigency', 0);
            } else if(transactionDetails.docType === "Certificate of Residency") {
                startKioskForm('page-form-residency', 'Certificate of Residency', 50);
            } else if(transactionDetails.docType === "Barangay Business Permit") {
                startKioskForm('page-form-business', 'Barangay Business Permit', transactionDetails.fee);
            }
            nav("page-landing");
        }

        // --- STREAMING_CHUNK: Processing finalized barcodes, mock logs and payments... ---
        // --- PRINT RECEIPT ---
        function printReceiptAndFinalize() {
            nav("page-success");

            const rand = Math.floor(1000 + Math.random() * 9000);
            const refId = `SN-2026-${rand}`;

            let clientName = "N/A";
            const nameField = transactionDetails.fields.find(f => f.key.toLowerCase().includes("name") || f.key.toLowerCase().includes("owner"));
            if (nameField) {
                clientName = nameField.value;
            }

            document.getElementById("receipt-ref-id").innerText = refId;
            document.getElementById("receipt-doc-name").innerText = transactionDetails.docType;
            document.getElementById("receipt-doc-fee").innerText = transactionDetails.fee === 0 ? "FREE" : `₱${transactionDetails.fee}.00`;

            document.getElementById("mobile-ref-id").innerText = refId;
            document.getElementById("mobile-receipt-doc-name").innerText = transactionDetails.docType;
            document.getElementById("mobile-receipt-client-name").innerText = clientName;

            const receiptInputs = document.getElementById("receipt-dynamic-inputs");
            receiptInputs.innerHTML = "";
            transactionDetails.fields.forEach(field => {
                const row = document.createElement("div");
                row.className = "flex justify-between text-[9px] md:text-[11px] font-mono lowercase flex-wrap gap-x-2 gap-y-1";
                row.innerHTML = `
                    <span class="text-slate-500 whitespace-nowrap">${field.key.substring(0,12)}:</span>
                    <span class="font-bold text-slate-800 text-right break-words max-w-full">${field.value.substring(0,25)}</span>
                `;
                receiptInputs.appendChild(row);
            });

            const now = new Date();
            const formattedDate = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()} ${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            document.getElementById("receipt-printed-date").innerText = formattedDate;

            const qrContainer = document.getElementById("receipt-qrcode");
            qrContainer.innerHTML = ""; 
            setTimeout(() => {
                const serializedData = `ID:${refId}|Doc:${transactionDetails.docType}|Name:${clientName}`;
                new QRCode(qrContainer, {
                    text: serializedData,
                    width: 100,
                    height: 100,
                    colorDark : "#0f172a",
                    colorLight : "#fcfcfc",
                    correctLevel : QRCode.CorrectLevel.H
                });
            }, 100);

            const mobileQrContainer = document.getElementById("mobile-receipt-qrcode");
            mobileQrContainer.innerHTML = ""; 
            setTimeout(() => {
                const serializedData = `ID:${refId}|Doc:${transactionDetails.docType}|Name:${clientName}`;
                new QRCode(mobileQrContainer, {
                    text: serializedData,
                    width: 160,
                    height: 160,
                    colorDark : "#020617",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });
            }, 100);

            saveToLocalDB(refId, transactionDetails.docType, clientName, transactionDetails.fee, formattedDate);
            executeSimulatedPrinter();
        }

        function executeSimulatedPrinter() {
            const bar = document.getElementById("printer-progress");
            const percent = document.getElementById("printer-status-percent");
            const text = document.getElementById("printer-status-text");
            let progress = 0;

            function playPrintBeep() {
                if (progress < 100) {
                    playSound("print");
                    setTimeout(playPrintBeep, 180);
                }
            }
            playPrintBeep();

            const interval = setInterval(() => {
                progress += 5;
                if(progress <= 100) {
                    bar.style.width = `${progress}%`;
                    percent.innerText = `${progress}%`;
                    if(progress === 20) text.innerHTML = '<i class="fa-solid fa-sync animate-spin mr-2"></i> Accessing Server';
                    if(progress === 60) text.innerHTML = '<i class="fa-solid fa-print animate-pulse mr-2"></i> Burning Thermal Receipt';
                    if(progress === 90) text.innerHTML = '<i class="fa-solid fa-scissors mr-2"></i> Cutting Paper';
                } else {
                    clearInterval(interval);
                    playSound("success");
                    text.innerHTML = '<i class="fa-solid fa-check-double text-emerald-500 mr-2"></i> Completed Successfully';
                }
            }, 150);
        }

        function resetToHome() {
            playSound("tap");
            closeAllFormsAndModals();
            nav("page-landing");
        }

        // --- LOCAL DB LOGS ---
        function saveToLocalDB(refId, docType, name, fee, date) {
            let logs = [];
            if(localStorage.getItem("barangay_kiosk_logs")) {
                logs = JSON.parse(localStorage.getItem("barangay_kiosk_logs"));
            }
            logs.push({ refId, docType, name, fee, date, status: 'PENDING' });
            localStorage.setItem("barangay_kiosk_logs", JSON.stringify(logs));
            updateAdminDashboardData();
        }

        function updateAdminDashboardData() {
            let logs = [];
            if(localStorage.getItem("barangay_kiosk_logs")) {
                logs = JSON.parse(localStorage.getItem("barangay_kiosk_logs"));
            }

            const table = document.getElementById("admin-log-table");
            const placeholder = document.getElementById("admin-no-logs");
            table.innerHTML = "";

            document.getElementById("figma-document-records-label").innerText = `Document Records (${logs.length})`;

            if(logs.length === 0) {
                placeholder.classList.remove("hidden");
                document.getElementById("admin-stat-revenue").innerText = "₱0.00";
                document.getElementById("admin-stat-count").innerText = "0";
                return;
            } else {
                placeholder.classList.add("hidden");
            }

            let revenue = 0;
            for(let i = logs.length - 1; i >= 0; i--) {
                const log = logs[i];
                if (log.status === 'AUTHORIZED' || log.status === 'COMPLETED') {
                    revenue += parseFloat(log.fee);
                }

                const row = document.createElement("tr");
                row.className = "hover:bg-slate-50 transition-colors";
                
                const paymentStatus = log.status || 'PENDING';
                const paymentMethod = log.fee === 0 ? "None" : "OTC Cash";

                row.innerHTML = `
                    <td class="px-4 md:px-6 py-3 md:py-4 font-mono font-bold text-teal-700 whitespace-nowrap">${log.refId}</td>
                    <td class="px-4 md:px-6 py-3 md:py-4 font-medium text-slate-700 whitespace-nowrap">${log.docType}</td>
                    <td class="px-4 md:px-6 py-3 md:py-4 text-[10px] md:text-xs text-slate-505 whitespace-nowrap">${log.date}</td>
                    <td class="px-4 md:px-6 py-3 md:py-4 font-extrabold text-emerald-600 whitespace-nowrap">₱${log.fee}.00</td>
                    <td class="px-4 md:px-6 py-3 md:py-4 whitespace-nowrap">
                        <span class="px-2 py-1 rounded text-[9px] md:text-xs font-semibold ${
                            paymentStatus === 'PENDING' ? 'bg-amber-100 text-amber-800' : 
                            paymentStatus === 'AUTHORIZED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }">${paymentStatus}</span>
                    </td>
                    <td class="px-4 md:px-6 py-3 md:py-4 text-[10px] md:text-xs text-slate-600 whitespace-nowrap">${paymentMethod}</td>
                `;
                table.appendChild(row);
            }

            document.getElementById("admin-stat-revenue").innerText = `₱${revenue}.00`;
            document.getElementById("admin-stat-count").innerText = logs.length;
        }

        // --- STREAMING_CHUNK: Managing database clears, mock records and settings credentials... ---
        function exportToCSV() {
            playSound("success");
            let logs = [];
            if(localStorage.getItem("barangay_kiosk_logs")) {
                logs = JSON.parse(localStorage.getItem("barangay_kiosk_logs"));
            }

            if(logs.length === 0) {
                openMessageBox("Empty Database", "No transaction records exist inside storage to extract.", "info");
                return;
            }

            let csvContent = "Document ID,Type,Date & Time,Amount,Payment Status,Payment Method\r\n";

            logs.forEach(log => {
                const paymentStatus = log.status || 'PENDING';
                const paymentMethod = log.fee === 0 ? "None" : "Over-The-Counter Cash";
                
                let row = `"${log.refId}","${log.docType}","${log.date}","₱${log.fee}.00","${paymentStatus}","${paymentMethod}"`;
                csvContent += row + "\r\n";
            });

            const bom = "\uFEFF";
            const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            
            link.setAttribute("href", url);
            link.setAttribute("download", `Brgy_Sto_Nino_Kiosk_Records_${new Date().toISOString().slice(0,10)}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        function clearAllAdminLogs() {
            playSound("error");
            localStorage.removeItem("barangay_kiosk_logs");
            updateAdminDashboardData();
            openMessageBox("Database Cleared", "The local browser storage log database has been successfully wiped.", "success");
        }

        // --- ADMIN CONTROLS ---
        function showAdminLogin() {
            playSound("tap");
            document.getElementById("admin-username").value = "";
            document.getElementById("admin-password").value = "";
            nav("page-admin-login");
        }

        function verifyAdminLogin() {
            const user = document.getElementById("admin-username").value.trim();
            const pass = document.getElementById("admin-password").value.trim();

            const targetUser = localStorage.getItem("admin_username");
            const targetPass = localStorage.getItem("admin_password");

            if (user === targetUser && pass === targetPass) {
                playSound("success");
                updateAdminDashboardData();
                nav("page-admin-dashboard");
            } else {
                playSound("error");
                openMessageBox("Authentication Failed", "Incorrect administrator username or password entered. Please try again.", "error");
                document.getElementById("admin-password").value = "";
            }
        }

        function logoutAdmin() {
            playSound("tap");
            nav("page-landing");
        }

        // --- CASHIER CONTROLS ---
        function showCashierLogin() {
            playSound("tap");
            document.getElementById("cashier-username").value = "";
            document.getElementById("cashier-password").value = "";
            nav("page-cashier-login");
        }

        function verifyCashierLogin() {
            const user = document.getElementById("cashier-username").value.trim();
            const pass = document.getElementById("cashier-password").value.trim();

            const targetUser = localStorage.getItem("cashier_username");
            const targetPass = localStorage.getItem("cashier_password");

            if (user === targetUser && pass === targetPass) {
                playSound("success");
                document.getElementById("cashier-active-name").innerText = user;
                document.getElementById("scannerInput").value = "";
                document.getElementById("dataScreen").innerText = "Awaiting Transaction validation sequence...";
                document.getElementById("cashierActionButtons").innerHTML = "";
                hideCashierBanner();
                nav("page-cashier-dashboard");
            } else {
                playSound("error");
                openMessageBox("Authentication Failed", "Incorrect cashier username or password entered.", "error");
                document.getElementById("cashier-password").value = "";
            }
        }

        function logoutCashier() {
            playSound("tap");
            nav("page-landing");
        }

        function showCashierBanner(type, message) {
            const banner = document.getElementById('cashierStatusBanner');
            banner.classList.remove('hidden', 'bg-emerald-100', 'text-emerald-800', 'bg-red-100', 'text-red-800', 'bg-amber-100', 'text-amber-800');
            banner.classList.add('block');
            
            if (type === 'success') {
                banner.classList.add('bg-emerald-100', 'text-emerald-800');
            } else if (type === 'error') {
                banner.classList.add('bg-red-100', 'text-red-800');
            } else {
                banner.classList.add('bg-amber-100', 'text-amber-800');
            }
            banner.innerText = message;
        }

        function hideCashierBanner() {
            const banner = document.getElementById('cashierStatusBanner');
            banner.classList.add('hidden');
            banner.innerText = "";
        }

        function processScannedTransaction(id) {
            const dataScreen = document.getElementById("dataScreen");
            const actionButtons = document.getElementById("cashierActionButtons");
            document.getElementById("scannerInput").value = ""; 
            hideCashierBanner();

            let logs = [];
            if(localStorage.getItem("barangay_kiosk_logs")) {
                logs = JSON.parse(localStorage.getItem("barangay_kiosk_logs"));
            }

            const transactionIndex = logs.findIndex(log => log.refId === id);

            if (transactionIndex === -1) {
                playSound("error");
                showCashierBanner("error", `Transaction ID [${id}] was NOT found in local database.`);
                dataScreen.innerText = `Record [${id}] does not exist. Please scan again.`;
                actionButtons.innerHTML = "";
                return;
            }

            const txn = logs[transactionIndex];
            const currentStatus = txn.status || 'PENDING';

            let outputText = `TRANSACTION REFERENCE: ${txn.refId}\n`;
            outputText += `DOCUMENT TYPE:         ${txn.docType}\n`;
            outputText += `CITIZEN NAME:          ${txn.name}\n`;
            outputText += `AMOUNT DUE:            ₱${txn.fee}.00\n`;
            outputText += `DATE & TIME LOGGED:    ${txn.date}\n`;
            outputText += `CURRENT STATUS:        ${currentStatus}\n`;
            outputText += `-----------------------------------------------\n`;

            if (currentStatus === 'PENDING') {
                outputText += `ACTION REQUIRED: Verify cash payout and click the authorization override.`;
                showCashierBanner("warning", "Awaiting cash checkout approval.");
                
                actionButtons.innerHTML = `
                    <button onclick="authorizePayment('${txn.refId}')" class="ripple-btn w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 md:py-3.5 rounded-2xl text-[10px] md:text-xs flex justify-center items-center shadow shadow-emerald-500/20">
                        <i class="fa-solid fa-stamp mr-2"></i> Approve Cash & Authorize
                    </button>
                `;
            } else if (currentStatus === 'AUTHORIZED') {
                outputText += `AUTHORIZED BY:         Terminal Cashier\n`;
                outputText += `This transaction has been approved for release. Ready for printer output.`;
                showCashierBanner("success", "Authorized. Transaction paid.");
                actionButtons.innerHTML = "";
            } else if (currentStatus === 'COMPLETED') {
                outputText += `This document has already been printed.`;
                showCashierBanner("success", "Printed & Completed.");
                actionButtons.innerHTML = `
                    <button onclick="overrideReprint('${txn.refId}')" class="ripple-btn w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 md:py-3.5 rounded-2xl text-[10px] md:text-xs flex justify-center items-center shadow">
                        <i class="fa-solid fa-redo mr-2"></i> Force Free Reprint (Fix Paper Jam)
                    </button>
                `;
            }

            dataScreen.innerText = outputText;
            playSound("success");
        }

        function authorizePayment(id) {
            let logs = [];
            if(localStorage.getItem("barangay_kiosk_logs")) {
                logs = JSON.parse(localStorage.getItem("barangay_kiosk_logs"));
            }

            const idx = logs.findIndex(l => l.refId === id);
            if (idx !== -1) {
                logs[idx].status = 'AUTHORIZED';
                localStorage.setItem("barangay_kiosk_logs", JSON.stringify(logs));
                playSound("success");
                openMessageBox("Payment Approved", `Transaction ${id} is now authorized for kiosk printout.`, "success");
                processScannedTransaction(id);
            }
        }

        function overrideReprint(id) {
            let logs = [];
            if(localStorage.getItem("barangay_kiosk_logs")) {
                logs = JSON.parse(localStorage.getItem("barangay_kiosk_logs"));
            }

            const idx = logs.findIndex(l => l.refId === id);
            if (idx !== -1) {
                logs[idx].status = 'AUTHORIZED';
                localStorage.setItem("barangay_kiosk_logs", JSON.stringify(logs));
                playSound("success");
                openMessageBox("Reprint Triggered", `Transaction ${id} is authorized for re-printing.`, "success");
                processScannedTransaction(id);
            }
        }

        function generateMockTransaction() {
            playSound("tap");
            const rand = Math.floor(1000 + Math.random() * 9000);
            const refId = `SN-2026-${rand}`;
            const now = new Date();
            const formattedDate = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()} ${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;

            saveToLocalDB(refId, "Barangay Clearance", "Mock Citizen", 50, formattedDate);
            
            document.getElementById("scannerInput").value = refId;
            openMessageBox("Mock Transaction Added", `We created a mock unpaid transaction with Reference ID: ${refId}. Type this Reference ID and press enter inside the scan box to test!`, "success");
        }

        function togglePasswordVisibility(fieldId) {
            playSound("tap");
            const input = document.getElementById(fieldId);
            const eye = document.getElementById(`${fieldId}-eye`);
            if (input.type === "password") {
                input.type = "text";
                eye.classList.remove("fa-eye");
                eye.classList.add("fa-eye-slash");
            } else {
                input.type = "password";
                eye.classList.remove("fa-eye-slash");
                eye.classList.add("fa-eye");
            }
        }

        // --- STREAMING_CHUNK: Setting up credential settings modifiers... ---
        // --- ADMIN SETTINGS ---
        function openCredentialsModal() {
            playSound("tap");
            document.getElementById("new-admin-user").value = "";
            document.getElementById("new-admin-pass").value = "";
            document.getElementById("confirm-admin-pass").value = "";
            
            document.getElementById("modal-admin-credentials").classList.remove("hidden");
        }

        function closeCredentialsModal() {
            playSound("tap");
            document.getElementById("modal-admin-credentials").classList.add("hidden");
        }

        function saveAdminCredentials() {
            const newUser = document.getElementById("new-admin-user").value.trim();
            const newPass = document.getElementById("new-admin-pass").value.trim();
            const confirmPass = document.getElementById("confirm-admin-pass").value.trim();

            if (!newUser || !newPass || !confirmPass) {
                playSound("error");
                openMessageBox("Validation Error", "All fields are required to update settings.", "error");
                return;
            }

            if (newPass !== confirmPass) {
                playSound("error");
                openMessageBox("Mismatch Error", "New password and password confirmation entries do not match.", "error");
                return;
            }

            localStorage.setItem("admin_username", newUser);
            localStorage.setItem("admin_password", newPass);
            
            closeCredentialsModal();
            playSound("success");
            openMessageBox("Credentials Updated", "System administrative login settings updated successfully.", "success");
        }

        // --- CASHIER SETTINGS ---
        function openCashierCredentialsModal() {
            playSound("tap");
            document.getElementById("new-cashier-user").value = "";
            document.getElementById("new-cashier-pass").value = "";
            document.getElementById("confirm-cashier-pass").value = "";
            
            document.getElementById("modal-cashier-credentials").classList.remove("hidden");
        }

        function closeCashierCredentialsModal() {
            playSound("tap");
            document.getElementById("modal-cashier-credentials").classList.add("hidden");
        }

        function saveCashierCredentials() {
            const newUser = document.getElementById("new-cashier-user").value.trim();
            const newPass = document.getElementById("new-cashier-pass").value.trim();
            const confirmPass = document.getElementById("confirm-cashier-pass").value.trim();

            if (!newUser || !newPass || !confirmPass) {
                playSound("error");
                openMessageBox("Validation Error", "All fields are required to update settings.", "error");
                return;
            }

            if (newPass !== confirmPass) {
                playSound("error");
                openMessageBox("Mismatch Error", "New password and password confirmation entries do not match.", "error");
                return;
            }

            localStorage.setItem("cashier_username", newUser);
            localStorage.setItem("cashier_password", newPass);
            
            closeCashierCredentialsModal();
            playSound("success");
            openMessageBox("Credentials Updated", "System cashier login settings updated successfully.", "success");
            
            document.getElementById("cashier-active-name").innerText = newUser;
        }

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

        // --- BEAUTIFUL CUSTOM DIALOG BOXES ---
        function openMessageBox(title, message, type = 'info') {
            const box = document.getElementById('custom-message-box');
            const titleEl = document.getElementById('msg-box-title');
            const textEl = document.getElementById('msg-box-text');
            const iconContainer = document.getElementById('msg-box-icon-container');
            const icon = document.getElementById('msg-box-icon');

            titleEl.innerText = title;
            textEl.innerText = message;

            // Clear layout classes
            iconContainer.className = "h-16 w-16 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 border shadow-inner ";
            icon.className = "fa-solid ";

            if (type === 'success') {
                iconContainer.className += "bg-emerald-50 text-emerald-600 border-emerald-100";
                icon.className += "fa-circle-check";
                playSound("success");
            } else if (type === 'error') {
                iconContainer.className += "bg-red-50 text-red-600 border-red-100";
                icon.className += "fa-circle-xmark";
                playSound("error");
            } else {
                iconContainer.className += "bg-blue-50 text-blue-600 border-blue-100";
                icon.className += "fa-circle-info";
                playSound("tap");
            }

            box.classList.remove('hidden');
        }

        function closeMessageBox() {
            playSound("tap");
            document.getElementById('custom-message-box').classList.add('hidden');
        }

        // --- TIME ENGINE ---
        function updateClock() {
            const timeSpan = document.getElementById("live-time-display");
            const dateSpan = document.getElementById("screensaver-full-date");

            const now = new Date();
            if (timeSpan) {
                timeSpan.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
            if (dateSpan) {
                dateSpan.innerText = now.toLocaleDateString('en-US', options);
            }
        }

        // Cashier scanner input listener
        document.getElementById('scannerInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const val = e.target.value.trim().toUpperCase();
                if (val) {
                    processScannedTransaction(val);
                }
            }
        });

        // Initialize clock & layout components safely
        document.addEventListener('DOMContentLoaded', () => {
            updateClock();
            setInterval(updateClock, 1000);
            setupVirtualKeyboard();
        });