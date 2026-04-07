# Herma Rewind — Offline Voice Order Management

An offline, browser-independent voice recognition system for managing kitchen display orders. Uses **Sherpa-ONNX** (Whisper Tiny) for Turkish speech-to-text — no internet required after setup.

## How It Works

1. The server listens passively on your microphone.
2. Say **"Sipariş"** — a chime plays and it enters active listening.
3. Say the order command — **"106 Hazır"** or **"A-105 Teslim Edildi"**.
4. The system matches the order, updates its status, calls the external KDS API, and speaks a confirmation.

---

## Setup — macOS

### 1. Install SoX (microphone driver)
```bash
brew install sox
```

### 2. Install dependencies & download models
```bash
npm install
bash setup-models.sh
```

### 3. Configure environment
Copy `.env.example` to `.env` and fill in your KDS endpoint:
```
UPDATE_STATUS_BASE_URL=https://your-kds-api.com
PORT=3000
STATUS_PREPARING=20
STATUS_PREPARED=30
STATUS_DELIVERED=40
```

### 4. Run
```bash
node server.js
```

---

## Setup — Windows

### Step 1 — Install Node.js
Download and install from https://nodejs.org (LTS version recommended, v18+).

### Step 2 — Install SoX (microphone driver)

1. Go to https://sourceforge.net/projects/sox/files/sox/
2. Download the latest `.zip` file (e.g. `sox-14.4.2-win32.zip`)
3. Extract it to a permanent location, e.g. `C:\sox`
4. Add SoX to your `PATH`:
   - Press `Win + S` → search **"Environment Variables"**
   - Click **"Edit the system environment variables"**
   - Click **"Environment Variables..."**
   - Under **"System variables"**, find and select **Path**, click **Edit**
   - Click **New**, type `C:\sox` (or wherever you extracted it)
   - Click **OK** on all dialogs
5. Open a **new** Command Prompt and verify:
   ```cmd
   sox --version
   ```
   You should see something like `SoX v14.4.2`.

### Step 3 — Install dependencies
Open Command Prompt or PowerShell in the project folder:
```cmd
npm install
```

### Step 4 — Download the speech models
Run the setup script using Git Bash (comes with Git for Windows):
```bash
bash setup-models.sh
```

Or manually download and place the files:

| File | URL |
|------|-----|
| `tiny-encoder.int8.onnx` | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2 |
| `tiny-decoder.int8.onnx` | (same archive) |
| `tiny-tokens.txt` | (same archive) |
| `silero_vad.onnx` | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx |

Extract the archive and place all files in a `whisper-tiny/` folder in the project root.

### Step 5 — Configure `.env`
Create a `.env` file in the project root:
```
UPDATE_STATUS_BASE_URL=https://your-kds-api.com
PORT=3000
STATUS_PREPARING=20
STATUS_PREPARED=30
STATUS_DELIVERED=40
```

### Step 6 — Run
```cmd
node server.js
```

### Step 7 — (Optional) Turkish Text-to-Speech on Windows
The app will speak order confirmations. For Turkish voice:
1. Open **Settings → Time & Language → Speech**
2. Under **"Manage voices"**, add **Turkish**
3. Restart the app

If no Turkish voice is installed, the app will speak in the system default language but will still function correctly.

### Windows Troubleshooting

| Problem | Solution |
|---------|----------|
| `sox: command not found` | SoX not in PATH — re-check Step 2 |
| `Error: spawn rec ENOENT` | SoX not installed or not in PATH |
| No microphone input | Check Windows microphone privacy settings: Settings → Privacy → Microphone |
| Push to GitHub fails | Model files are excluded via `.gitignore` — run `bash setup-models.sh` on each new machine |

---

## Voice Commands

| Say | Meaning |
|-----|---------|
| "Sipariş 106 hazır" | Mark order 106 as Ready |
| "Sipariş A-105 teslim edildi" | Mark order A-105 as Delivered |
| "Sipariş yüz altı hazır" | Also matches order 106 (number words) |
| "Sipariş bir sıfır altı hazır" | Also matches order 106 (digit-by-digit) |
| "Sipariş yüzaltı teslim" | Also matches order 106 (compound word) |

**Trigger variations recognized:** sipariş, siparis, siparış, pariş, parış, paris, paraş (and more — uses fuzzy regex matching).

## REST API

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/api/orders/ingest` | `{ "kdsOrderId": "106" }` | Register a new order |
| `GET` | `/api/orders` | — | List all current orders |
