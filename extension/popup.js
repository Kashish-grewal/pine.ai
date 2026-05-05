// ================================================================
// POPUP SCRIPT
// ================================================================

let isRecording  = false;
let timerInterval = null;
let startedAt    = null;

const $ = id => document.getElementById(id);

// ── Elements ──────────────────────────────────────────────────────
const statusDot      = $('statusDot');
const statusLabel    = $('statusLabel');
const recordBtn      = $('recordBtn');
const meetingInfo    = $('meetingInfo');
const meetingTitle   = $('meetingTitle');
const participantsList = $('participantsList');
const timerEl        = $('timer');
const msgEl          = $('msg');

// ── Utilities ─────────────────────────────────────────────────────
function setStatus(state, title = '', participants = []) {
  statusDot.className   = `status-dot ${state}`;
  statusLabel.className = `status-label ${state}`;

  const labels = {
    idle:      'Idle — not in a meeting',
    detected:  'Meeting detected',
    recording: '🔴 Recording in progress',
  };
  statusLabel.textContent = labels[state] || state;

  if (title || participants.length > 0) {
    meetingInfo.style.display = 'block';
    meetingTitle.textContent  = title || '(Untitled meeting)';

    participantsList.innerHTML = participants
      .map(p => `<span class="participant-chip">${p}</span>`)
      .join('');
  } else {
    meetingInfo.style.display = 'none';
  }
}

function showMsg(text, isError = false) {
  msgEl.textContent = text;
  msgEl.className   = isError ? 'msg error' : 'msg';
  msgEl.style.display = 'block';
  setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
}

function startTimer(from) {
  startedAt = from || Date.now();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    timerEl.textContent = `⏱ ${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerEl.textContent = '';
}

// ── Button handler ────────────────────────────────────────────────
recordBtn.addEventListener('click', async () => {
  if (!isRecording) {
    // Check auth token before starting
    const { pineAuthToken } = await chrome.storage.local.get('pineAuthToken');
    if (!pineAuthToken) {
      showMsg('⚠️ Set your auth token in Settings first!', true);
      $('settingsBody').classList.add('open');
      $('settingsArrow').textContent = '▲';
      return;
    }
    chrome.runtime.sendMessage({ type: 'MANUAL_START' });
  } else {
    chrome.runtime.sendMessage({ type: 'MANUAL_STOP' });
  }
});

// ── Listen for status updates from background ─────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATUS') {
    isRecording = msg.recording;

    if (isRecording) {
      setStatus('recording', msg.title, msg.participants);
      recordBtn.textContent = '■ Stop Recording';
      recordBtn.className   = 'btn-record stop';
      startTimer(msg.startedAt);
    } else {
      setStatus(msg.title ? 'detected' : 'idle', msg.title, msg.participants);
      recordBtn.textContent = '▶ Start Recording';
      recordBtn.className   = 'btn-record start';
      stopTimer();
    }

    if (msg.error) showMsg(msg.error, true);
  }
});

// ── Load settings ─────────────────────────────────────────────────
async function loadSettings() {
  const { pineApiUrl, pineAuthToken, autoRecord } = await chrome.storage.local.get([
    'pineApiUrl', 'pineAuthToken', 'autoRecord',
  ]);
  $('apiUrl').value      = pineApiUrl   || 'http://localhost:5001';
  $('authToken').value   = pineAuthToken || '';
  $('autoRecord').checked = !!autoRecord;
}

// ── Save settings ─────────────────────────────────────────────────
$('saveBtn').addEventListener('click', async () => {
  const url   = $('apiUrl').value.trim();
  const token = $('authToken').value.trim();
  const auto  = $('autoRecord').checked;

  if (!url) { showMsg('Server URL is required', true); return; }

  await chrome.storage.local.set({
    pineApiUrl:     url,
    pineAuthToken:  token,
    autoRecord:     auto,
  });

  showMsg('✅ Settings saved!');
});

// ── Settings toggle ───────────────────────────────────────────────
$('settingsToggle').addEventListener('click', () => {
  const body  = $('settingsBody');
  const arrow = $('settingsArrow');
  const open  = body.classList.toggle('open');
  arrow.textContent = open ? '▲' : '▼';
});

// ── Dashboard link ────────────────────────────────────────────────
$('dashboardLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const { pineApiUrl } = await chrome.storage.local.get('pineApiUrl');
  const url = (pineApiUrl || 'http://localhost:5001').replace(':5001', ':5173');
  chrome.tabs.create({ url });
});

// ── How to get token link ─────────────────────────────────────────
$('getTokenLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const { pineApiUrl } = await chrome.storage.local.get('pineApiUrl');
  const base = (pineApiUrl || 'http://localhost:5001').replace(':5001', ':5173');
  chrome.tabs.create({ url: `${base}/settings` });
});

// ── Init ──────────────────────────────────────────────────────────
(async () => {
  await loadSettings();

  // Ask background for current state
  chrome.runtime.sendMessage({ type: 'GET_STATUS' });

  // Also query the active Meet tab directly
  const [tab] = await chrome.tabs.query({ url: 'https://meet.google.com/*', active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_MEETING_INFO' }, (info) => {
      if (chrome.runtime.lastError || !info) return;
      if (info.active) {
        setStatus('detected', info.title, info.participants);
      }
    });
  }
})();
