# 🎯 Pine.AI — Project Status & Implementation Roadmap

**Date:** April 27, 2026  
**Project Phase:** MVP Complete → Chrome Extension Phase  
**Target:** Google Meet Integration + Email/Calendar Distribution

---

## ✅ **WHAT'S DONE (MVP: 100%)**

### Backend Services (Complete)
- ✅ **Transcription Pipeline**
  - Groq Whisper (Transcription)
  - LLM Diarization (Speaker assignment)
  - LLM Correction (Error fixing)
  - WhisperX fallback (Offline capability)
  - File chunking for >24MB audio

- ✅ **Data Structuring**
  - Task extraction (title, assignee, deadline, priority)
  - Expense/income recognition
  - Meeting summaries (with sentiment analysis)
  - Key decisions extraction

- ✅ **Email Distribution**
  - Resend API integration
  - Professional HTML templates
  - iCal calendar invite generation
  - Multi-recipient support
  - Email delivery tracking

- ✅ **Database**
  - 9 normalized tables
  - PostgreSQL on Neon
  - Proper indexes & constraints
  - Email logs table

### Frontend (Complete)
- ✅ **React Dashboard**
  - Audio upload (drag-drop)
  - Real-time processing polling
  - Results display (3 tabs: transcript, tasks, transactions)
  - Task completion toggle
  - Summary with sentiment coloring

- ✅ **Authentication**
  - JWT-based login/signup
  - Refresh token rotation
  - Protected routes

- ✅ **Email Modal**
  - Multi-recipient input
  - Email preview
  - Success/failure feedback

### API Endpoints (Complete)
- ✅ `POST /api/v1/auth/register`
- ✅ `POST /api/v1/auth/login`
- ✅ `POST /api/v1/sessions/upload`
- ✅ `GET /api/v1/sessions/:id`
- ✅ `POST /api/v1/email/send`
- ✅ `POST /api/v1/email/send-to-assignee`
- ✅ `GET /api/v1/email/logs/:sessionId`

---

## ❌ **WHAT'S NOT DONE (Next Phase)**

### Priority 1: Google Authentication (Critical)
- ❌ Google OAuth 2.0 setup
- ❌ Google Sign-In button on frontend
- ❌ Google ID token verification on backend
- ❌ User profile mapping (Google → local DB)
- **Why needed:** Users login via Google (no separate password)

### Priority 2: Chrome Extension (Critical)
- ❌ Manifest.json configuration
- ❌ Content script (Google Meet injection)
- ❌ Background script (audio capture)
- ❌ Popup UI (start/stop recording)
- ❌ Audio blob → API upload
- **Why needed:** Capture audio directly from Google Meet

### Priority 3: Meeting Workflow Visualization (Important)
- ❌ Napkin.ai API integration (flowchart generation)
- ❌ Meeting flow diagram in email
- ❌ Meeting timeline visualization
- **Why needed:** Visual summary of who spoke when, decisions made

### Priority 4: Calendar Integration (Important)
- ❌ Google Calendar API setup
- ❌ Direct event creation (not just iCal download)
- ❌ Automatic attendee invitation
- ❌ Reminder notifications
- **Why needed:** Tasks auto-added to user's calendar

### Priority 5: UI/UX Polish (Medium)
- ❌ Mobile responsiveness
- ❌ Toast notifications
- ❌ Error messages improvement
- ❌ Loading skeletons

### Priority 6: Testing & Docs (Low)
- ❌ Jest unit tests
- ❌ Integration tests
- ❌ README.md
- ❌ API documentation

---

## 📋 **IMPLEMENTATION PLAN (Step-by-Step)**

### **Phase 1: Google Authentication (1 week)**

#### Step 1.1: Backend Setup
```bash
cd server && npm install google-auth-library
```

**Create:** `server/middleware/googleAuth.js`
- Verify Google OAuth tokens
- Extract user info (email, name, picture)
- Auto-create/update user in DB

**Update:** `server/routes/auth.js`
- Add POST `/api/v1/auth/google`
- Accept idToken from frontend
- Verify with Google
- Return JWT + refresh token

**Update Database:**
```sql
ALTER TABLE users ADD COLUMN google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN profile_picture VARCHAR(255);
```

#### Step 1.2: Frontend Setup
```bash
cd client && npm install @react-oauth/google
```

**Update:** `client/src/pages/AuthPage.jsx`
- Import GoogleOAuthProvider
- Add Google Sign-In button
- Send idToken to backend
- Store JWT in authStore

**Update:** `.env`
```
VITE_GOOGLE_CLIENT_ID=your_client_id_here
```

---

### **Phase 2: Chrome Extension (2 weeks)**

#### Step 2.1: Create Extension Structure
```
chrome-extension/
├── manifest.json
├── package.json
├── public/
│   ├── popup.html
│   ├── popup.css
│   └── icon.png
└── src/
    ├── background/background.js
    ├── content/content.js
    ├── popup/popup.js
    └── utils/
        ├── audioCapture.js
        ├── storage.js
        └── api.js
```

#### Step 2.2: Manifest Configuration
```json
{
  "manifest_version": 3,
  "name": "Pine.AI Meeting Assistant",
  "version": "0.0.1",
  "permissions": ["tabs", "scripting", "activeTab"],
  "host_permissions": ["https://meet.google.com/*"],
  "background": {"service_worker": "src/background/background.js"},
  "content_scripts": [{"matches": ["https://meet.google.com/*"], "js": ["src/content/content.js"]}],
  "action": {"default_popup": "public/popup.html", "default_title": "Pine.AI"}
}
```

#### Step 2.3: Audio Capture Flow
1. Content script detects Google Meet starts
2. Background script requests microphone permission
3. Capture audio stream → WAV blob
4. On meet end → Upload to Pine.AI API
5. Receive tasks/summary → Show in popup

#### Step 2.4: Popup UI
- Start/Stop recording buttons
- Recording status indicator
- Tasks list when complete
- "Add to Calendar" button
- Email summary button

---

### **Phase 3: Napkin.ai Integration (1 week)**

**Setup:**
```bash
# Get free API key from napkin.io
npm install axios
```

**Create:** `server/services/workflowVisualization.js`
```javascript
// Convert transcript + tasks to meeting flowchart
// Call Napkin.ai API
// Get SVG/PNG flowchart
// Embed in email
```

**Update:** Email template to include flowchart image

---

### **Phase 4: Google Calendar Integration (1 week)**

**Setup:**
```bash
npm install googleapis
```

**Create:** `server/services/calendarService.js`
- Use Google Calendar API
- Create events from tasks
- Add assignees as attendees
- Set reminders

**New Endpoint:** `POST /api/v1/tasks/:id/add-to-calendar`
- Verify Google access token
- Create calendar event
- Return confirmation

---

## 📊 **Timeline & Workload**

| Phase | Work | Hours | Effort |
|-------|------|-------|--------|
| **1** | Google Auth | 7 | 1 week |
| **2** | Chrome Extension | 15 | 2 weeks |
| **3** | Napkin.ai | 3 | 3 days |
| **4** | Google Calendar | 5 | 1 week |
| **Polish** | Tests + Docs | 5 | 1 week |
| | **TOTAL** | **35 hours** | **3-4 weeks** |

---

## 🚀 **Priority Order for Implementation**

1. **Google Auth** (Unblocks everything)
2. **Chrome Extension Core** (Audio capture)
3. **Chrome Extension Popup** (UI)
4. **Napkin.ai** (Visual enhancement)
5. **Google Calendar** (Auto-sync)
6. **Polish & Testing**

---

## ✨ **Final User Experience**

```
1. User joins Google Meet
2. Pine.AI extension auto-activates
3. Meeting ends → Extension uploads audio
4. User receives email with:
   - Meeting summary + sentiment
   - Tasks list + assignees + deadlines
   - Meeting flowchart diagram
   - "Add to Calendar" links
5. User clicks → Tasks appear in Google Calendar
6. Done!
```

---

**Ready to start Phase 1? I can help you implement Google Auth step-by-step.**
