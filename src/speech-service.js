const sherpa_onnx = require('sherpa-onnx');
const record = require('node-record-lpcm16');
const chalk = require('chalk');
const say = require('say');
const os = require('os');
const { exec } = require('child_process');

class SpeechService {
    constructor(updateCallback) {
        this.updateCallback = updateCallback;
        this.isListening = false;
        this.recognizer = null;
        this.vad = null;
        this.recording = null;

        // Configuration
        this.sampleRate = 16000;
        this.modelDir = 'whisper-tiny';
        
        // Turkish variation and mapping logic
        this.statusCodes = { preparing: 20, prepared: 30, delivered: 40 };
        this.variations = {
            prepared: ['hazır', 'hazırlandı', 'tamam', 'ok'],
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

    init() {
        console.log(chalk.blue('🚀 Initializing Sherpa-ONNX Whisper Engine...'));
        
        try {
            // Initialize Offline Recognizer (Whisper int8 - WASM compatible)
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

            // Initialize VAD (Silero)
            this.vad = sherpa_onnx.createVad({
                sileroVad: {
                    model: `${this.modelDir}/silero_vad.onnx`,
                    threshold: 0.5,
                    minSilenceDuration: 0.5,
                    minSpeechDuration: 0.2,
                    windowSize: 512,
                },
                sampleRate: this.sampleRate,
                numThreads: 1,
            });

            console.log(chalk.green('✅ Speech Engine Ready!'));
        } catch (err) {
            console.error(chalk.red('❌ Failed to initialize speech engine:'), err.message);
            process.exit(1);
        }
    }

    start() {
        if (this.isListening) return;
        this.isListening = true;
        console.log(chalk.yellow('\n🎤 Microphone active. Speak Turkish commands (e.g., "A-123 Hazır"):'));

        this.recording = record.record({
            sampleRate: this.sampleRate,
            channels: 1,
            audioType: 'raw',
        });

        this.recording.stream().on('data', (chunk) => {
            // Convert Buffer to Float32Array
            const int16Array = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
            const float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
            }

            // Let VAD process the buffer
            this.vad.acceptWaveform(float32Array);

            // Check if segments are completed
            while (!this.vad.isEmpty()) {
                const segment = this.vad.front();
                const samples = segment.samples;
                
                // Decode speech segment
                const stream = this.recognizer.createStream();
                stream.acceptWaveform(this.sampleRate, samples);
                this.recognizer.decode(stream);
                const result = this.recognizer.getResult(stream);
                
                if (result.text && result.text.trim()) {
                    this.handleTranscript(result.text.toLowerCase());
                }
                
                this.vad.pop();
            }
        });

        this.recording.stream().on('error', (err) => {
            console.error(chalk.red('Mic error:'), err);
        });
    }

    stop() {
        this.isListening = false;
        if (this.recording) {
            this.recording.stop();
        }
    }

    handleTranscript(text) {
        process.stdout.write(chalk.cyan(`\r[Heard]: "${text}"                                \n`));
        
        let rawWords = text.trim().split(/\s+/);
        let processedWords = rawWords.map(word => {
            if (this.numberMap[word]) return this.numberMap[word];
            if (this.alphaMap[word]) return this.alphaMap[word];
            return word;
        });

        let commandGroups = [];
        let currentIds = [];

        processedWords.forEach(word => {
            if (this.variations.prepared.some(v => word.includes(v))) {
                if (currentIds.length > 0) {
                    commandGroups.push({ ids: [...currentIds], status: this.statusCodes.prepared });
                    currentIds = [];
                }
            }
            else if (this.variations.delivered.some(v => word.includes(v))) {
                if (currentIds.length > 0) {
                    commandGroups.push({ ids: [...currentIds], status: this.statusCodes.delivered });
                    currentIds = [];
                }
            }
            else {
                let match = word.match(/\d+/);
                if (match) {
                    currentIds.push(match[0]);
                } else if (word.length === 1 && /[A-Z]/i.test(word)) {
                    currentIds.push(word.toUpperCase());
                }
            }
        });

        if (commandGroups.length > 0) {
            commandGroups.forEach(group => {
                group.ids.forEach(spokenId => {
                    this.updateCallback(spokenId, group.status);
                });
            });
        }
    }

    speak(text) {
        process.stdout.write(chalk.magenta(`[Speak]: ${text}\n`));
        if (os.platform() === 'win32') {
            const psCommand = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text}')`;
            exec(`powershell -Command "${psCommand}"`);
        } else {
            say.speak(text, 'Yelda'); // Fallback to Yelda or default Turkish voice
        }
    }
}

module.exports = SpeechService;
