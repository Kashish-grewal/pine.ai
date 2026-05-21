# 🚀 Quick Start: Deploy Pine.AI in 15 Minutes

**TL;DR** — Deploy Pine.AI to production in 3 simple steps.

---

## What You'll Need

1. **GitHub Account** — your code is there
2. **Render Account** — for backend (~$7/month)
3. **Vercel Account** — for frontend (free)
4. **Neon Account** — for database (free tier: 3GB)
5. **Gmail or Resend** — for emails
6. **API Keys** — Groq + Gemini (free)

---

## ⚡ Step 1: Deploy Backend (5 minutes)

### 1a. Create Neon Database
- Go to [neon.tech](https://neon.tech)
- Sign up → Create project → Copy connection string
- Looks like: `postgresql://user:password@db.neon.tech/pine_db`

### 1b. Deploy to Render
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Click **"New +"** → **"Web Service"**
4. Select your Pine.AI repository
5. Configure:
   ```
   Name: pine-ai-backend
   Environment: Node
   Build: cd server && npm install
   Start: cd server && npm start
   Root: ./
   ```
6. Add environment variables (click "Advanced"):
   ```
   DATABASE_URL=<paste from Neon>
   JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   JWT_REFRESH_SECRET=<same format>
   GMAIL_USER=your-email@gmail.com
   GMAIL_PASSWORD=your-app-password-from-Gmail
   GROQ_API_KEY=<get from groq.com>
   GEMINI_API_KEY=<get from console.cloud.google.com>
   NODE_ENV=production
   ```
7. Click **"Create Web Service"**
8. Wait 2-3 minutes ⏳

**Save this URL:** `https://pine-ai-backend.onrender.com`

---

## ⚡ Step 2: Deploy Frontend (5 minutes)

### 2a. Connect to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub
3. Click **"Add New"** → **"Project"**
4. Select Pine.AI repository
5. Configure:
   ```
   Framework: Vite
   Root: ./client
   Build: npm run build
   Output: dist
   ```
6. Add environment variables:
   ```
   VITE_API_BASE_URL=/api/v1
   VITE_API_FALLBACK_BASE_URL=https://pine-ai-backend.onrender.com/api/v1
   VITE_GOOGLE_CLIENT_ID=<optional, leave empty>
   ```
7. Click **"Deploy"**
8. Wait 1-2 minutes ⏳

**Save this URL:** `https://pine-ai.vercel.app`

---

## ⚡ Step 3: Initialize Database (2 minutes)

Run this once to create tables:

```bash
# Set environment
export DATABASE_URL="postgresql://user:password@db.neon.tech/pine_db"

# Initialize schema
cd server
psql $DATABASE_URL -f db/schema.sql

# Should see: psql (15.x) ... pine_db=> CREATE TABLE sessions ...
```

---

## ✅ Test Your Deployment

### 1. Check Backend
```bash
curl https://pine-ai-backend.onrender.com/health
# Should return: {"success":true,"status":"healthy","environment":"production"}
```

### 2. Visit Frontend
Open in browser: **https://pine-ai.vercel.app**

### 3. Try Registration
- Click "Register"
- Create account with test email
- You should receive a confirmation email

### 4. Upload Audio
- Login
- Try uploading `test.wav` from your project
- See if it processes

---

## 🎉 You're Live!

Your Pine.AI is now deployed:
- **Frontend:** https://pine-ai.vercel.app
- **Backend:** https://pine-ai-backend.onrender.com
- **Database:** Neon (PostgreSQL)

---

## 🆘 Troubleshooting

### "Can't find variable: handleDeleteSession"
✅ **Already fixed in latest version**

### "Cannot connect to server"
- Check backend is running: `curl https://pine-ai-backend.onrender.com/health`
- Check CORS in Render env: `ALLOWED_ORIGINS=https://pine-ai.vercel.app`
- Restart Render service

### "Database connection failed"
- Verify `DATABASE_URL` in Render environment
- Check Neon console: Make sure database exists
- Test locally: `psql $DATABASE_URL -c "SELECT 1;"`

### "Email not sending"
- Use app-specific password (not regular password) for Gmail
- If using Resend, check API key is correct
- Check Render logs: View → Logs (search for "email")

### "Blank page / 404"
- Hard refresh: Cmd+Shift+R (macOS) or Ctrl+Shift+R (Windows)
- Check browser console: F12 → Console
- Verify `VITE_API_FALLBACK_BASE_URL` in Vercel

---

## 📈 Next Steps

1. **Monitor:** Check Render/Vercel dashboards daily
2. **Backup:** Set up Neon backups (auto on paid plan)
3. **Custom Domain:** Point `yourdomain.com` to Vercel
4. **SSL Certificate:** Automatically included with Vercel
5. **Analytics:** Add Vercel Analytics for frontend metrics
6. **Error Tracking:** Add Sentry for error monitoring

---

## 💰 Monthly Costs

| Service | Free Tier | Cost | Status |
|---------|-----------|------|--------|
| Vercel | ✅ Yes | Free | Frontend |
| Render | ❌ No | $7/mo | Backend |
| Neon | ✅ Yes (3GB) | $15/mo | Database |
| Gmail | ✅ Yes | Free | Email |
| Groq | ✅ Yes (rate-limited) | Free | LLM |
| Gemini | ✅ Yes | Free | LLM |
| **TOTAL** | - | **~$22/mo** | Start-up |

**Note:** You can use free tiers initially, upgrade as you scale.

---

## 🚀 Now Ship It!

Your Pine.AI is ready for the world! 🎉

For detailed deployment docs, see: **DEPLOYMENT_GUIDE.md**

Questions? Check the troubleshooting section above.

---

**Last Updated:** May 21, 2026  
**Deploy Time:** ~15 minutes  
**Difficulty:** ⭐ Easy  

✨ **Ready to go live!**
