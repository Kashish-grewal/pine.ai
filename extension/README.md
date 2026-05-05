# 🌲 Pine.AI — Chrome Extension

Automatically records Google Meet audio and scrapes participant names. When the meeting ends, it uploads everything to Pine.AI and each participant gets a **personalized email** with only their own action items.

---

## Architecture

```
extension/
├── manifest.json     Chrome MV3 manifest
├── background.js     Service worker — coordinates recording & upload
├── content.js        Injected into meet.google.com — scrapes names & detects meeting lifecycle  
├── offscreen.html    Hidden page required by MV3 for MediaRecorder
├── offscreen.js      Audio recording via getUserMedia(chromeMediaSource: 'tab')
├── popup.html        Extension UI
├── popup.js          Popup logic — status, start/stop, settings
└── icons/            Extension icons (16, 48, 128px)
```

## How It Works

```
Google Meet Tab
      │
      ├─ content.js scrapes participant names every 4s (accumulates throughout meeting)
      │  Selectors: [data-participant-id], .zWGUib, .dwSJ2e, [data-self-name]
      │
      ├─ MEETING_STARTED → background.js
      │      └─ Creates offscreen document
      │         Gets tabCapture stream ID
      │         Sends streamId to offscreen.js → MediaRecorder starts
      │
      ├─ PARTICIPANTS_UPDATE → background.js accumulates unique names
      │
      └─ MEETING_ENDED → background.js
             └─ Stops MediaRecorder → audio blob → base64
                Uploads to POST /api/v1/sessions/upload with:
                  - audio file (webm)
                  - participant_names (JSON array)
                  - meeting title
                Pine.AI processes → personalized emails sent 🎉
```

## Setup Instructions

### 1. Load the extension in Chrome

1. Open Chrome → go to `chrome://extensions`
2. Toggle **Developer Mode** ON (top-right)
3. Click **Load unpacked**
4. Select the `pine.ai/extension/` folder
5. The 🌲 Pine.AI extension icon appears in your toolbar

### 2. Connect to Pine.AI

**Option A — From Dashboard (recommended):**
1. Open Pine.AI dashboard (`http://localhost:5173`)
2. Click the **🔌** button in the top-left sidebar
3. Copy the auth token shown
4. Click the Pine.AI extension icon → Settings → paste token → Save

**Option B — Manual:**
1. Log into Pine.AI and open DevTools → Application → Local Storage
2. Copy the value of `accessToken`
3. Paste into extension Settings

### 3. Configure Server URL

- **Local dev:** `http://localhost:5001` (default)
- **Production:** your deployed API URL

### 4. Test it

1. Join any Google Meet
2. The extension popup shows the meeting detected with participant names
3. Click **▶ Start Recording** (or enable Auto-record in settings)
4. Talk for a bit
5. Leave the meeting — extension automatically uploads and processing begins
6. Check Pine.AI dashboard for the new session

---

## Settings

| Setting | Description |
|---------|-------------|
| **Server URL** | Pine.AI backend URL |
| **Auth Token** | Your JWT access token (7 day lifetime) |
| **Auto-record** | Automatically start recording when a Meet is detected |

---

## Permissions Explained

| Permission | Why needed |
|------------|------------|
| `tabCapture` | Capture audio from the Google Meet tab |
| `offscreen` | Run MediaRecorder in a hidden page (MV3 requirement) |
| `tabs` | Detect which tab is the active Meet |
| `storage` | Save your API URL and auth token |
| `scripting` | Inject content script into meet.google.com |
| `notifications` | Show recording status and upload confirmation |

---

## Known Limitations

- Google Meet DOM selectors may break if Google updates their UI — the content script uses 4 fallback selector sets to minimize this
- Audio quality depends on tab audio settings (works best with headphones/mic)
- Very long meetings (3h+) may produce large files — the server accepts up to the configured Multer limit

---

## Files Required on Backend

The extension uploads to: `POST /api/v1/sessions/upload`

Required fields:
- `audio` — the recorded `.webm` file
- `participant_names` — JSON array of scraped names
- `title` — meeting title from Google Meet
- `expected_speaker_count` — count of participants
- `source` — `"google_meet"`
