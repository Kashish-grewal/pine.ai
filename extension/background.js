// ================================================================
// BACKGROUND SERVICE WORKER — coordinates everything
// ================================================================
// Responsibilities:
//  1. Listen for MEETING_STARTED / MEETING_ENDED from content.js
//  2. Create offscreen document and start audio recording
//  3. On meeting end: stop recording, receive audio, upload to Pine.ai
//  4. Show Chrome notifications for status updates
//  5. Keep service worker alive during recording (MV3 eviction fix)
// ================================================================

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

// In-memory state
let recordingState = {
  active:       false,
  meetTabId:    null,
  title:        '',
  participants: [],
  startedAt:    null,
};

// ── Keepalive — prevent service worker eviction during recording ──
const KEEPALIVE_ALARM = 'pine-keepalive';

function startKeepalive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
}

function stopKeepalive() {
  chrome.alarms.clear(KEEPALIVE_ALARM);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM && recordingState.active) {
    console.log('[Pine.AI BG] Keepalive — recording active');
  }
});

// ── Offscreen document management ────────────────────────────────
async function ensureOffscreen() {
  try {
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
  } catch (err) {
    console.error('[Pine.AI BG] ensureOffscreen failed:', err.message);
  }
}

async function closeOffscreen() {
  try {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [OFFSCREEN_URL],
    });
    if (existing.length > 0) {
      await chrome.offscreen.closeDocument();
    }
  } catch (err) {
    console.error('[Pine.AI BG] closeOffscreen failed:', err.message);
  }
}

// ── Notifications ─────────────────────────────────────────────────
function notify(title, message, id = 'pine-status') {
  try {
    chrome.notifications.create(id, {
      type:    'basic',
      iconUrl: 'icons/icon48.png',
      title:   `Pine.AI — ${title}`,
      message,
    });
  } catch (e) {
    console.log('[Pine.AI BG] Notification failed:', e.message);
  }
}

// ── Start recording ───────────────────────────────────────────────
async function startRecording(tabId) {
  try {
    await ensureOffscreen();

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    const res = await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      streamId,
    });

    if (!res?.success) throw new Error(res?.error || 'Offscreen failed to start');

    recordingState.active    = true;
    recordingState.meetTabId = tabId;
    recordingState.startedAt = Date.now();

    // Persist state so it survives SW restart
    await chrome.storage.session.set({ recordingState });

    startKeepalive();

    console.log('[Pine.AI BG] Recording started for tab', tabId);
    notify('Recording Started', 'Recording in progress. You can close this popup safely.');

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
    await ensureOffscreen(); // make sure offscreen is still there
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    chrome.action.setBadgeText({ text: '⏳' });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    notify('Stopped', '⏳ Processing recording... uploading to Pine.AI');
  } catch (err) {
    console.error('[Pine.AI BG] stopRecording failed:', err.message);
    notify('Error', `Stop recording failed: ${err.message}`);
  }
}

// ── Upload to Pine.ai backend ─────────────────────────────────────
async function uploadToPineAI({ audioBase64, mimeType, title, participants }) {
  const { pineApiUrl, pineAuthToken } = await chrome.storage.local.get([
    'pineApiUrl',
    'pineAuthToken',
  ]);

  if (!pineAuthToken) {
    notify('Error', 'No auth token set. Open Pine.AI extension settings.');
    return;
  }

  const apiUrl = (pineApiUrl || 'http://localhost:5001').replace(/\/$/, '');

  const safeParticipants = participants && participants.length > 0
    ? participants
    : ['Participant 1'];

  try {
    const binary  = atob(audioBase64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });

    const ext      = mimeType.includes('ogg') ? 'ogg' : 'webm';
    const filename = `meet-${Date.now()}.${ext}`;

    const formData = new FormData();
    formData.append('audio', blob, filename);
    formData.append('title', title || `Google Meet — ${new Date().toLocaleDateString()}`);
    formData.append('participant_names', JSON.stringify(safeParticipants));
    formData.append('expected_speaker_count', String(Math.max(safeParticipants.length, 1)));
    formData.append('source', 'google_meet');

    console.log('[Pine.AI BG] Uploading:', filename, `${Math.round(blob.size / 1024)}KB`);

    const response = await fetch(`${apiUrl}/api/v1/sessions/upload`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${pineAuthToken}` },
      body:    formData,
    });

    const data = await response.json();

    if (response.ok && data.success) {
      notify('Upload Complete', `"${title}" saved! Check your dashboard for insights.`, 'pine-upload');
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
      console.log('[Pine.AI BG] Upload success. Session:', data.data?.sessionId);
    } else {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

  } catch (err) {
    console.error('[Pine.AI BG] Upload failed:', err.message);
    notify('Upload Failed', `${err.message}`, 'pine-upload');
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  }
}

// ── Message listener ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Content script: meeting started
  if (msg.type === 'MEETING_STARTED') {
    recordingState.title        = msg.title || 'Google Meet';
    recordingState.participants = msg.participants || [];

    chrome.storage.local.get('autoRecord').then(({ autoRecord }) => {
      if (autoRecord && sender.tab?.id) {
        startRecording(sender.tab.id);
      } else {
        notify('Meeting Detected', `"${recordingState.title}" — click extension to record.`);
      }
    });
  }

  // Content script: participant update
  if (msg.type === 'PARTICIPANTS_UPDATE') {
    const all = new Set([
      ...recordingState.participants,
      ...(msg.participants || []),
    ]);
    recordingState.participants = [...all];
    recordingState.title        = msg.title || recordingState.title;
  }

  // Content script: meeting ended
  if (msg.type === 'MEETING_ENDED') {
    const all = new Set([
      ...recordingState.participants,
      ...(msg.participants || []),
    ]);
    recordingState.participants = [...all];
    recordingState.title        = msg.title || recordingState.title;

    if (recordingState.active) {
      stopRecording();
    }
    recordingState.meetTabId = null;
  }

  // Offscreen: heartbeat (keeps service worker alive)
  if (msg.type === 'OFFSCREEN_HEARTBEAT') {
    // Just receiving this message keeps the SW alive
    return;
  }

  // Offscreen: recording finished — audio ready
  if (msg.type === 'RECORDING_COMPLETE') {
    console.log('[Pine.AI BG] Recording complete:', msg.sizeKB, 'KB');

    recordingState.active = false;
    stopKeepalive();

    // Clear persisted state
    chrome.storage.session.remove('recordingState').catch(() => {});

    uploadToPineAI({
      audioBase64:  msg.audio,
      mimeType:     msg.mimeType,
      title:        recordingState.title,
      participants: recordingState.participants,
    });

    closeOffscreen();

    recordingState = {
      active: false, meetTabId: null,
      title: '', participants: [], startedAt: null,
    };
  }

  // Popup: manual start
  if (msg.type === 'MANUAL_START') {
    chrome.tabs.query({ url: 'https://meet.google.com/*' }).then((tabs) => {
      const tab = tabs[0];
      if (!tab) {
        chrome.runtime.sendMessage({
          type: 'STATUS', error: 'No Google Meet tab found. Open a meeting first.',
        }).catch(() => {});
        return;
      }
      startRecording(tab.id).then(() => {
        chrome.runtime.sendMessage({
          type: 'STATUS',
          recording: true,
          title: recordingState.title,
          participants: recordingState.participants,
          startedAt: recordingState.startedAt,
        }).catch(() => {});
      });
    });
  }

  // Popup: manual stop
  if (msg.type === 'MANUAL_STOP') {
    stopRecording().then(() => {
      chrome.runtime.sendMessage({
        type: 'STATUS', recording: false,
      }).catch(() => {});
    });
  }

  // Popup: get current status
  if (msg.type === 'GET_STATUS') {
    // Respond immediately with current state
    chrome.runtime.sendMessage({
      type:         'STATUS',
      recording:    recordingState.active,
      title:        recordingState.title,
      participants: recordingState.participants,
      startedAt:    recordingState.startedAt,
    }).catch(() => {});
  }

  return true;
});

// ── Service worker startup — restore state ────────────────────────
chrome.storage.session.get('recordingState').then((data) => {
  if (data.recordingState?.active) {
    recordingState = data.recordingState;
    startKeepalive();
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    console.log('[Pine.AI BG] Restored recording state from session storage');
  }
});

// ── Install handler ───────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['pineApiUrl', 'autoRecord']);
  if (!existing.pineApiUrl) {
    await chrome.storage.local.set({ pineApiUrl: 'http://localhost:5001', autoRecord: false });
  }
  console.log('[Pine.AI BG] Extension installed/updated');
});
