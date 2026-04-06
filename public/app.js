// DOM Elements
const btnToggle = document.getElementById('toggle-listen');
const badge = document.getElementById('status-badge');
const indicator = document.getElementById('listening-indicator');
const understoodText = document.getElementById('understood-text');
const confidenceScore = document.getElementById('confidence-score');
const logsContainer = document.getElementById('logs');
const lists = {
    20: document.getElementById('list-20'),
    30: document.getElementById('list-30'),
    40: document.getElementById('list-40')
};

// Configuration & State
const STATES = {
    IDLE: 'idle',
    PASSIVE: 'passive',
    ACTIVE: 'active'
};

let currentState = STATES.IDLE;
let orders = [];
let activeTimer = null;
const statusCodes = {
    preparing: 20,
    prepared: 30,
    delivered: 40
};

// Variations for matching
const variations = {
    prepared: ['hazır', 'hazırlandı', 'tamam', 'ok'],
    delivered: ['teslim', 'edildi', 'teslimedildi', 'gönderildi', 'çıktı']
};

// Turkish number maps
const numberMap = {
    'sıfır': '0', 'bir': '1', 'iki': '2', 'üç': '3', 'dört': '4',
    'beş': '5', 'altı': '6', 'yedi': '7', 'sekiz': '8', 'dokuz': '9',
    'on': '10', 'yirmi': '20', 'otuz': '30', 'kırk': '40', 'elli': '50',
    'altmış': '60', 'yetmiş': '70', 'seksen': '80', 'doksan': '90',
    'yüz': '100', 'bin': '1000'
};

const alphaMap = {
    'ankara': 'A', 'bursa': 'B', 'ceyhan': 'C', 'denizli': 'D'
};

// Wake Word Variations (ordered by specificity)
const wakeWords = [
    'sipariş', 'siparis', 'hey herma', 'hey harma', 'hey arma', 'hey erma',
    'ey herma', 'ey harma', 'ey arma', 'ey erma',
    'selam herma', 'tamam herma', 'hey helma',
    'herma', 'harma', 'arma', 'erma'
];

// Audio Context for Chime
let audioCtx = null;
function playChime() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
    osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.1); // E6

    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

// Speech Recognition Initialization
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        addLog(`Sistem ${currentState.toUpperCase()} modunda.`, 'system');
        updateUIState();
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript.toLowerCase().trim();
            const isFinal = event.results[i].isFinal;

            if (isFinal) {
                finalTranscript = transcript;
                console.log(`[Final] ${finalTranscript}`);

                if (currentState === STATES.PASSIVE) {
                    const remainder = checkWakeWord(finalTranscript);
                    if (remainder && remainder.length > 0) {
                        addLog(`Hızlı Komut: "${remainder}"`, 'speech');
                        processTranscript(remainder, event.results[i][0].confidence);
                        transitionTo(STATES.PASSIVE);
                    }
                } else if (currentState === STATES.ACTIVE) {
                    // Check if this final transcript is just the wake word that triggered us
                    const isJustWakeWord = wakeWords.some(ww => transcript === ww);
                    if (isJustWakeWord) {
                        console.log(`[Active] Wake word ignored in active mode.`);
                    } else {
                        processTranscript(finalTranscript, event.results[i][0].confidence);
                        transitionTo(STATES.PASSIVE);
                    }
                }
            } else {
                interimTranscript = transcript;
                if (currentState === STATES.PASSIVE) {
                    checkWakeWord(interimTranscript);
                }
            }
        }

        understoodText.innerText = finalTranscript || interimTranscript || (currentState === STATES.PASSIVE ? '...' : 'Dinliyorum...');
        understoodText.classList.remove('text-placeholder');
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
            addLog('Mikrofon erişimi engellendi. Lütfen izin verin.', 'error');
            transitionTo(STATES.IDLE);
        } else if (event.error !== 'no-speech') {
            addLog(`Hata: ${event.error}`, 'error');
        }
    };

    recognition.onend = () => {
        // Auto-restart if we are supposed to be listening
        if (currentState !== STATES.IDLE) {
            try {
                recognition.start();
            } catch (e) {
                // Already started or other error
            }
        } else {
            updateUIState();
            addLog('Dinleme durduruldu.', 'system');
        }
    };
} else {
    addLog('Web Speech API bu tarayıcıda desteklenmiyor.', 'error');
    btnToggle.disabled = true;
}

function checkWakeWord(text) {
    for (const ww of wakeWords) {
        if (text.includes(ww)) {
            const index = text.indexOf(ww);
            const remainder = text.substring(index + ww.length).trim();
            addLog(`Uyandırma kelimesi algılandı: "${ww}"`, 'match');
            transitionTo(STATES.ACTIVE);
            return remainder;
        }
    }
    return null;
}

function transitionTo(newState) {
    if (currentState === newState) return;

    console.log(`[State Transition] ${currentState} -> ${newState}`);
    addLog(`Durum: ${newState.toUpperCase()}`, 'system');

    // Cleanup old state
    if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = null;
    }

    currentState = newState;
    updateUIState();

    if (newState === STATES.ACTIVE) {
        playChime();
        // Set timeout to go back to passive if no command received
        activeTimer = setTimeout(() => {
            if (currentState === STATES.ACTIVE) {
                addLog('Zaman aşımı: Komut alınamadı.', 'system');
                transitionTo(STATES.PASSIVE);
            }
        }, 7000); // 7 seconds timeout
    }
}

// Functions
function addLog(message, type = 'system') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.innerText = `[${time}] ${message}`;
    logsContainer.prepend(entry);
}

function updateUIState() {
    badge.className = 'badge';

    if (currentState === STATES.IDLE) {
        btnToggle.innerText = 'DİNLEMEYİ BAŞLAT';
        badge.innerText = 'KAPALI';
        badge.classList.add('idle');
        indicator.classList.add('hidden');
        understoodText.innerText = '... Mikrofonu açmak için butona basın ...';
        understoodText.classList.add('text-placeholder');
    } else if (currentState === STATES.PASSIVE) {
        btnToggle.innerText = 'DİNLEMEYİ DURDUR';
        badge.innerText = 'BEKLİYOR (Hey Herma)';
        badge.classList.add('passive');
        indicator.classList.add('hidden');
        understoodText.innerText = 'Sizi dinliyorum... ("Hey Herma" deyin)';
        understoodText.classList.add('text-placeholder');
    } else if (currentState === STATES.ACTIVE) {
        btnToggle.innerText = 'DİNLEMEYİ DURDUR';
        badge.innerText = 'DİNLİYOR...';
        badge.classList.add('active');
        indicator.classList.remove('hidden');
    }
}

async function fetchOrders() {
    try {
        const response = await fetch('/api/orders');
        orders = await response.json();
        renderOrders();
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

function renderOrders() {
    // Clear lists
    Object.values(lists).forEach(list => list.innerHTML = '');

    orders.forEach(order => {
        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="order-id">${order.id}</div>
            <div class="order-meta">Giriş: ${new Date(order.createdAt).toLocaleTimeString()}</div>
        `;
        lists[order.statusCode]?.appendChild(card);
    });
}

async function updateOrderStatus(id, statusCode) {
    try {
        const response = await fetch('/api/orders/update-local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, statusCode })
        });
        const result = await response.json();
        if (result.success) {
            addLog(`Sipariş ${id} durumu güncellendi: ${result.order.status}`, 'match');
            speak(`Sipariş ${id} ${result.order.status}`);
            fetchOrders();
        } else {
            addLog(`Sipariş ${id} bulunamadı.`, 'error');
            speak("Anlayamadım");
        }
    } catch (err) {
        addLog(`Güncelleme hatası: ${err.message}`, 'error');
    }
}

function speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'tr-TR';
    window.speechSynthesis.speak(utterance);
}

// Transcript Processing Logic
function processTranscript(text, confidence) {
    console.log(`[Process] Input: "${text}"`);

    // Strip any leading wake word if present, starting from longest
    let cleanText = text;
    [...wakeWords].sort((a, b) => b.length - a.length).forEach(ww => {
        if (cleanText.startsWith(ww)) {
            cleanText = cleanText.replace(ww, '').trim();
        }
    });

    if (!cleanText) {
        console.log(`[Process] Empty after stripping.`);
        return;
    }

    addLog(`Komut: "${cleanText}"`, 'speech');
    confidenceScore.innerText = `Güven: ${Math.round(confidence * 100)}%`;
    confidenceScore.classList.remove('hidden');

    // Clean text: Handle "1.005" -> "1005" and other STT artifacts
    let processedText = cleanText.replace(/(\d)\.(\d)/g, '$1$2'); // 1.005 -> 1005
    processedText = processedText.replace(/[.,?!]/g, ' ').replace(/\s+/g, ' ').trim();

    let words = processedText.split(/\s+/);
    let mappedTokens = words.map(word => {
        if (numberMap[word]) return numberMap[word];
        if (alphaMap[word]) return alphaMap[word];
        return word;
    });

    let commandGroups = [];
    let currentIds = [];

    // Smart Accumulator: Join consecutive digits/letters that likely form one ID
    let currentIdAccumulator = "";

    mappedTokens.forEach((token, index) => {
        const isPrepared = variations.prepared.some(v => token.includes(v));
        const isDelivered = variations.delivered.some(v => token.includes(v));
        const isStatus = isPrepared || isDelivered;

        if (isStatus) {
            // If we have an accumulated ID, push it before processing the status
            if (currentIdAccumulator) {
                currentIds.push(currentIdAccumulator);
                currentIdAccumulator = "";
            }

            if (currentIds.length > 0) {
                commandGroups.push({ 
                    ids: [...currentIds], 
                    status: isPrepared ? statusCodes.prepared : statusCodes.delivered 
                });
                currentIds = [];
            }
        } 
        else {
            // Logic to decide if we should join or start a new ID
            // 1. If it's a single digit (0-9) or a single letter, it's likely a part of the current ID being built
            // 2. If it's a multi-digit number, it could be a whole ID or a part
            let isNumeric = /^\d+$/.test(token);
            let isSingleChar = token.length === 1;

            if (isNumeric || (isSingleChar && /[a-z]/i.test(token))) {
                // If the token is a single digit, we always join it to the current build
                if (token.length === 1 && isNumeric) {
                    currentIdAccumulator += token;
                } 
                // If it's a multi-digit number (like 1005 from "1.005"), it completes any builder or becomes the builder
                else {
                    if (currentIdAccumulator) {
                        currentIdAccumulator += token;
                    } else {
                        currentIdAccumulator = token;
                    }
                }
            } 
            else {
                // It's some other word, break the accumulator if it exists
                if (currentIdAccumulator) {
                    currentIds.push(currentIdAccumulator);
                    currentIdAccumulator = "";
                }
            }
        }
    });

    // Final push if something remains
    if (currentIdAccumulator) currentIds.push(currentIdAccumulator);

    if (commandGroups.length === 0 && currentIds.length > 0) {
        // Fallback for cases like "A 101" without "hazır" (if the user stops speaking)
        // We'll assume the last status was intended or just log it
        addLog(`Eşleşme bekleniyor: ${currentIds.join(', ')}`, 'system');
    } else {
        commandGroups.forEach(group => {
            group.ids.forEach(spokenId => {
                // FUZZY MATCHING LOGIC
                // 1. Exact match
                let targetOrder = orders.find(o => o.id.toUpperCase() === spokenId.toUpperCase());
                
                // 2. Dash variation
                if (!targetOrder) {
                    targetOrder = orders.find(o => o.id.replace('-', '').toUpperCase() === spokenId.toUpperCase());
                }

                // 3. Numeric part match
                if (!targetOrder) {
                    targetOrder = orders.find(o => {
                        let orderNumeric = o.id.match(/\d+/);
                        return orderNumeric && orderNumeric[0] === spokenId;
                    });
                }

                if (targetOrder) {
                    updateOrderStatus(targetOrder.id, group.status);
                } else {
                    addLog(`Eşleşme bulunamadı: ${spokenId}`, 'error');
                    speak("Anlayamadım");
                }
            });
        });
    }
}

// Event Listeners
btnToggle.addEventListener('click', async () => {
    if (currentState === STATES.IDLE) {
        // Initialize AudioContext on first interaction
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        transitionTo(STATES.PASSIVE);
        try {
            recognition.start();
        } catch (e) {
            console.log('Recognition already started');
        }
    } else {
        transitionTo(STATES.IDLE);
        recognition.stop();
    }

    // Notify server (optional, keeping for log consistency)
    fetch('/api/listen/toggle', { method: 'POST' }).catch(err => console.error(err));
});

// Auto-start attempt on load (might be blocked by browser)
window.addEventListener('DOMContentLoaded', () => {
    addLog('Herma Rewind Başlatıldı. Wake-word için butona basın.');
    // We can't start mic without interaction, but we can try to resume if already allowed
    // For now, we'll wait for the first click on the UI.
});

// Global interaction listener to unlock AudioContext and start recognition
window.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    // Auto-start if IDLE
    if (currentState === STATES.IDLE) {
        addLog('Etkileşim algılandı. Sesli asistan başlatılıyor...', 'system');

        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        transitionTo(STATES.PASSIVE);
        try {
            recognition.start();
        } catch (e) {
            console.log('Recognition already started');
        }
    }
}, { once: true });

// Polling for new orders (since we don't have WebSockets setup for this simple task)
setInterval(fetchOrders, 3000);

// Initial Load
fetchOrders();
addLog('Sipariş listesi yüklendi.');
