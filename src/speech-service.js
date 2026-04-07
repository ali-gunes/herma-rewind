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

// Regex trigger: matches all Whisper distortions of "sipariş"
// Covers: sipariş, siparis, siparış, pariş, parış, paris, paraş, siparıs, parş...
const TRIGGER_REGEX = /\b(si?)?p[ae]?r[ıiae]?[şs]/i;

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

        const recordOptions = {
            sampleRate: this.sampleRate,
            channels: 1,
            audioType: 'raw',
        };

        // Windows RDP specific fixes
        if (os.platform() === 'win32') {
            recordOptions.recordProgram = 'sox';
            // Enable verbose if we still get errors to see the exact sox command
            // recordOptions.verbose = true;
        }

        this.recording = record.record(recordOptions);

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

        this.recording.stream().on('error', (err) => {
            console.error(chalk.bold.red('\n[Mic Error]:'), err.message || err);
            
            if (os.platform() === 'win32') {
                console.log(chalk.yellow('💡 Windows/RDP Troubleshooting:'));
                console.log(chalk.gray('   - Check RDP: Local Resources > Remote Audio > "Record from this computer"'));
                console.log(chalk.gray('   - Ensure SoX is installed and in PATH (try: choco install sox.portable)'));
                console.log(chalk.gray('   - Verify "Remote Audio" is set as default recording device.'));
            }
        });
    }

    stop() {
        if (this.recording) this.recording.stop();
        this._clearActiveTimer();
    }

    // ─── State Machine ────────────────────────────────────────────────────────

    _onSegment(text) {
        const hasTrigger = TRIGGER_REGEX.test(text);

        if (this.state === STATE.PASSIVE) {
            if (hasTrigger) {
                const commandPart = this._stripTrigger(text);
                console.log(chalk.bold.yellow(`\n🔔 Trigger detected in: "${text}"`));
                this._enterActive(commandPart);
            } else {
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
        // Remove the trigger match and any leading punctuation/spaces
        return text.replace(TRIGGER_REGEX, '').replace(/^[\s,.:;]+/, '').trim();
    }

    // Strip punctuation from a single token
    _stripPunct(word) {
        return word.replace(/[.,!?;:'"()\[\]{}\-]+/g, '').trim();
    }

    // Known Turkish number words ordered longest-first (for compound splitting)
    get _numberParts() {
        return [
            'doksan', 'seksen', 'yetmiş', 'altmış', 'elli', 'kırk', 'otuz', 'yirmi',
            'sıfır', 'sekiz', 'yedi', 'dört', 'beş', 'altı', 'üç', 'iki',
            'dokuz', 'bin', 'yüz', 'bir', 'on'
        ];
    }

    // Numeric values of each number word (for arithmetic mode)
    get _numberValues() {
        return {
            'sıfır': 0, 'bir': 1, 'iki': 2, 'üç': 3, 'dört': 4,
            'beş': 5, 'altı': 6, 'yedi': 7, 'sekiz': 8, 'dokuz': 9,
            'on': 10, 'yirmi': 20, 'otuz': 30, 'kırk': 40, 'elli': 50,
            'altmış': 60, 'yetmiş': 70, 'seksen': 80, 'doksan': 90,
            'yüz': 100, 'bin': 1000
        };
    }

    // Single digit map for digit-by-digit mode
    get _singleDigits() {
        return {
            'sıfır': '0', 'bir': '1', 'iki': '2', 'üç': '3', 'dört': '4',
            'beş': '5', 'altı': '6', 'yedi': '7', 'sekiz': '8', 'dokuz': '9'
        };
    }

    // Try to split a compound Turkish number word like "yüzaltı" → ["yüz", "altı"]
    _splitCompoundNumber(word) {
        const parts = this._numberParts;
        const result = [];
        let remaining = word;

        while (remaining.length > 0) {
            let matched = false;
            for (const part of parts) {
                if (remaining.startsWith(part)) {
                    result.push(part);
                    remaining = remaining.slice(part.length);
                    matched = true;
                    break;
                }
            }
            if (!matched) return null; // Not a pure compound number word
        }
        return result.length > 1 ? result : null;
    }

    // Convert a sequence of Turkish number word tokens to a digit string.
    // Handles arithmetic mode ("yüz altı" → "106") and
    // digit-by-digit mode ("bir sıfır altı" → "106")
    _numberSequenceToString(tokens) {
        const values = this._numberValues;
        const singles = this._singleDigits;

        // Detect digit-by-digit mode:
        // 1. Contains "sıfır" (zero only appears when spelling digits)
        // 2. OR all tokens are single-digit words (no tens/hundreds/thousands)
        const allAreSingleDigit = tokens.every(t => singles[t] !== undefined);
        const hasSifir = tokens.includes('sıfır');
        const isDigitByDigit = hasSifir || (allAreSingleDigit && tokens.length > 1);

        if (isDigitByDigit) {
            return tokens.map(t => singles[t] !== undefined ? singles[t] : '?').join('');
        }

        // Arithmetic mode — accumulate with standard Turkish number rules
        // Turkish: "iki yüz on beş" = 2*100 + 10 + 5 = 215
        let total = 0;
        let pending = 0; // digits gathered before a multiplier (yüz, bin)

        for (const token of tokens) {
            const val = values[token];
            if (val === undefined) continue;

            if (val === 1000) {
                const coeff = pending > 0 ? pending : 1;
                total += coeff * 1000;
                pending = 0;
            } else if (val === 100) {
                const coeff = pending > 0 ? pending : 1;
                total += coeff * 100;
                pending = 0;
            } else {
                pending += val;
            }
        }

        total += pending;
        return String(total);
    }

    // Main text processor: strip punct, expand compounds, replace number sequences
    _processText(rawText) {
        // 1. Basic cleanup — lowercase, remove stray punctuation except hyphens between digits
        const cleaned = rawText.toLowerCase().replace(/([^\d])-([^\d])/g, '$1 $2');

        // 2. Split into tokens and strip punctuation from each
        const rawTokens = cleaned.split(/\s+/).map(t => this._stripPunct(t)).filter(Boolean);

        // 3. Expand compound number words (e.g. "yüzaltı" → "yüz", "altı")
        const tokens = [];
        for (const token of rawTokens) {
            const expanded = this._splitCompoundNumber(token);
            if (expanded) {
                tokens.push(...expanded);
            } else {
                tokens.push(token);
            }
        }

        // 4. Replace consecutive number-word runs with their digit equivalents
        const values = this._numberValues;
        const output = [];
        let numRun = [];

        const flushNumRun = () => {
            if (numRun.length > 0) {
                output.push(this._numberSequenceToString(numRun));
                numRun = [];
            }
        };

        for (const token of tokens) {
            if (values[token] !== undefined) {
                numRun.push(token);
            } else {
                flushNumRun();
                output.push(token);
            }
        }
        flushNumRun();

        return output;
    }

    _tryParseCommand(text) {
        // Preprocess: strip punct, expand compounds, convert number words → digits
        const tokens = this._processText(text);

        if (process.env.DEBUG_TOKENS) {
            console.log(chalk.gray(`[Tokens]: ${JSON.stringify(tokens)}`));
        }

        // Apply alpha prefix map
        const words = tokens.map(w => this.alphaMap[w] || w);

        const commandGroups = [];
        let currentIds = [];

        for (const word of words) {
            const wordClean = word.toLowerCase();

            if (this.variations.prepared.some(v => wordClean.includes(v))) {
                if (currentIds.length > 0) {
                    commandGroups.push({ ids: [...currentIds], status: this.statusCodes.prepared });
                    currentIds = [];
                }
            } else if (this.variations.delivered.some(v => wordClean.includes(v))) {
                if (currentIds.length > 0) {
                    commandGroups.push({ ids: [...currentIds], status: this.statusCodes.delivered });
                    currentIds = [];
                }
            } else {
                // Digit string produced by number conversion, or raw numeric literal
                if (/^\d+$/.test(word)) {
                    currentIds.push(word);
                // Only accept a single letter if it's an explicit alpha prefix (A, B, C, D...)
                } else if (word.length === 1 && this.alphaMap && Object.values(this.alphaMap).includes(word.toUpperCase())) {
                    currentIds.push(word.toUpperCase());
                }
            }
        }

        if (commandGroups.length === 0) return false;

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
