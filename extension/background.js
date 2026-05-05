// ================================================================
// BACKGROUND SERVICE WORKER — coordinates everything
// ================================================================
// Responsibilities:
//  1. Listen for MEETING_STARTED / MEETING_ENDED from content.js
//  2. Create offscreen document and start audio recording
//  3. On meeting end: stop recording, receive audio, upload to Pine.ai
//  4. Show Chrome notifications for status updates
// ================================================================

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

// In-memory state (resets if SW is evicted — OK for our use case)
let recordingState = {
  active:       false,
  meetTabId:    null,
  title:        '',
  participants: [],
  startedAt:    null,
};

// ── Offscreen document management ────────────────────────────────
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  if (existing.length === 0) {
    await chrome.offscreen.createDocument({
      url:    OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Record Google Meet audio for Pine.AI meeting summaries',
    });
  }
}

async function closeOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  if (existing.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

// ── Notifications ─────────────────────────────────────────────────
function notify(title, message, id = 'pine-status') {
  chrome.notifications.create(id, {
    type:    'basic',
    iconUrl: 'icons/icon48.png',
    title:   `🌲 Pine.AI — ${title}`,
    message,
  });
}

// ── Start recording ───────────────────────────────────────────────
async function startRecording(tabId) {
  try {
    await ensureOffscreen();

    // Get stream ID from the Meet tab
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Send stream ID to offscreen document
    const res = await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      streamId,
    });

    if (!res?.success) throw new Error(res?.error || 'Offscreen failed to start');

    recordingState.active    = true;
    recordingState.meetTabId = tabId;
    recordingState.startedAt = Date.now();

    console.log('[Pine.AI BG] Recording started for tab', tabId);
    notify('Recording', '🔴 Meeting is being recorded');

    // Update badge
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

  } catch (err) {
    console.error('[Pine.AI BG] startRecording failed:', err.message);
    notify('Error', `Could not start recording: ${err.message}`);
  }
}

// ── Stop recording ────────────────────────────────────────────────
async function stopRecording() {
  if (!recordingState.active) return;
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    // Audio arrives via RECORDING_COMPLETE message (see below)

    chrome.action.setBadgeText({ text: '' });
    notify('Processing', '⏳ Uploading meeting to Pine.AI…');
  } catch (err) {
    console.error('[Pine.AI BG] stopRecording failed:', err.message);
  }
}

// ── Upload to Pine.ai backend ─────────────────────────────────────
async function uploadToPineAI({ audioBase64, mimeType, title, participants }) {
  const { pineApiUrl, pineAuthToken } = await chrome.storage.local.get([
    'pineApiUrl',
    'pineAuthToken',
  ]);

  if (!pineAuthToken) {
    notify('Error', '⚠️ No auth token set. Open Pine.AI extension to configure.');
    return;
  }

  const apiUrl = (pineApiUrl || 'http://localhost:5001').replace(/\/$/, '');

  try {
    // Convert base64 back to Blob
    const binary  = atob(audioBase64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });

    // Build FormData for multipart upload
    const ext      = mimeType.includes('ogg') ? 'ogg' : 'webm';
    const filename = `meet-${Date.now()}.${ext}`;

    const formData = new FormData();
    formData.append('audio', blob, filename);
    formData.append('title', title || `Google Meet — ${new Date().toLocaleDateString()}`);
    formData.append('participant_names', JSON.stringify(participants));
    formData.append('expected_speaker_count', String(Math.max(participants.length, 1)));
    formData.append('source', 'google_meet');

    console.log('[Pine.AI BG] Uploading:', filename, `${Math.round(blob.size / 1024)}KB`, participants);

    const response = await fetch(`${apiUrl}/api/v1/sessions/upload`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${pineAuthToken}` },
      body:    formData,
    });

    const data = await response.json();

    if (response.ok && data.success) {
      notify('Done! ✅', `Meeting uploaded: "${title}". Processing insights for ${participants.length} participant(s).`);
      console.log('[Pine.AI BG] Upload success. Session:', data.data?.sessionId);
    } else {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

  } catch (err) {
    console.error('[Pine.AI BG] Upload failed:', err.message);
    notify('Upload Failed', `❌ ${err.message}`);
  }
}

// ── Message listener ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener(async (msg, sender) => {

  // Content script: meeting started
  if (msg.type === 'MEETING_STARTED') {
    recordingState.title        = msg.title || 'Google Meet';
    recordingState.participants = msg.participants || [];

    const { autoRecord } = await chrome.storage.local.get('autoRecord');
    if (autoRecord && sender.tab?.id) {
      await startRecording(sender.tab.id);
    } else {
      // Show notification asking user to start
      notify('Meeting Detected', `"${recordingState.title}" — ${recordingState.participants.length} participant(s). Click extension to record.`);
    }
  }

  // Content script: participant update
  if (msg.type === 'PARTICIPANTS_UPDATE') {
    // Accumulate participants across the whole meeting
    const all = new Set([
      ...recordingState.participants,
      ...(msg.participants || []),
    ]);
    recordingState.participants = [...all];
    recordingState.title        = msg.title || recordingState.title;
  }

  // Content script: meeting ended
  if (msg.type === 'MEETING_ENDED') {
    // Merge any last-minute participants
    const all = new Set([
      ...recordingState.participants,
      ...(msg.participants || []),
    ]);
    recordingState.participants = [...all];
    recordingState.title        = msg.title || recordingState.title;

    if (recordingState.active) {
      await stopRecording();
    }
    recordingState.meetTabId = null;
  }

  // Offscreen: recording finished — audio ready
  if (msg.type === 'RECORDING_COMPLETE') {
    recordingState.active = false;
    console.log('[Pine.AI BG] Recording complete:', msg.sizeKB, 'KB');

    await uploadToPineAI({
      audioBase64:  msg.audio,
      mimeType:     msg.mimeType,
      title:        recordingState.title,
      participants: recordingState.participants,
    });

    await closeOffscreen();

    // Reset state
    recordingState = {
      active: false, meetTabId: null,
      title: '', participants: [], startedAt: null,
    };
  }

  // Popup: manual start
  if (msg.type === 'MANUAL_START') {
    const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*', active: true });
    const tab  = tabs[0];
    if (!tab) {
      chrome.runtime.sendMessage({ type: 'STATUS', error: 'No active Meet tab found' });
      return;
    }
    await startRecording(tab.id);
    chrome.runtime.sendMessage({ type: 'STATUS', recording: true });
  }

  // Popup: manual stop
  if (msg.type === 'MANUAL_STOP') {
    await stopRecording();
    chrome.runtime.sendMessage({ type: 'STATUS', recording: false });
  }

  // Popup: get current status
  if (msg.type === 'GET_STATUS') {
    chrome.runtime.sendMessage({
      type:         'STATUS',
      recording:    recordingState.active,
      title:        recordingState.title,
      participants: recordingState.participants,
      startedAt:    recordingState.startedAt,
    });
  }

  return true;
});

// ── Install handler ───────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  // Set defaults
  const existing = await chrome.storage.local.get(['pineApiUrl', 'autoRecord']);
  if (!existing.pineApiUrl) {
    await chrome.storage.local.set({ pineApiUrl: 'http://localhost:5001', autoRecord: false });
  }
  console.log('[Pine.AI BG] Extension installed/updated');
});
