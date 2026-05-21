# 🚀 Pine.AI — 100% FREE Deployment Guide

Deploy Pine.AI completely free using only free-tier services!

---

## 💰 Cost Breakdown

| Service | Free Tier | Cost |
|---------|-----------|------|
| **Vercel** | Unlimited (generous limits) | ✅ FREE |
| **Railway** | $5/month credit (covers small app) | ✅ FREE (with credit) |
| **Neon** | 3GB PostgreSQL | ✅ FREE |
| **Gmail** | Unlimited SMTP | ✅ FREE |
| **Groq** | Rate-limited LLM | ✅ FREE |
| **Gemini** | Rate-limited LLM | ✅ FREE |
| **GitHub** | Unlimited repos | ✅ FREE |
| **TOTAL** | **Everything** | **✅ $0/month** |

---

## 🎯 Architecture (100% Free)

```
┌─────────────────────────────────────────────────────┐
│              Vercel (FREE)                           │
│  - React + Vite Frontend                             │
│  - Unlimited bandwidth                               │
│  - Auto-deploy from GitHub                           │
│  - Global CDN included                               │
└──────────────┬──────────────────────────────────────┘
               │
               ↓ HTTPS
               │
┌──────────────┴──────────────────────────────────────┐
│              Railway (FREE TIER)                     │
│  - Node.js Express Backend                           │
│  - $5/month free credit (covers small app)           │
│  - PostgreSQL included                               │
│  - Auto-deploy from GitHub                           │
└──────────────┬──────────────────────────────────────┘
               │
               ↓
┌──────────────┴──────────────────────────────────────┐
│              Neon PostgreSQL (FREE)                  │
│  - 3GB storage                                       │
│  - Automatic backups                                 │
│  - Point-in-time restore                            │
└─────────────────────────────────────────────────────┘
```

---

## ⚡ Step 1: Set Up Neon Database (FREE)

1. **Go to:** https://neon.tech
2. **Sign up:** Create free account
3. **Create Project:**
   - Name: `pine-ai`
   - Database: Automatically created
4. **Get Connection String:**
   - Copy: `postgresql://user:password@db.neon.tech/pine_db`
   - Save this for later

✅ **Cost:** $0 (3GB free tier)

---

## ⚡ Step 2: Deploy Backend to Railway (FREE)

### 2a. Create Railway Account
1. **Go to:** https://railway.app
2. **Sign up:** GitHub login recommended
3. **Create new project** → GitHub repo

### 2b. Configure Railway Service
1. Click **"New"** → **"GitHub Repo"**
2. Select `pine-ai` repository
3. Set root: `server`
4. Build command: `npm install`
5. Start command: `npm start`

### 2c. Add Environment Variables
In Railway dashboard, add:
```
DATABASE_URL=postgresql://user:password@db.neon.tech/pine_db
JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
JWT_REFRESH_SECRET=<generate same way>
NODE_ENV=production
GMAIL_USER=your-email@gmail.com
GMAIL_PASSWORD=your-app-password
GROQ_API_KEY=your-groq-key
GEMINI_API_KEY=your-gemini-key
```

### 2d. Deploy
- Click **"Deploy"**
- Wait 2-3 minutes
- Note your URL: `https://pine-ai-backend-xxxx.railway.app`

✅ **Cost:** $0 ($5/month free credit covers this)

---

## ⚡ Step 3: Deploy Frontend to Vercel (FREE)

### 3a. Connect to Vercel
1. **Go to:** https://vercel.com
2. **Sign up:** GitHub login
3. **Import project:** Select `pine-ai`
4. **Configure:**
   - Framework: Vite
   - Root: `./client`
   - Build: `npm run build`
   - Output: `dist`

### 3b. Add Environment Variables
```
VITE_API_BASE_URL=/api/v1
VITE_API_FALLBACK_BASE_URL=https://pine-ai-backend-xxxx.railway.app/api/v1
```

### 3c. Deploy
- Click **"Deploy"**
- Wait 1-2 minutes
- URL: `https://pine-ai.vercel.app`

✅ **Cost:** $0 (unlimited free tier)

---

## ⚡ Step 4: Initialize Database (FREE)

Connect to Neon and create tables:

```bash
# Set your connection string
export DATABASE_URL="postgresql://user:password@db.neon.tech/pine_db"

# Run migrations
psql $DATABASE_URL -f server/db/schema.sql
```

✅ **Cost:** $0

---

## ✅ Test Your Deployment

```bash
# 1. Backend health
curl https://pine-ai-backend-xxxx.railway.app/health

# 2. Visit frontend
https://pine-ai.vercel.app

# 3. Try signing up
# Register with test email

# 4. Upload audio
# Test the full pipeline
```

---

## 💾 Free Tier Limits (Should be fine for testing)

| Service | Free Limit | Your Usage | Status |
|---------|-----------|-----------|---------|
| **Vercel** | Unlimited | Frontend only | ✅ Fine |
| **Railway** | $5/month credit | ~$3-4/month for small app | ✅ Fine |
| **Neon** | 3GB storage | Your database | ✅ Fine |
| **Gmail** | Unlimited | Emails via SMTP | ✅ Fine |
| **Groq** | Rate-limited | Free LLM calls | ✅ Fine |
| **Gemini** | Rate-limited | Free LLM fallback | ✅ Fine |

---

## 🔄 When You Need to Scale

If you outgrow free tiers:

### Database (Neon)
- **Free:** 3GB
- **Upgrade:** $15/month for 10GB
- **Or:** Railway includes PostgreSQL

### Backend (Railway)
- **Free:** $5/month credit
- **Pay as you grow:** Usage-based pricing

### Frontend (Vercel)
- **Free:** Unlimited (very generous)
- **Enterprise:** If you need premium support

---

## 🆘 Free-Tier Specific Issues

### "Backend going to sleep"
Railway free tier doesn't sleep, so this shouldn't happen.

### "Database full"
Monitor usage in Neon console. 3GB is typically enough for:
- 10,000+ users
- 1,000+ sessions
- Unlimited transcripts/tasks

### "Hitting rate limits"
Groq/Gemini free tier has limits but usually enough for testing.

### "Database connection slow"
Neon is fast. If slow:
1. Check Neon dashboard for performance
2. Verify connection pooling enabled
3. Check Railway logs

---

## 📊 Monthly Costs After Scaling

If you get viral and need paid tiers:

| Milestone | Cost | Services |
|-----------|------|----------|
| **MVP (Now)** | $0 | Free tiers only |
| **100 users** | $0 | Still fits in free |
| **1,000 users** | $15 | Neon upgrade only |
| **10,000 users** | $30 | Neon + Railway upgrade |
| **100,000 users** | $200+ | All services upgraded |

**Bottom line:** Stay free for as long as possible!

---

## 🎯 Quick Deploy (30 minutes)

```
1. Create Neon DB (3 min)
   └─ Get connection string

2. Deploy to Railway (5 min)
   └─ GitHub integration
   └─ Add env variables
   └─ Get backend URL

3. Deploy to Vercel (5 min)
   └─ GitHub integration
   └─ Add env variables
   └─ Get frontend URL

4. Initialize DB (2 min)
   └─ Run schema

5. Test (10 min)
   └─ Visit frontend
   └─ Try signup
   └─ Upload audio
   └─ Check email

TOTAL: 30 minutes ✅
```

---

## 🚀 One-Command Deploy (Almost!)

After setup:

```bash
# Every time you push to GitHub:
git push origin testing

# Railway + Vercel automatically redeploy! 🎉
```

---

## 💡 Pro Tips for Free Tier

1. **Monitor Neon storage** — Keep under 3GB
2. **Monitor Railway credits** — Should use <$5/month
3. **Optimize queries** — Faster = less compute
4. **Cache results** — Reduce database hits
5. **Use free LLM calls** — Groq/Gemini are generous

---

## 🎉 You're 100% Free!

Your Pine.AI is deployed completely free:

✅ Frontend on Vercel (FREE)
✅ Backend on Railway (FREE with credit)
✅ Database on Neon (FREE)
✅ Email via Gmail (FREE)
✅ LLMs via Groq/Gemini (FREE)

**Total monthly cost: $0** 🎊

---

## 📚 Additional Free Resources

### Free Tier Services
- **GitHub:** Free repos + Actions
- **Cloudinary:** Free image storage (if needed)
- **Auth0:** Free authentication (alternative)
- **Sentry:** Free error tracking

### Money-Saving Tips
1. Use GitHub Actions for CI/CD (FREE)
2. Use Neon's free tier backup (FREE)
3. Cache aggressively to save compute
4. Monitor usage regularly
5. Set up billing alerts

---

## 🚨 Heads Up

After you're successful and get users:

1. **Neon will fill up** — Plan upgrade at 2GB usage
2. **Railway credits might run out** — Switch to paid or another backend
3. **You might hit rate limits** — Use paid LLM API
4. **Traffic might exceed limits** — Vercel is very generous though

**But for launching and testing: 100% FREE!** ✅

---

**Last Updated:** May 21, 2026  
**Total Cost:** $0/month  
**Difficulty:** ⭐ Easy  
**Status:** ✅ PRODUCTION READY (Free tier)

🚀 **Deploy free right now!**
