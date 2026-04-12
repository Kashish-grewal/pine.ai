#!/usr/bin/env bash
# ============================================================
# One-command setup for the WhisperX transcription engine
# Run from: server/python/
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Creating Python 3.12 virtual environment..."

# WhisperX requires Python 3.12 or earlier (not 3.14+)
PYTHON_BIN=""
if command -v /opt/homebrew/bin/python3.12 &>/dev/null; then
  PYTHON_BIN="/opt/homebrew/bin/python3.12"
elif command -v python3.12 &>/dev/null; then
  PYTHON_BIN="python3.12"
elif command -v python3.11 &>/dev/null; then
  PYTHON_BIN="python3.11"
else
  echo "❌ Python 3.12 not found. Install with: brew install python@3.12"
  exit 1
fi

echo "   Using: $PYTHON_BIN ($($PYTHON_BIN --version))"
$PYTHON_BIN -m venv venv

echo "📦 Activating venv and installing dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Get a free Hugging Face token: https://huggingface.co/settings/tokens"
echo "  2. Accept Pyannote terms: https://huggingface.co/pyannote/speaker-diarization-3.1"
echo "  3. Accept segmentation terms: https://huggingface.co/pyannote/segmentation-3.0"
echo "  4. Add HF_TOKEN=hf_xxxxx to server/.env"
echo ""
echo "Test with: python transcribe.py --help"
