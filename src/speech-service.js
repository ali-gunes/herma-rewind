const sherpa_onnx = require('sherpa-onnx');
const record = require('node-record-lpcm16');
const chalk = require('chalk');
const say = require('say');
const os = require('os');
const { exec } = require('child_process');

// ─── State Machine ────────────────────────────────────────────────────────────
const STATE = {
    PASSIVE: 'PASSIVE',   // listening only for trigger word
    ACTIVE: 'ACTIVE',    // trigger heard, collecting command (5s window)
};

// Trigger word variations (covers common Whisper transcription variations)
const TRIGGER_WORDS = ['sipariş', 'siparis', 'siparış', 'sipariş,', 'siparişi', 'paris', 'pariş', 'paraş'];

// How long to wait for a command after trigger (ms)
const ACTIVE_TIMEOUT_MS = 5000;

class SpeechService {
    constructor(updateCallback) {
        this.updateCallback = updateCallback;
        this.recording = null;
        this.recognizer = null;
        this.vad = null;

        // State machine
        this.state = STATE.PASSIVE;
        this.activeTimer = null;          // timeout handle for active window
        this.commandBuffer = '';          // accumulates transcripts in ACTIVE mode

        // Configuration
        this.sampleRate = 16000;
        this.modelDir = 'whisper-tiny';

        // Turkish variation and mapping logic
        this.statusCodes = { preparing: 20, prepared: 30, delivered: 40 };
        this.variations = {
            prepared: ['hazır', 'hazırlandı', 'tamam', 'ok', 'bekleyen', 'bekliyor'],
            delivered: ['teslim', 'edildi', 'teslimedildi', 'gönderildi', 'çıktı']
        };
        this.numberMap = {
            'sıfır': '0', 'bir': '1', 'iki': '2', 'üç': '3', 'dört': '4',
            'beş': '5', 'altı': '6', 'yedi': '7', 'sekiz': '8', 'dokuz': '9',
            'on': '10', 'yirmi': '20', 'otuz': '30', 'kırk': '40', 'elli': '50',
            'altmış': '60', 'yetmiş': '70', 'seksen': '80', 'doksan': '90',
            'yüz': '100', 'bin': '1000'
        };
        this.alphaMap = { 'ankara': 'A', 'bursa': 'B', 'ceyhan': 'C', 'denizli': 'D' };
    }

    // ─── Initialization ───────────────────────────────────────────────────────

    init() {
        console.log(chalk.blue('🚀 Initializing Sherpa-ONNX Whisper Engine...'));

        try {
            this.recognizer = sherpa_onnx.createOfflineRecognizer({
                modelConfig: {
                    tokens: `${this.modelDir}/tiny-tokens.txt`,
                    whisper: {
                        encoder: `${this.modelDir}/tiny-encoder.int8.onnx`,
                        decoder: `${this.modelDir}/tiny-decoder.int8.onnx`,
                        language: 'tr',
                        task: 'transcribe',
                        tailPaddings: -1,
                    },
                    numThreads: 1,
                    debug: false,
                },
            });

            this.vad = sherpa_onnx.createVad({
                sileroVad: {
                    model: `${this.modelDir}/silero_vad.onnx`,
                    threshold: 0.5,
                    minSilenceDuration: 0.5,
                    minSpeechDuration: 0.25,
                    windowSize: 512,
                },
                sampleRate: this.sampleRate,
                numThreads: 1,
            });

            console.log(chalk.green('✅ Speech Engine Ready!'));
            console.log(chalk.gray('   Trigger word: "sipariş" + command'));
            console.log(chalk.gray('   Examples: "Sipariş 1005 hazır" | "Sipariş A-12 teslim edildi"'));
            console.log(chalk.gray(`   Active window: ${ACTIVE_TIMEOUT_MS / 1000}s after trigger\n`));
        } catch (err) {
            console.error(chalk.red('❌ Failed to initialize:'), err.message);
            process.exit(1);
        }
    }

    // ─── Microphone Loop ──────────────────────────────────────────────────────

    start() {
        this._enterPassive();

        this.recording = record.record({
            sampleRate: this.sampleRate,
            channels: 1,
            audioType: 'raw',
        });

        this.recording.stream().on('data', (chunk) => {
            const int16 = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
            const f32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768.0;

            this.vad.acceptWaveform(f32);

            while (!this.vad.isEmpty()) {
                const segment = this.vad.front();
                const stream = this.recognizer.createStream();
                stream.acceptWaveform(this.sampleRate, segment.samples);
                this.recognizer.decode(stream);
                const result = this.recognizer.getResult(stream);
                this.vad.pop();

                if (result.text && result.text.trim()) {
                    this._onSegment(result.text.toLowerCase().trim());
                }
            }
        });

        this.recording.stream().on('error', (err) =>
            console.error(chalk.red('[Mic Error]:'), err.message)
        );
    }

    stop() {
        if (this.recording) this.recording.stop();
        this._clearActiveTimer();
    }

    // ─── State Machine ────────────────────────────────────────────────────────

    _onSegment(text) {
        const hasTrigger = TRIGGER_WORDS.some(t => text.includes(t));

        if (this.state === STATE.PASSIVE) {
            if (hasTrigger) {
                // Strip the trigger word and check if a command follows in same utterance
                const commandPart = this._stripTrigger(text);
                console.log(chalk.bold.yellow('\n🔔 Trigger word detected!'));
                this._enterActive(commandPart);
            } else {
                // Silently ignore — no trigger, no noise in logs
                process.stdout.write(chalk.gray(`[Passive] Ignored: "${text}"\r`));
            }
        } else if (this.state === STATE.ACTIVE) {
            // Append to buffer and try to parse
            this.commandBuffer += ' ' + text;
            console.log(chalk.cyan(`[Active] Heard: "${text}"`));
            const matched = this._tryParseCommand(this.commandBuffer);
            if (matched) {
                this._enterPassive();
            } else {
                // Reset the timeout — they're still speaking
                this._resetActiveTimer();
            }
        }
    }

    _enterPassive() {
        this.state = STATE.PASSIVE;
        this.commandBuffer = '';
        this._clearActiveTimer();
        console.log(chalk.gray('\n👂 [PASSIVE] Listening for "sipariş"...'));
    }

    _enterActive(initialText = '') {
        this.state = STATE.ACTIVE;
        this.commandBuffer = initialText;
        this._playChime();

        if (initialText) {
            console.log(chalk.cyan(`[Active] Initial: "${initialText}"`));
            const matched = this._tryParseCommand(initialText);
            if (matched) {
                // Full command was in the trigger utterance — done
                return;
            }
        }

        console.log(chalk.bold.green('🎙️  Listening for command... (5s window)'));
        this._resetActiveTimer();
    }

    _resetActiveTimer() {
        this._clearActiveTimer();
        this.activeTimer = setTimeout(() => {
            console.log(chalk.red('\n⏱️  Active window timed out — no command received.'));
            this.speak('Anlayamadım');
            this._enterPassive();
        }, ACTIVE_TIMEOUT_MS);
    }

    _clearActiveTimer() {
        if (this.activeTimer) {
            clearTimeout(this.activeTimer);
            this.activeTimer = null;
        }
    }

    // ─── Command Parsing ──────────────────────────────────────────────────────

    _stripTrigger(text) {
        // Remove trigger word and any leading punctuation/spaces
        let result = text;
        for (const t of TRIGGER_WORDS) {
            result = result.replace(t, '');
        }
        return result.replace(/^[\s,.:;]+/, '').trim();
    }

    _tryParseCommand(text) {
        const rawWords = text.trim().split(/\s+/);
        const words = rawWords.map(w => {
            if (this.numberMap[w]) return this.numberMap[w];
            if (this.alphaMap[w]) return this.alphaMap[w];
            return w;
        });

        const commandGroups = [];
        let currentIds = [];

        for (const word of words) {
            if (this.variations.prepared.some(v => word.includes(v))) {
                if (currentIds.length > 0) {
                    commandGroups.push({ ids: [...currentIds], status: this.statusCodes.prepared });
                    currentIds = [];
                }
            } else if (this.variations.delivered.some(v => word.includes(v))) {
                if (currentIds.length > 0) {
                    commandGroups.push({ ids: [...currentIds], status: this.statusCodes.delivered });
                    currentIds = [];
                }
            } else {
                const numMatch = word.match(/\d+/);
                if (numMatch) {
                    currentIds.push(numMatch[0]);
                } else if (word.length === 1 && /[A-Z]/i.test(word)) {
                    currentIds.push(word.toUpperCase());
                }
            }
        }

        if (commandGroups.length === 0) return false;

        // We have groups — dispatch callbacks
        commandGroups.forEach(group => {
            group.ids.forEach(id => this.updateCallback(id, group.status));
        });

        return true;
    }

    // ─── Audio Feedback ───────────────────────────────────────────────────────

    _playChime() {
        if (os.platform() === 'win32') {
            // Windows: use PowerShell beep
            exec('powershell -Command "[console]::beep(880,150)"');
        } else {
            // Mac/Linux: play system Tink sound
            exec('afplay /System/Library/Sounds/Tink.aiff 2>/dev/null || true');
        }
    }

    speak(text) {
        process.stdout.write(chalk.magenta(`[TTS]: "${text}"\n`));
        if (os.platform() === 'win32') {
            const ps = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text}')`;
            exec(`powershell -Command "${ps}"`);
        } else {
            say.speak(text, 'Yelda');
        }
    }
}

module.exports = SpeechService;
