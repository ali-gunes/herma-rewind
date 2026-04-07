#!/bin/bash

# Configuration
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2"
MODEL_ARCHIVE="sherpa-onnx-whisper-tiny.tar.bz2"
MODEL_DIR="whisper-tiny"

echo "=== Sherpa-ONNX Whisper Model Setup ==="

# Check if model already exists
if [ -d "$MODEL_DIR" ]; then
    echo "Model directory '$MODEL_DIR' already exists. Skipping download."
    exit 0
fi

# Download
echo "Downloading Whisper Tiny model (~150MB)..."
curl -L "$MODEL_URL" -o "$MODEL_ARCHIVE"

# Extract
echo "Extracting model..."
tar -xjf "$MODEL_ARCHIVE"
mv "sherpa-onnx-whisper-tiny" "$MODEL_DIR"

# Download VAD model
echo "Downloading Silero VAD model..."
curl -L "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx" -o "$MODEL_DIR/silero_vad.onnx"

echo "=== Setup Complete! Model is in '$MODEL_DIR' ==="
