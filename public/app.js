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
let isListening = false;
let orders = [];
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

// Speech Recognition Initialization
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = false; // We start/stop per toggle requirement
    recognition.interimResults = true;

    recognition.onstart = () => {
        isListening = true;
        updateUIState();
        addLog('Dinleme başlatıldı...', 'speech');
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
                processTranscript(finalTranscript.toLowerCase(), event.results[i][0].confidence);
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        understoodText.innerText = finalTranscript || interimTranscript;
        understoodText.classList.remove('text-placeholder');
    };

    recognition.onerror = (event) => {
        addLog(`Hata: ${event.error}`, 'error');
        isListening = false;
        updateUIState();
    };

    recognition.onend = () => {
        // If it ends naturally but we're still in "listening" state logic-wise, 
        // the toggle button would need to be clicked again or we auto-restart.
        // The requirement says toggle state triggers it.
        if (isListening) {
            // recognition.start(); // Auto-restart if we want continuous, but toggle is the key here.
        }
        updateUIState();
    };
} else {
    addLog('Web Speech API bu tarayıcıda desteklenmiyor.', 'error');
    btnToggle.disabled = true;
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
    if (isListening) {
        btnToggle.innerText = 'DİNLEMEYİ DURDUR';
        badge.innerText = 'DİNLİYOR...';
        badge.className = 'badge listening';
        indicator.classList.remove('hidden');
        understoodText.classList.remove('text-placeholder');
    } else {
        btnToggle.innerText = 'DİNLEMEYİ BAŞLAT';
        badge.innerText = 'HAZIR';
        badge.className = 'badge idle';
        indicator.classList.add('hidden');
        confidenceScore.classList.add('hidden');
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
        const response = await fetch('/api/order/update-local', {
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
    addLog(`Anlaşılan: "${text}"`, 'speech');
    confidenceScore.innerText = `Güven: ${Math.round(confidence * 100)}%`;
    confidenceScore.classList.remove('hidden');

    // Clean text and handle Turkish number words
    let words = text.split(' ');
    let processedWords = words.map(word => {
        // Handle numbers spoken as words
        if (numberMap[word]) return numberMap[word];
        // Handle alpha variations (Ankara -> A)
        if (alphaMap[word]) return alphaMap[word];
        return word;
    });

    // Detect target status and order IDs
    // Example: "1001 1002 hazır 1003 teslim"
    let commandGroups = [];
    let currentIds = [];

    processedWords.forEach(word => {
        // Is it a variation for "Hazır" (30)?
        if (variations.prepared.some(v => word.includes(v))) {
            if (currentIds.length > 0) {
                commandGroups.push({ ids: [...currentIds], status: statusCodes.prepared });
                currentIds = [];
            }
        }
        // Is it a variation for "Teslim" (40)?
        else if (variations.delivered.some(v => word.includes(v))) {
            if (currentIds.length > 0) {
                commandGroups.push({ ids: [...currentIds], status: statusCodes.delivered });
                currentIds = [];
            }
        }
        // Is it an ID? (contains digits or matches an existing order starting character)
        else if (/\d/.test(word) || word.length === 1 || orders.some(o => o.id.startsWith(word.toUpperCase()))) {
            // Join parts if it's "A 1017" or similar
            let id = word.toUpperCase();
            // Simple heuristic for alpha-numeric pairs like "A" then "1017"
            if (currentIds.length > 0 && currentIds[currentIds.length - 1].length === 1 && !/\d/.test(currentIds[currentIds.length - 1])) {
                currentIds[currentIds.length - 1] += `-${id}`;
            } else {
                currentIds.push(id);
            }
        }
    });

    if (commandGroups.length === 0) {
        // Check if any loose IDs were at the end without a trailing status word
        // The requirement says "1001 1002 hazır" - the status word comes after.
        // Handle "Ankara 1017 hazır" -> "A-1017 hazır"
        speak("Anlayamadım");
    } else {
        commandGroups.forEach(group => {
            group.ids.forEach(id => {
                // Try exact match or dash variations
                let matchedOrder = orders.find(o => o.id === id || o.id === id.replace(' ', '-') || o.id === id.replace(/([A-Z])(\d+)/, '$1-$2'));
                if (matchedOrder) {
                    updateOrderStatus(matchedOrder.id, group.status);
                } else {
                    // Try one more: maybe the ID in the system is A-1017 and user said A 1017
                    let fallbackId = id.includes('-') ? id : (id.length > 1 && !id.includes('-') && isNaN(id) ? id.replace(/([A-Z])(\d+)/, '$1-$2') : id);
                    updateOrderStatus(fallbackId, group.status);
                }
            });
        });
    }
}

// Event Listeners
btnToggle.addEventListener('click', async () => {
    try {
        const response = await fetch('/api/listen/toggle', { method: 'POST' });
        const data = await response.json();

        if (data.isListening) {
            recognition.start();
        } else {
            recognition.stop();
        }
    } catch (err) {
        console.error('Toggle error:', err);
    }
});

// Polling for new orders (since we don't have WebSockets setup for this simple task)
setInterval(fetchOrders, 3000);

// Initial Load
fetchOrders();
addLog('Sipariş listesi yüklendi.');
