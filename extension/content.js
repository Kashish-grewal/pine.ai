// ================================================================
// CONTENT SCRIPT — runs inside meet.google.com
// ================================================================
// Responsibilities:
//  1. Detect when a meeting is active (URL has a room code)
//  2. Scrape participant names from the DOM
//  3. Extract meeting title
//  4. Detect when the meeting ends
//  5. Notify the background service worker
// ================================================================

const POLL_INTERVAL_MS  = 4000;   // scrape participants every 4s
const END_CHECK_DELAY   = 3000;   // wait 3s after URL change to confirm end

let lastParticipants = [];
let meetingActive    = false;
let pollTimer        = null;
let meetingTitle     = '';

// ── Detect if current URL is an active Meet room ──────────────────
const isInMeeting = () => /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(window.location.pathname);

// ── Scrape participant names from Meet DOM ────────────────────────
// Google Meet frequently changes class names, so we try multiple selectors.
const scrapeParticipants = () => {
  const names = new Set();

  // Selector set 1 — participant list panel (side panel open)
  document.querySelectorAll('[data-participant-id]').forEach(el => {
    const nameEl = el.querySelector('[data-self-name], .zWGUib, [jsname="EkRi3b"]');
    if (nameEl?.textContent?.trim()) names.add(nameEl.textContent.trim());
  });

  // Selector set 2 — video tiles in the grid
  document.querySelectorAll('.dwSJ2e, .KF4T6b').forEach(el => {
    const nameEl = el.querySelector('.XEazBc, .zWGUib');
    if (nameEl?.textContent?.trim()) names.add(nameEl.textContent.trim());
  });

  // Selector set 3 — bottom participant chips
  document.querySelectorAll('[data-self-name]').forEach(el => {
    if (el.textContent.trim()) names.add(el.textContent.trim());
  });

  // Selector set 4 — people panel list items
  document.querySelectorAll('.GvcuGe [jsname="r4nke"] span').forEach(el => {
    if (el.textContent.trim()) names.add(el.textContent.trim());
  });

  // Filter out button text, empty strings, very long strings
  return [...names].filter(n => n.length > 1 && n.length < 60 && !/button|mute|mic|cam/i.test(n));
};

// ── Extract meeting title ─────────────────────────────────────────
const getMeetingTitle = () => {
  // Try the title bar element
  const titleEl = document.querySelector('[jsname="r4nke"] .u6vdEc, .NzPR9b, [data-meeting-title]');
  if (titleEl?.textContent?.trim()) return titleEl.textContent.trim();

  // Fall back to page title
  const pageTitle = document.title.replace('Google Meet', '').replace('-', '').trim();
  return pageTitle || `Google Meet — ${new Date().toLocaleDateString()}`;
};

// ── Notify background worker ──────────────────────────────────────
const notify = (type, payload = {}) => {
  chrome.runtime.sendMessage({ type, ...payload }).catch(() => {});
};

// ── Start polling for participants ───────────────────────────────
const startPolling = () => {
  if (pollTimer) return;
  console.log('[Pine.AI] Meeting started — polling participants');

  meetingTitle    = getMeetingTitle();
  meetingActive   = true;
  lastParticipants = scrapeParticipants();

  notify('MEETING_STARTED', {
    title:        meetingTitle,
    participants: lastParticipants,
    url:          window.location.href,
  });

  pollTimer = setInterval(() => {
    const current = scrapeParticipants();
    if (current.length > 0) {
      lastParticipants = [...new Set([...lastParticipants, ...current])];
    }
    // Refresh title in case it was set late
    if (!meetingTitle || meetingTitle.startsWith('Google Meet')) {
      meetingTitle = getMeetingTitle();
    }
    // Send live update
    notify('PARTICIPANTS_UPDATE', {
      participants: lastParticipants,
      title:        meetingTitle,
    });
  }, POLL_INTERVAL_MS);
};

// ── Stop polling, notify meeting ended ───────────────────────────
const stopPolling = () => {
  if (!meetingActive) return;
  clearInterval(pollTimer);
  pollTimer      = null;
  meetingActive  = false;

  const finalParticipants = lastParticipants.length > 0
    ? lastParticipants
    : scrapeParticipants();

  console.log('[Pine.AI] Meeting ended. Participants:', finalParticipants);
  notify('MEETING_ENDED', {
    title:        meetingTitle,
    participants: finalParticipants,
  });

  // Reset state
  lastParticipants = [];
  meetingTitle     = '';
};

// ── URL change detection (Meet uses SPA routing) ─────────────────
let lastPath = window.location.pathname;
const observer = new MutationObserver(() => {
  const currentPath = window.location.pathname;
  if (currentPath === lastPath) return;
  lastPath = currentPath;

  if (isInMeeting()) {
    // Entered a meeting room
    setTimeout(startPolling, 2000); // wait for DOM to settle
  } else if (meetingActive) {
    // Left the meeting room
    setTimeout(stopPolling, END_CHECK_DELAY);
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// ── Initial check on page load ────────────────────────────────────
if (isInMeeting()) {
  setTimeout(startPolling, 3000); // give Meet time to render
}

// ── Listen for messages from popup/background ─────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_MEETING_INFO') {
    sendResponse({
      active:       meetingActive,
      title:        meetingTitle || getMeetingTitle(),
      participants: lastParticipants.length > 0 ? lastParticipants : scrapeParticipants(),
    });
  }
  return true;
});

// ── Detect meeting end via "Return to home" screen ────────────────
// Meet shows a goodbye screen with specific elements
const checkGoodbyeScreen = () => {
  const goodbyeEl = document.querySelector('[data-call-ended], .crqnQb, [jsname="CQylAd"]');
  if (goodbyeEl && meetingActive) {
    stopPolling();
  }
};
setInterval(checkGoodbyeScreen, 3000);
