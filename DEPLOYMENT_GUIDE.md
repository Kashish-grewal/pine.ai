# 🚀 Pine.AI Deployment Guide

Complete guide to deploy Pine.AI to production with Vercel (Frontend) + Render (Backend).

---

## 📋 Pre-Deployment Checklist

Before deploying, ensure:

- [x] Frontend builds locally: `cd client && npm run build`
- [x] Backend runs without errors: `cd server && npm start`
- [x] All environment variables are configured
- [x] Database migrations are complete
- [x] No hardcoded secrets in code
- [x] All tests pass (if applicable)

---

## 🌐 Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  Vercel (Frontend)                   │
│  - React + Vite SPA                                  │
│  - Automatic deploys from GitHub                     │
│  - Environment: VITE_API_BASE_URL → /api/v1          │
│  - Proxy: /api/* → Backend URL                       │
└──────────────┬──────────────────────────────────────┘
               │
               ↓ HTTPS
               │
┌──────────────┴──────────────────────────────────────┐
│                  Render (Backend)                    │
│  - Node.js Express API                               │
│  - PostgreSQL (Neon or AWS RDS)                      │
│  - Environment: PORT=5001, DB_URL, EMAIL config      │
│  - Routes: /api/v1/auth, /api/v1/sessions, etc       │
└─────────────────────────────────────────────────────┘
```

---

## 📦 PART 1: Deploy Backend to Render

### Step 1: Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Click "New +" → "Web Service"

### Step 2: Connect GitHub Repository
1. Select your Pine.AI repository
2. Choose branch: `testing` (or `main`)
3. Set up as follows:

**Basic Info:**
- Name: `pine-ai-backend`
- Environment: `Node`
- Region: `Oregon` (or closest to you)
- Branch: `testing`

**Build & Start:**
- Build Command: `cd server && npm install`
- Start Command: `cd server && npm start`

### Step 3: Configure Environment Variables

Add these to Render's environment variables:

```env
# Database (use Neon PostgreSQL - free tier available)
DATABASE_URL=postgresql://user:password@db.neon.tech/pine_db

# Server
PORT=5001
NODE_ENV=production

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this
REFRESH_TOKEN_EXPIRY=7d

# Email (Gmail SMTP)
EMAIL_PROVIDER=gmail
GMAIL_USER=your-gmail@gmail.com
GMAIL_PASSWORD=your-app-specific-password

# LLMs
GROQ_API_KEY=your-groq-api-key
GEMINI_API_KEY=your-gemini-api-key

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# CORS
ALLOWED_ORIGINS=https://your-frontend-domain.com,https://localhost:5173

# Resend Email Service (optional, fallback)
RESEND_API_KEY=your-resend-key
```

### Step 4: Deploy Backend
1. Click "Create Web Service"
2. Wait for deployment (2-3 minutes)
3. Note your backend URL: `https://pine-ai-backend.onrender.com`

**Test Backend Health:**
```bash
curl https://pine-ai-backend.onrender.com/health
# Expected: {"success":true,"status":"healthy","environment":"production"}
```

---

## 🎨 PART 2: Deploy Frontend to Vercel

### Step 1: Create Vercel Account
1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub
3. Import your Pine.AI repository

### Step 2: Configure Project

**Settings:**
- Framework: `Vite`
- Root Directory: `./client`
- Build Command: `npm run build`
- Output Directory: `dist`

### Step 3: Add Environment Variables

In Vercel Dashboard → Settings → Environment Variables:

```env
VITE_API_BASE_URL=/api/v1
VITE_API_FALLBACK_BASE_URL=https://pine-ai-backend.onrender.com/api/v1
VITE_GOOGLE_CLIENT_ID=your-google-client-id-here
```

### Step 4: Configure Rewrites (vercel.json)

Your `vercel.json` should already have this, but verify:

```json
{
  "buildCommand": "cd client && npm install && npm run build",
  "outputDirectory": "client/dist",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://pine-ai-backend.onrender.com/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

### Step 5: Deploy Frontend
1. Connect your GitHub repo to Vercel
2. Vercel auto-deploys on every push to `testing`/`main`
3. Wait for deployment (1-2 minutes)
4. Note your frontend URL: `https://pine-ai.vercel.app`

**Test Frontend:**
- Visit `https://pine-ai.vercel.app`
- Should load login page
- Try signing up or connecting with token

---

## 🗄️ PART 3: Database Setup (Neon PostgreSQL)

### Step 1: Create Neon Account
1. Go to [neon.tech](https://neon.tech) (PostgreSQL as a Service)
2. Sign up (free tier includes 3 GB storage)
3. Create new project: `pine-ai`

### Step 2: Create Database Connection
1. Neon creates default connection string
2. Format: `postgresql://user:password@db.neon.tech/pine_db`
3. Copy this and add to Render environment variables as `DATABASE_URL`

### Step 3: Initialize Database Schema

SSH into Render backend or run locally:

```bash
# Set environment variable
export DATABASE_URL="postgresql://user:password@db.neon.tech/pine_db"

# Run migrations
cd server
psql $DATABASE_URL -f db/schema.sql
```

Or create a deployment script in `server/scripts/init-db.js`:

```javascript
const { pool } = require('../db/db');
const fs = require('fs');
const path = require('path');

const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf-8');

(async () => {
  try {
    console.log('Initializing database schema...');
    await pool.query(schema);
    console.log('✅ Schema initialized successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Schema initialization failed:', err);
    process.exit(1);
  }
})();
```

Then run: `node server/scripts/init-db.js`

---

## 🔐 Security Checklist

### Before Going Live:

- [ ] **NEVER commit `.env`** — use environment variables
- [ ] Generate strong JWT secrets:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- [ ] Use app-specific password for Gmail (not your main password)
- [ ] Enable HTTPS everywhere (both Render & Vercel do this automatically)
- [ ] Set `NODE_ENV=production` on Render
- [ ] Configure CORS to allow only your Vercel domain
- [ ] Rate-limit API endpoints (already configured in code)
- [ ] Validate all user inputs (already configured)
- [ ] Use helmet for security headers (already in Express)

---

## 📧 Email Configuration

### Option 1: Gmail SMTP (Recommended for testing)

1. Enable 2-factor authentication on Gmail
2. Generate app-specific password:
   - Go to https://myaccount.google.com/apppasswords
   - Select Mail + Windows (or Linux/Mac)
   - Copy generated password

3. Add to Render environment:
   ```env
   EMAIL_PROVIDER=gmail
   GMAIL_USER=your-email@gmail.com
   GMAIL_PASSWORD=your-app-specific-password
   ```

### Option 2: Resend (Production-grade)

1. Go to [resend.com](https://resend.com)
2. Sign up and verify email
3. Get API key from dashboard
4. Add to Render environment:
   ```env
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=your-api-key
   ```

### Option 3: SendGrid (Enterprise)

1. Create SendGrid account
2. Get API key
3. Configure in code (need to update `emailService.js`)

---

## 🧪 Post-Deployment Testing

### Test Backend Endpoints:

```bash
BACKEND_URL="https://pine-ai-backend.onrender.com"

# 1. Health check
curl $BACKEND_URL/health

# 2. Register user
curl -X POST $BACKEND_URL/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!","full_name":"Test User"}'

# 3. Login
curl -X POST $BACKEND_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'

# 4. Get user profile (replace TOKEN)
curl $BACKEND_URL/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Test Frontend:

1. Visit `https://pine-ai.vercel.app`
2. Try **Register** → create account
3. Try **Login** → use registered credentials
4. Try **Token Connect** → paste token from settings
5. **Upload** → try uploading test audio file (`test.wav`)
6. Check dashboard loads and processes file
7. Verify email distribution works

---

## 🚨 Troubleshooting

### Frontend won't load / Blank page
```bash
# Check browser console for errors (F12)
# Check Vercel build logs
# Ensure VITE_API_BASE_URL is set in Vercel
# Verify backend is accessible from frontend
```

### API requests failing with CORS error
```bash
# Update ALLOWED_ORIGINS in Render environment
# Format: https://domain1.com,https://domain2.com
# Restart Render service
```

### Database connection failing
```bash
# Check DATABASE_URL is correct
# Verify Neon database is running
# Check credentials in Neon dashboard
# Try connecting locally first: psql $DATABASE_URL
```

### Email not sending
```bash
# Check GMAIL_PASSWORD is app-specific (not account password)
# Verify EMAIL_PROVIDER is set to 'gmail'
# Check Render logs for SMTP errors
# Try sending from backend logs endpoint
```

### Authentication token not working
```bash
# Verify JWT_SECRET matches between server deployments
# Check token hasn't expired (default 24 hours)
# Ensure refresh token is being stored (7 days)
# Check ALLOWED_ORIGINS includes your frontend
```

---

## 📊 Monitoring & Logs

### Render Logs:
1. Go to Render dashboard
2. Select `pine-ai-backend` service
3. View real-time logs at bottom of page
4. Search for errors: `ERROR`, `failed`, `exception`

### Vercel Logs:
1. Go to Vercel dashboard
2. Select project → Deployments
3. Click deployment → Functions
4. View build and runtime logs

### Database:
```bash
# Connect to Neon directly
psql $DATABASE_URL

# Check tables
\dt

# Count sessions
SELECT COUNT(*) FROM sessions;
```

---

## 🔄 CI/CD Pipeline

### Automatic Deploys:

**Push to GitHub → Auto Deploy:**

```bash
# Development flow:
git checkout -b feature/my-feature
# Make changes
git commit -am "Add feature"
git push origin feature/my-feature
# Create Pull Request
# Once merged to `testing`:
# → Render redeploys backend
# → Vercel redeploys frontend
```

### Manual Rollback:

**Vercel:**
1. Dashboard → Deployments
2. Click older deployment
3. Click three dots → "Promote to Production"

**Render:**
1. Dashboard → Service
2. Click "Manual Deploy"
3. Select previous commit

---

## 📈 Scaling Considerations

### When you grow:

1. **Database:**
   - Neon: Upgrade from free to paid plan
   - Or migrate to AWS RDS PostgreSQL

2. **Backend:**
   - Render: Upgrade from free tier to paid ($7+/month)
   - Or migrate to Railway/Fly.io

3. **Frontend:**
   - Vercel: Usually stays free (generous limits)
   - Add CDN for images (Cloudinary)

4. **Email:**
   - Use Resend ($20/month) for 100k+ emails
   - Or SendGrid for enterprise

5. **File Storage:**
   - Current: Local uploads/ folder
   - Future: AWS S3 or Cloudinary
   - Add to backend: `npm install aws-sdk`

---

## 🎉 Deployment Checklist

Before going LIVE:

- [ ] Backend deployed to Render
- [ ] Frontend deployed to Vercel
- [ ] Database initialized on Neon
- [ ] All environment variables configured
- [ ] JWT secrets changed from defaults
- [ ] Gmail/email service working
- [ ] CORS configured correctly
- [ ] Backend health check responding
- [ ] Frontend loads without errors
- [ ] User registration working
- [ ] User login working
- [ ] Token-based login working
- [ ] Audio upload working
- [ ] Email distribution working
- [ ] Tests passed locally
- [ ] No console errors in browser
- [ ] No errors in Render logs
- [ ] Monitoring/logging set up

---

## 📞 Support

### If deployment fails:

1. **Check Render logs:** Service → Logs → search for ERROR
2. **Check Vercel logs:** Deployments → click deploy → Logs
3. **Check GitHub Actions:** If using CI/CD
4. **Test locally first:** `npm run dev` in both client & server
5. **Verify all env variables:** Compare local `.env` with Render/Vercel

---

## 📚 Additional Resources

- [Render Deployment Docs](https://render.com/docs)
- [Vercel Deployment Docs](https://vercel.com/docs)
- [Neon PostgreSQL Docs](https://neon.tech/docs)
- [Node.js Production Best Practices](https://nodejs.org/en/docs/guides/nodejs-performance-tracks/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

---

**Last Updated:** May 21, 2026  
**Status:** ✅ Ready for Production  
**Estimated Deploy Time:** 15-20 minutes  

🚀 **Let's ship it!**
