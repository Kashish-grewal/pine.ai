// ================================================================
// OFFSCREEN DOCUMENT — audio recording (MV3 requirement)
// ================================================================
// Chrome MV3 service workers can't use MediaRecorder directly.
// This hidden page does the actual audio capture using the
// stream ID passed from the background service worker.
// ================================================================

let mediaRecorder = null;
let audioChunks   = [];
let stream        = null;

// ── Listen for commands from background.js ────────────────────────
chrome.runtime.onMessage.addListener(async (msg, _sender, sendResponse) => {

  // ── START RECORDING ───────────────────────────────────────────
  if (msg.type === 'START_RECORDING') {
    const { streamId } = msg;

    try {
      // Acquire tab audio stream using the stream ID
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource:   'tab',
            chromeMediaSourceId: streamId,
          },
        },
        video: false,
      });

      audioChunks = [];

      // Pick best supported codec
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ].find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';

      mediaRecorder = new MediaRecorder(stream, { mimeType });

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
        });

        audioChunks = [];
      };

      // Collect data every 10 seconds (prevents memory issues in long meetings)
      mediaRecorder.start(10_000);

      console.log('[Pine.AI Offscreen] Recording started');
      sendResponse({ success: true });

    } catch (err) {
      console.error('[Pine.AI Offscreen] Failed to start recording:', err);
      sendResponse({ success: false, error: err.message });
    }
  }

  // ── STOP RECORDING ────────────────────────────────────────────
  if (msg.type === 'STOP_RECORDING') {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      stream?.getTracks().forEach(t => t.stop());
      console.log('[Pine.AI Offscreen] Recording stopped');
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No active recording' });
    }
  }

  return true; // keep message channel open for async response
});
