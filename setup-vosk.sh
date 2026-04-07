#!/bin/bash

# Configuration
MODEL_URL="https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip"
MODEL_ZIP="vosk-model-small-tr-0.3.zip"
MODEL_DIR="model-tr"

echo "=== Vosk Turkish Model Setup ==="

# Check if model already exists
if [ -d "$MODEL_DIR" ]; then
    echo "Model directory '$MODEL_DIR' already exists. Skipping download."
    exit 0
fi

# Download
echo "Downloading Turkish model (~40MB)..."
curl -L "$MODEL_URL" -o "$MODEL_ZIP"

# Extract
echo "Extracting model..."
unzip "$MODEL_ZIP"
mv "vosk-model-small-tr-0.3" "$MODEL_DIR"

# Cleanup
echo "Cleaning up..."
rm "$MODEL_ZIP"

echo "=== Setup Complete! Model is in '$MODEL_DIR' ==="
