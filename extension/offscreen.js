// ================================================================
// OFFSCREEN DOCUMENT — audio recording (MV3 requirement)
// ================================================================
// Captures BOTH tab audio (other speakers) AND microphone (you).
// Mixes them into a single stream for transcription.
// ================================================================

let mediaRecorder = null;
let audioChunks   = [];
let tabStream     = null;
let micStream     = null;
let mixedStream   = null;

// ── Keepalive: prevent offscreen from being garbage collected ─────
setInterval(() => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_HEARTBEAT' }).catch(() => {});
  }
}, 20000);

// ── Mix two audio streams into one ────────────────────────────────
// ── Mix two audio streams into one (16kHz mono for optimal Whisper input) ──
function mixStreams(stream1, stream2) {
  // 16kHz = Whisper's native sample rate. No quality loss for speech,
  // but 3x smaller files than default 48kHz.
  const ctx = new AudioContext({ sampleRate: 16000 });
  const dest = ctx.createMediaStreamDestination();

  if (stream1 && stream1.getAudioTracks().length > 0) {
    const source1 = ctx.createMediaStreamSource(stream1);
    // Slight boost for tab audio (other speakers can be quiet)
    const gain1 = ctx.createGain();
    gain1.gain.value = 1.2;
    source1.connect(gain1).connect(dest);
  }

  if (stream2 && stream2.getAudioTracks().length > 0) {
    const source2 = ctx.createMediaStreamSource(stream2);
    source2.connect(dest);
  }

  return { stream: dest.stream, context: ctx };
}

// ── Listen for commands from background.js ────────────────────────
chrome.runtime.onMessage.addListener(async (msg, _sender, sendResponse) => {

  // ── START RECORDING ───────────────────────────────────────────
  if (msg.type === 'START_RECORDING') {
    const { streamId } = msg;

    try {
      // 1. Capture tab audio (other people in the meeting)
      tabStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource:   'tab',
            chromeMediaSourceId: streamId,
          },
        },
        video: false,
      });

      // 2. Capture microphone (YOUR voice)
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        console.log('[Pine.AI Offscreen] Microphone captured');
      } catch (micErr) {
        console.warn('[Pine.AI Offscreen] Microphone access denied, recording tab audio only:', micErr.message);
        micStream = null;
      }

      // 3. Mix both streams (or use tab-only if mic failed)
      let recordStream;
      if (micStream) {
        const mixed = mixStreams(tabStream, micStream);
        mixedStream = mixed;
        recordStream = mixed.stream;
        console.log('[Pine.AI Offscreen] Recording BOTH tab + mic audio');
      } else {
        recordStream = tabStream;
        console.log('[Pine.AI Offscreen] Recording tab audio only (no mic)');
      }

      audioChunks = [];

      // Pick best supported codec
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ].find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';

      mediaRecorder = new MediaRecorder(recordStream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob   = new Blob(audioChunks, { type: mimeType });
        const buffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((acc, b) => acc + String.fromCharCode(b), '')
        );

        // Send recorded audio back to background.js
        chrome.runtime.sendMessage({
          type:   'RECORDING_COMPLETE',
          audio:  base64,
          mimeType,
          sizeKB: Math.round(blob.size / 1024),
        }).catch(() => {});

        audioChunks = [];
        cleanup();
      };

      // Handle unexpected stream end (e.g., tab closed)
      tabStream.getAudioTracks().forEach(track => {
        track.onended = () => {
          console.log('[Pine.AI Offscreen] Tab audio track ended');
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        };
      });

      // Collect data every 5 seconds (better granularity)
      mediaRecorder.start(5_000);

      console.log('[Pine.AI Offscreen] Recording started');
      sendResponse({ success: true });

    } catch (err) {
      console.error('[Pine.AI Offscreen] Failed to start recording:', err);
      cleanup();
      sendResponse({ success: false, error: err.message });
    }
  }

  // ── STOP RECORDING ────────────────────────────────────────────
  if (msg.type === 'STOP_RECORDING') {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      console.log('[Pine.AI Offscreen] Recording stopped');
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No active recording' });
    }
  }

  // ── CHECK STATUS ──────────────────────────────────────────────
  if (msg.type === 'CHECK_RECORDING_STATUS') {
    sendResponse({
      recording: mediaRecorder?.state === 'recording',
      chunks: audioChunks.length,
    });
  }

  return true; // keep message channel open for async response
});

// ── Cleanup streams ───────────────────────────────────────────────
function cleanup() {
  tabStream?.getTracks().forEach(t => t.stop());
  micStream?.getTracks().forEach(t => t.stop());
  if (mixedStream?.context) {
    mixedStream.context.close().catch(() => {});
  }
  tabStream = null;
  micStream = null;
  mixedStream = null;
}
