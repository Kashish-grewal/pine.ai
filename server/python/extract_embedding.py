#!/usr/bin/env python3
"""
Speaker Embedding Extraction for pine.ai
==========================================
Extracts a 512-dimensional speaker embedding (voiceprint) from a
short voice sample using Pyannote's embedding model.

Usage:
    python extract_embedding.py <audio_path> [--hf-token TOKEN]

Output (stdout):
    JSON: {"embedding": [0.123, -0.456, ...], "duration": 12.5, "success": true}
"""

import sys
import os
import json
import argparse
import warnings
import time

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)


def log(msg):
    print(f"[Embedding] {msg}", file=sys.stderr, flush=True)


def extract_embedding(audio_path, hf_token=None, device="cpu"):
    """
    Extract a speaker embedding from an audio file.
    
    Uses Pyannote's pre-trained embedding model to produce a
    512-dimensional vector that represents the speaker's voice.
    """
    import torch
    import numpy as np
    from pydub import AudioSegment
    from pyannote.audio import Inference

    log("Loading audio...")
    
    # Load and preprocess audio
    audio = AudioSegment.from_file(audio_path)
    audio = audio.set_channels(1).set_frame_rate(16000)
    duration_secs = len(audio) / 1000.0
    
    if duration_secs < 1.0:
        log("ERROR: Audio too short (< 1 second)")
        return None, 0
    
    if duration_secs > 60.0:
        log("WARNING: Audio longer than 60s, trimming to first 30s for embedding")
        audio = audio[:30000]
        duration_secs = 30.0
    
    # Convert to numpy
    samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
    max_val = np.iinfo(np.int16).max
    samples = samples / max_val
    
    # Create waveform tensor for Pyannote
    waveform = torch.tensor(samples).unsqueeze(0)  # (1, num_samples)
    
    log(f"Audio: {duration_secs:.1f}s, 16kHz mono")
    log("Loading embedding model...")
    
    start = time.time()
    
    # Use Pyannote's embedding model
    # This model is free and doesn't require HF token for inference
    inference = Inference(
        "pyannote/embedding",
        window="whole",
        device=device,
        use_auth_token=hf_token if hf_token else None,
    )
    
    log(f"Model loaded in {time.time() - start:.1f}s")
    log("Extracting embedding...")
    
    # Extract embedding from in-memory audio
    audio_dict = {
        "waveform": waveform,
        "sample_rate": 16000,
    }
    
    embedding = inference(audio_dict)
    
    # Convert to list of floats
    if hasattr(embedding, 'numpy'):
        embedding_list = embedding.numpy().flatten().tolist()
    elif hasattr(embedding, 'data'):
        embedding_list = embedding.data.numpy().flatten().tolist()
    else:
        embedding_list = list(embedding.flatten())
    
    log(f"Embedding extracted: {len(embedding_list)}-dim vector")
    
    return embedding_list, duration_secs


def main():
    parser = argparse.ArgumentParser(description="Extract speaker embedding from audio")
    parser.add_argument("audio_path", help="Path to voice sample audio")
    parser.add_argument("--hf-token", default=None, help="Hugging Face token")
    parser.add_argument("--device", default="cpu", help="Compute device")
    
    args = parser.parse_args()
    
    if not os.path.isfile(args.audio_path):
        print(json.dumps({"success": False, "error": f"File not found: {args.audio_path}"}))
        sys.exit(1)
    
    hf_token = args.hf_token or os.environ.get("HF_TOKEN", "")
    
    try:
        embedding, duration = extract_embedding(
            args.audio_path,
            hf_token=hf_token,
            device=args.device,
        )
        
        if embedding is None:
            print(json.dumps({"success": False, "error": "Failed to extract embedding"}))
            sys.exit(1)
        
        print(json.dumps({
            "success": True,
            "embedding": embedding,
            "duration": round(duration, 2),
            "dimensions": len(embedding),
        }))
        
    except Exception as e:
        log(f"ERROR: {e}")
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
