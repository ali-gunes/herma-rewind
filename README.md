# Herma Rewind - Offline Voice Order Management

An offline, browser-independent voice recognition system for managing kitchen orders.

## Features
- **100% Offline**: Uses Sherpa-ONNX and Whisper for Speech-to-Text.
- **Turkish Support**: Optimized for Turkish commands like "A-123 Hazır" or "Bursa 45 Teslim edildi".
- **CLI-Only**: Runs in your terminal with detailed logs and system speaker feedback.
- **REST API**: Still supports order ingestion via `/api/orders/ingest`.

## Setup

### 1. External Dependencies

#### Mac
```bash
brew install sox
```

#### Windows
1. Download SoX from [SourceForge](https://sourceforge.net/projects/sox/files/sox/).
2. Extract the zip file (e.g., to `C:\sox`).
3. Add the folder path to your system `PATH` environment variable.
4. (Optional) Install a Turkish voice pack in Windows Settings for better Text-to-Speech.

### 2. Project Installation
```bash
npm install
bash setup-models.sh
```

### 3. Run
```bash
node server.js
```

## Voice Commands
- **Prepared**: "hazır", "hazırlandı", "tamam", "ok"
- **Delivered**: "teslim", "edildi", "teslimedildi", "gönderildi", "çıktı"

Examples:
- "A yüz on yedi hazırlandı" -> Updates Order A-117 to 'Hazır'
- "Bursa otuz iki teslim edildi" -> Updates Order B-32 to 'Teslim Edildi'
