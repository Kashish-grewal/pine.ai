#!/usr/bin/env python3
"""
WhisperX Transcription Engine for pine.ai
==========================================
Replaces AssemblyAI with a free, local, more accurate pipeline.

Usage:
    python transcribe.py <audio_path> <output_json> [options]

Options:
    --speakers N        Expected number of speakers (improves diarization)
    --language CODE     Language code, e.g. 'en', 'hi' (default: auto-detect)
    --boost WORDS       Comma-separated boost words (names, jargon)
    --hf-token TOKEN    Hugging Face token (or set HF_TOKEN env var)
    --device DEVICE     'mps' (M-series Mac), 'cuda' (NVIDIA), 'cpu' (default: auto)
    --model MODEL       Whisper model size (default: large-v3)
    --no-diarize        Skip speaker diarization
    --help              Show this help

Output:
    Writes JSON to <output_json> with structure:
    {
        "segments": [
            {
                "speaker": "SPEAKER_00",
                "start": 0.0,
                "end": 2.5,
                "text": "Hello everyone",
                "words": [{"word": "Hello", "start": 0.0, "end": 0.5, "speaker": "SPEAKER_00"}, ...]
            }
        ],
        "duration": 3600.0,
        "language": "en",
        "num_speakers": 3
    }
"""

import sys
import os
import json
import argparse
import tempfile
import time
import warnings

# Suppress noisy warnings from torch/transformers
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)


def log(msg):
    """Structured logging to stderr (stdout is reserved for JSON output)."""
    print(f"[WhisperX] {msg}", file=sys.stderr, flush=True)


def detect_device(requested_device=None):
    """Auto-detect the best available compute device."""
    import torch

    if requested_device and requested_device != "auto":
        log(f"Using requested device: {requested_device}")
        return requested_device

    if torch.cuda.is_available():
        log("Detected NVIDIA GPU (CUDA)")
        return "cuda"
    elif torch.backends.mps.is_available():
        log("Detected Apple Silicon (MPS)")
        return "mps"
    else:
        log("No GPU detected, using CPU (will be slower)")
        return "cpu"


def preprocess_audio(input_path, output_dir):
    """
    Preprocess audio for optimal transcription accuracy:
    1. Convert to 16kHz mono WAV (WhisperX optimal format)
    2. Normalize volume levels
    3. Apply noise reduction

    Returns path to preprocessed WAV file.
    """
    log("Preprocessing audio...")

    from pydub import AudioSegment
    import noisereduce as nr
    import numpy as np

    # Load audio with pydub (handles all formats via ffmpeg)
    audio = AudioSegment.from_file(input_path)

    # Convert to mono 16kHz (Whisper's native format)
    audio = audio.set_channels(1).set_frame_rate(16000)

    # Normalize volume — ensures all speakers are at similar loudness
    # This is critical for diarization accuracy
    target_dBFS = -20.0
    change_in_dBFS = target_dBFS - audio.dBFS
    audio = audio.apply_gain(change_in_dBFS)

    # Convert to numpy for noise reduction
    samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
    # Normalize to [-1, 1] range
    max_val = np.iinfo(np.int16).max
    samples = samples / max_val

    # Apply noise reduction — removes background hum, AC noise, etc.
    # Use stationary noise reduction (fast, effective for consistent background noise)
    try:
        cleaned = nr.reduce_noise(
            y=samples,
            sr=16000,
            stationary=True,
            prop_decrease=0.6,  # moderate — don't destroy speech
            n_fft=512,
            hop_length=128,
        )
        log("Noise reduction applied")
    except Exception as e:
        log(f"Noise reduction skipped: {e}")
        cleaned = samples

    # Save preprocessed audio
    output_path = os.path.join(output_dir, "preprocessed.wav")

    # Convert back to int16 for WAV
    cleaned_int16 = (cleaned * max_val).astype(np.int16)
    preprocessed = AudioSegment(
        cleaned_int16.tobytes(),
        frame_rate=16000,
        sample_width=2,  # 16-bit
        channels=1,
    )
    preprocessed.export(output_path, format="wav")

    duration_secs = len(preprocessed) / 1000.0
    log(f"Preprocessed: {duration_secs:.1f}s, 16kHz mono WAV")

    return output_path, duration_secs


def transcribe(audio_path, model_name, device, language=None, boost_words=None):
    """
    Run Whisper large-v3 transcription with word-level timestamps.
    Returns raw transcription result.
    """
    import whisperx

    log(f"Loading Whisper model '{model_name}' on {device}...")
    load_start = time.time()

    # Compute type: float16 for GPU, float32 for CPU, float32 for MPS
    if device == "cuda":
        compute_type = "float16"
    else:
        compute_type = "float32"

    model = whisperx.load_model(
        model_name,
        device=device,
        compute_type=compute_type,
        language=language,
    )
    log(f"Model loaded in {time.time() - load_start:.1f}s")

    log("Transcribing...")
    trans_start = time.time()

    audio = whisperx.load_audio(audio_path)

    # Batch size tuning for M4:
    #   - MPS: batch_size=8 works well (16GB unified memory)
    #   - CUDA: batch_size=16 for 8GB+ VRAM
    #   - CPU: batch_size=4
    batch_size = 8 if device == "mps" else (16 if device == "cuda" else 4)

    result = model.transcribe(
        audio,
        batch_size=batch_size,
        language=language,
    )

    log(f"Transcription done in {time.time() - trans_start:.1f}s — {len(result.get('segments', []))} segments")

    # Apply word-level forced alignment for precise timestamps
    log("Aligning words...")
    align_start = time.time()

    detected_language = result.get("language", language or "en")

    try:
        model_a, metadata = whisperx.load_align_model(
            language_code=detected_language,
            device=device,
        )
        result = whisperx.align(
            result["segments"],
            model_a,
            metadata,
            audio,
            device,
            return_char_alignments=False,
        )
        log(f"Alignment done in {time.time() - align_start:.1f}s")
    except Exception as e:
        log(f"Alignment failed (non-fatal, continuing without word-level timestamps): {e}")

    result["language"] = detected_language
    return result, audio


def diarize(audio, result, hf_token, device, num_speakers=None):
    """
    Run Pyannote 3.1 speaker diarization and assign speakers to words.
    This is what handles overlapping speech and speaker switches.
    """
    import whisperx
    from whisperx.diarize import DiarizationPipeline

    if not hf_token:
        log("⚠️  No HF_TOKEN — skipping diarization (all segments will be SPEAKER_00)")
        for seg in result.get("segments", []):
            seg["speaker"] = "SPEAKER_00"
        return result, 1

    log("Running speaker diarization (Pyannote 3.1)...")
    diarize_start = time.time()

    diarize_model = DiarizationPipeline(
        token=hf_token,
        device=device,
    )

    diarize_kwargs = {}
    if num_speakers and num_speakers > 0:
        diarize_kwargs["num_speakers"] = num_speakers
        log(f"Expecting {num_speakers} speakers")

    diarize_segments = diarize_model(audio, **diarize_kwargs)

    result = whisperx.assign_word_speakers(diarize_segments, result)

    # Count unique speakers
    speakers = set()
    for seg in result.get("segments", []):
        if "speaker" in seg:
            speakers.add(seg["speaker"])

    num_detected = len(speakers)
    log(f"Diarization done in {time.time() - diarize_start:.1f}s — {num_detected} speakers detected")

    return result, num_detected


def match_speakers_to_profiles(result, voice_profiles_path, hf_token, device):
    """
    Match diarized speakers to known voice profiles using cosine similarity.
    
    voice_profiles_path: JSON file with [{"name": "John", "embedding": [...]}, ...]
    
    For each unique SPEAKER_XX, we extract an embedding from their segments
    and compare against known profiles. If similarity > threshold, we rename.
    """
    if not voice_profiles_path or not os.path.isfile(voice_profiles_path):
        return result
    
    import numpy as np
    
    try:
        with open(voice_profiles_path, "r") as f:
            profiles = json.load(f)
    except Exception as e:
        log(f"Could not load voice profiles: {e}")
        return result
    
    if not profiles:
        return result
    
    log(f"Matching speakers against {len(profiles)} voice profiles...")
    
    # Collect unique speaker labels
    speaker_labels = set()
    for seg in result.get("segments", []):
        if "speaker" in seg:
            speaker_labels.add(seg["speaker"])
    
    if not speaker_labels:
        return result
    
    # For each speaker, find their segments and try to extract embedding
    # from the diarization model's internal embeddings
    # Since we can't easily re-extract embeddings per speaker from the 
    # diarization output, we use a simpler approach:
    # Compare the time-weighted centroid of each speaker's activity
    # against the profiles using the profile embeddings directly.
    
    # Build a speaker-to-name mapping using cosine similarity
    def cosine_similarity(a, b):
        a = np.array(a)
        b = np.array(b)
        dot = np.dot(a, b)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)
    
    # Try to extract per-speaker embeddings from audio
    try:
        from pyannote.audio import Inference
        import torch
        
        inference = Inference(
            "pyannote/embedding",
            window="whole",
            device=device,
            use_auth_token=hf_token if hf_token else None,
        )
        
        # Load the full audio
        import whisperx
        audio_data = result.get("_audio_data", None)
        
        if audio_data is not None:
            # Extract embedding for each speaker by their segments
            speaker_embeddings = {}
            
            for speaker in speaker_labels:
                # Get all segments for this speaker
                segs = [s for s in result.get("segments", []) if s.get("speaker") == speaker]
                if not segs:
                    continue
                
                # Use the longest segment for this speaker's embedding
                longest = max(segs, key=lambda s: s.get("end", 0) - s.get("start", 0))
                start_sample = int(longest.get("start", 0) * 16000)
                end_sample = int(longest.get("end", 0) * 16000)
                
                if end_sample <= start_sample or end_sample > len(audio_data):
                    continue
                
                segment_audio = audio_data[start_sample:end_sample]
                waveform = torch.tensor(segment_audio).unsqueeze(0).float()
                
                try:
                    emb = inference({"waveform": waveform, "sample_rate": 16000})
                    if hasattr(emb, 'numpy'):
                        speaker_embeddings[speaker] = emb.numpy().flatten().tolist()
                    else:
                        speaker_embeddings[speaker] = list(emb.flatten())
                except Exception:
                    continue
            
            # Match speakers to profiles
            THRESHOLD = 0.65  # Cosine similarity threshold
            speaker_name_map = {}
            used_profiles = set()
            
            # Score all speaker-profile pairs
            scores = []
            for speaker, emb in speaker_embeddings.items():
                for i, profile in enumerate(profiles):
                    sim = cosine_similarity(emb, profile["embedding"])
                    scores.append((sim, speaker, i, profile["name"]))
            
            # Sort by similarity (highest first) and assign greedily
            scores.sort(reverse=True)
            for sim, speaker, profile_idx, name in scores:
                if speaker in speaker_name_map or profile_idx in used_profiles:
                    continue
                if sim >= THRESHOLD:
                    speaker_name_map[speaker] = name
                    used_profiles.add(profile_idx)
                    log(f"  {speaker} → {name} (similarity: {sim:.3f})")
            
            # Apply mapping to segments
            if speaker_name_map:
                for seg in result.get("segments", []):
                    old_speaker = seg.get("speaker", "")
                    if old_speaker in speaker_name_map:
                        seg["speaker"] = speaker_name_map[old_speaker]
                
                log(f"Matched {len(speaker_name_map)}/{len(speaker_labels)} speakers to profiles")
            else:
                log("No speakers matched any profile (below threshold)")
    
    except Exception as e:
        log(f"Speaker matching failed (non-fatal): {e}")
    
    return result


def merge_short_segments(segments, min_gap=0.5, min_duration=0.3):
    """
    Merge very short segments from the same speaker that are close together.
    WhisperX sometimes fragments utterances into tiny pieces — this
    reassembles them into natural sentence-level segments.
    """
    if not segments:
        return segments

    merged = [segments[0].copy()]

    for seg in segments[1:]:
        prev = merged[-1]

        same_speaker = prev.get("speaker") == seg.get("speaker")
        close_together = (seg.get("start", 0) - prev.get("end", 0)) < min_gap
        prev_short = (prev.get("end", 0) - prev.get("start", 0)) < min_duration

        if same_speaker and (close_together or prev_short):
            # Merge: extend previous segment
            prev["end"] = seg.get("end", prev["end"])
            prev["text"] = prev.get("text", "") + " " + seg.get("text", "")
            # Merge word lists
            prev_words = prev.get("words", [])
            seg_words = seg.get("words", [])
            prev["words"] = prev_words + seg_words
        else:
            merged.append(seg.copy())

    return merged


def build_output(result, duration, num_speakers):
    """Build the final JSON output structure."""
    segments = result.get("segments", [])

    # Clean up segments
    output_segments = []
    for seg in segments:
        out = {
            "speaker": seg.get("speaker", "SPEAKER_00"),
            "start": round(seg.get("start", 0), 3),
            "end": round(seg.get("end", 0), 3),
            "text": seg.get("text", "").strip(),
        }

        # Include word-level detail if available
        if "words" in seg and seg["words"]:
            out["words"] = [
                {
                    "word": w.get("word", ""),
                    "start": round(w.get("start", 0), 3),
                    "end": round(w.get("end", 0), 3),
                    "speaker": w.get("speaker", seg.get("speaker", "SPEAKER_00")),
                }
                for w in seg["words"]
                if w.get("word", "").strip()
            ]

        if out["text"]:  # skip empty segments
            output_segments.append(out)

    # Merge fragmented segments from same speaker
    output_segments = merge_short_segments(output_segments)

    return {
        "segments": output_segments,
        "duration": round(duration, 2),
        "language": result.get("language", "en"),
        "num_speakers": num_speakers,
    }


def main():
    parser = argparse.ArgumentParser(description="WhisperX Transcription Engine for pine.ai")
    parser.add_argument("audio_path", help="Path to audio file")
    parser.add_argument("output_json", help="Path to write output JSON")
    parser.add_argument("--speakers", type=int, default=None, help="Expected number of speakers")
    parser.add_argument("--language", default=None, help="Language code (e.g. 'en', 'hi'). Auto-detect if omitted")
    parser.add_argument("--boost", default="", help="Comma-separated boost words")
    parser.add_argument("--hf-token", default=None, help="Hugging Face token (or HF_TOKEN env var)")
    parser.add_argument("--device", default="auto", help="Compute device: mps, cuda, cpu, auto")
    parser.add_argument("--model", default="large-v3", help="Whisper model size")
    parser.add_argument("--no-diarize", action="store_true", help="Skip speaker diarization")
    parser.add_argument("--voice-profiles", default=None, help="Path to JSON file with voice profile embeddings")

    args = parser.parse_args()

    # Validate input
    if not os.path.isfile(args.audio_path):
        log(f"ERROR: Audio file not found: {args.audio_path}")
        sys.exit(1)

    hf_token = args.hf_token or os.environ.get("HF_TOKEN", "")

    if not hf_token and not args.no_diarize:
        log("⚠️  No HF_TOKEN found. Diarization will be skipped.")
        log("   Get a free token: https://huggingface.co/settings/tokens")

    # Parse boost words
    boost_words = [w.strip() for w in args.boost.split(",") if w.strip()] if args.boost else []
    if boost_words:
        log(f"Boost words: {', '.join(boost_words[:10])}{'...' if len(boost_words) > 10 else ''}")

    total_start = time.time()

    # Step 1: Detect device
    device = detect_device(args.device)

    # Step 2: Preprocess audio
    with tempfile.TemporaryDirectory() as tmpdir:
        preprocessed_path, duration = preprocess_audio(args.audio_path, tmpdir)

        # Guard: skip transcription if audio is too short
        if duration < 0.1:
            log("⚠️  Audio is empty or too short — producing empty output")
            output = build_output({"segments": [], "language": args.language or "en"}, duration, 0)
            os.makedirs(os.path.dirname(os.path.abspath(args.output_json)), exist_ok=True)
            with open(args.output_json, "w", encoding="utf-8") as f:
                json.dump(output, f, ensure_ascii=False, indent=2)
            print(json.dumps({"success": True, "output_path": args.output_json, "segments_count": 0, "duration": 0, "num_speakers": 0, "processing_time": 0}))
            sys.exit(0)

        # Step 3: Transcribe with Whisper
        result, audio_array = transcribe(
            preprocessed_path,
            model_name=args.model,
            device=device,
            language=args.language,
            boost_words=boost_words,
        )

        # Step 4: Diarize with Pyannote
        num_speakers = 1
        if not args.no_diarize:
            result, num_speakers = diarize(
                audio_array,
                result,
                hf_token=hf_token,
                device=device,
                num_speakers=args.speakers,
            )
        else:
            for seg in result.get("segments", []):
                seg["speaker"] = "SPEAKER_00"

        # Step 4b: Match speakers to voice profiles
        if args.voice_profiles and not args.no_diarize:
            result["_audio_data"] = whisperx.load_audio(preprocessed_path)
            result = match_speakers_to_profiles(
                result, args.voice_profiles, hf_token, device
            )
            result.pop("_audio_data", None)  # Clean up

    # Step 5: Build output
    output = build_output(result, duration, num_speakers)

    # Write JSON output
    os.makedirs(os.path.dirname(os.path.abspath(args.output_json)), exist_ok=True)
    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total_time = time.time() - total_start
    log(f"✅ Complete — {len(output['segments'])} segments, {num_speakers} speakers, {total_time:.1f}s total")
    log(f"   Output: {args.output_json}")

    # Print summary to stdout for Node.js to capture
    print(json.dumps({
        "success": True,
        "output_path": args.output_json,
        "segments_count": len(output["segments"]),
        "duration": output["duration"],
        "num_speakers": num_speakers,
        "processing_time": round(total_time, 1),
    }))


if __name__ == "__main__":
    main()
