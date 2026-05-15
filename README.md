<div align="center">

# 🌲 Pine.AI

**AI-Powered Meeting Intelligence Platform**

*Transform raw meeting audio into structured insights, personalized action items, and workflow visualizations — automatically.*

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://postgresql.org)
[![Groq](https://img.shields.io/badge/Groq-Whisper_v3-F55036)](https://groq.com)

</div>

---

## 🎯 What It Does

Pine.AI captures meeting audio (via Chrome extension or file upload), transcribes it with speaker diarization, then uses LLMs to extract:

- **📝 Executive summaries** with sentiment analysis
- **✅ Action items** assigned to specific speakers with deadlines
- **🎯 Key decisions** and open questions
- **💰 Financial transactions** mentioned in conversation
- **📊 Mermaid.js workflow diagrams** visualizing the meeting flow
- **📧 Personalized emails** — each participant gets only *their* tasks + shared context

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                         │
│              Tab Audio + Mic → WebM Recording                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Upload
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Express.js Backend (Node)                   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Transcription │  │  Structuring  │  │ Workflow Visualization│ │
│  │  (Groq API)   │  │  (LLM + DB)  │  │    (Mermaid.js)       │ │
│  │  Whisper v3   │  │  llama-3.3   │  │                       │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
│         │                 │                       │             │
│         ▼                 ▼                       ▼             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   PostgreSQL (Neon)                       │   │
│  │  sessions │ transcripts │ tasks │ summaries │ email_logs  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Auth (JWT)   │  │  Email SMTP  │  │   Google OAuth       │  │
│  │  + Refresh    │  │  (Gmail/     │  │   Calendar Sync      │  │
│  │              │  │   Resend)    │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend (Vite)                         │
│                                                                 │
│  Dashboard │ Transcript View │ Task Manager │ Workflow Diagram  │
│  Theme Engine (5 themes) │ Keyboard Shortcuts │ Email Modal     │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (or [Neon](https://neon.tech) free tier)
- [Groq API key](https://console.groq.com) (free)

### 1. Clone & Install

```bash
git clone https://github.com/your-username/pine-ai.git
cd pine-ai

# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
```

### 2. Configure Environment

```bash
# server/.env
PORT=5001
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
JWT_SECRET=your-secret-key
JWT_ACCESS_SECRET=your-access-secret
JWT_REFRESH_SECRET=your-refresh-secret
GROQ_API_KEY=gsk_your_groq_key
CLIENT_URL=http://localhost:5173
NODE_ENV=development

# Email (choose one):
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=your-16-char-app-password
# OR
RESEND_API_KEY=re_your_resend_key
```

### 3. Initialize Database

```bash
cd server
psql $DATABASE_URL -f db/schema.sql
```

### 4. Run

```bash
# Terminal 1: Backend
cd server && npm run dev

# Terminal 2: Frontend
cd client && npm run dev
```

Open `http://localhost:5173` → Register → Upload audio or use Chrome Extension.

## 📁 Project Structure

```
pine.ai/
├── client/                    # React frontend (Vite)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── AuthPage.jsx          # Login / Register / Token connect
│   │   │   └── DashboardPage.jsx     # Main app (sessions, transcript, tasks)
│   │   ├── components/
│   │   │   └── EmailDistribution.jsx # Personalized email sender
│   │   ├── api/client.js             # Axios instance with auth interceptor
│   │   ├── store/authStore.js        # Zustand auth state
│   │   └── index.css                 # Design system (5 themes, 2100+ lines)
│   └── index.html
│
├── server/                    # Express.js backend
│   ├── routes/
│   │   ├── auth.js                   # JWT auth + Google OAuth
│   │   ├── sessions.js               # Upload, process, reprocess
│   │   ├── email.js                  # Send summaries + personalized emails
│   │   └── settings.js               # User preferences
│   ├── services/
│   │   ├── transcription.js          # Groq Whisper + chunked processing
│   │   ├── structuring.js            # LLM task/summary extraction
│   │   ├── workflowVisualization.js  # Mermaid diagram generation
│   │   ├── emailService.js           # Gmail SMTP / Resend transport
│   │   └── groqClient.js             # Shared Groq SDK instance
│   ├── middleware/auth.js            # JWT verification middleware
│   ├── db/
│   │   ├── db.js                     # Connection pool + keepalive
│   │   └── schema.sql                # Full database schema
│   └── index.js                      # Express app entry point
│
├── extension/                 # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── offscreen.html                # Audio capture document
│   ├── service-worker.js             # Background keepalive + recording
│   ├── popup.html / popup.js         # Extension UI
│   └── permissions.html              # Mic permission grant page
│
└── README.md
```

## ⚡ Key Features

### 🎙️ Audio Pipeline
- Records tab audio + microphone via Chrome Extension
- Service worker keepalive prevents Chrome from killing long recordings
- Audio optimized to 16kHz mono for faster uploads
- Chunked upload for files > 25MB (Groq API limit)

### 🧠 AI Structuring
- Whisper Large v3 transcription with auto language detection
- LLM-based speaker diarization (fallback when GPU unavailable)
- Chunked structuring for long meetings (120 segments/chunk)
- Aggressive task extraction with speaker attribution

### 📧 Email Distribution
- **Personalized mode**: Each person gets only their tasks
- **Broadcast mode**: Full summary to all participants
- iCal calendar attachments for tasks with deadlines
- Gmail SMTP or Resend transport (auto-detected)

### 🎨 UI/UX
- 5 premium themes: Midnight, Ocean, Forest, Sunset, Daylight
- Keyboard shortcuts: `⌘K` search, `↑↓` navigate, `N` new recording
- Mermaid.js workflow diagrams with interactive rendering
- Speaker rename in transcript view

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Zustand, Mermaid.js |
| Backend | Express.js 5, Node.js 18+ |
| Database | PostgreSQL (Neon serverless) |
| Transcription | Groq API (Whisper Large v3) |
| AI/LLM | Llama 3.3 70B via Groq |
| Email | Nodemailer (Gmail SMTP) / Resend |
| Auth | JWT + Google OAuth 2.0 |
| Extension | Chrome Manifest V3 |
| Deployment | Vercel (frontend) + Render (backend) |

## 🔒 Security

- JWT access + refresh token rotation
- bcrypt password hashing
- Helmet.js security headers
- CORS restricted to configured client URL
- Session ownership verification on all endpoints
- Rate limiting via `express-rate-limit`

## 📝 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Login → JWT tokens |
| POST | `/api/v1/auth/google` | Google OAuth login |
| GET | `/api/v1/sessions` | List user sessions |
| POST | `/api/v1/sessions/upload` | Upload audio file |
| GET | `/api/v1/sessions/:id` | Get session + transcript + tasks |
| POST | `/api/v1/sessions/:id/reprocess` | Re-run AI structuring |
| POST | `/api/v1/email/send` | Send summary to recipients |
| POST | `/api/v1/email/send-personalized` | Per-person task emails |
| GET | `/api/v1/sessions/:id/workflow` | Get Mermaid diagram |

## 👤 Author

**Kashish Grewal**

## 📄 License

MIT
