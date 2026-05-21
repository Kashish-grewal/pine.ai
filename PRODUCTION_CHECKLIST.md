# ✅ Pine.AI Production Deployment Checklist

Use this checklist to ensure everything is ready before going live.

---

## 🔐 Security Checks

- [ ] **No secrets in git** — verify `.env` is in `.gitignore`
- [ ] **JWT_SECRET changed** — generate new: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] **CORS configured** — `ALLOWED_ORIGINS` includes only your domains
- [ ] **HTTPS enforced** — both Vercel & Render use HTTPS
- [ ] **Rate limiting enabled** — `RATE_LIMIT_MAX_REQUESTS` set to reasonable value
- [ ] **Input validation** — all user inputs validated (express-validator)
- [ ] **Password hashing** — bcrypt with salt rounds ≥ 10
- [ ] **SQL injection prevention** — using parameterized queries (pg library)
- [ ] **XSS prevention** — React escapes by default, helmet configured
- [ ] **CSRF protection** — (if using forms, add CSRF tokens)
- [ ] **No console.log secrets** — check code for hardcoded keys
- [ ] **Environment variables** — never using import.meta.env for secrets

---

## 📦 Infrastructure

- [ ] **Backend running on Render**
  - [ ] Service created
  - [ ] GitHub integration active
  - [ ] Environment variables configured
  - [ ] Health check: `curl https://<backend>/health` returns 200

- [ ] **Frontend running on Vercel**
  - [ ] Project imported
  - [ ] Build succeeds without warnings
  - [ ] Environment variables set
  - [ ] Deployments auto-trigger on push

- [ ] **Database initialized on Neon**
  - [ ] Connection established
  - [ ] Schema migrated: `psql $DATABASE_URL -f db/schema.sql`
  - [ ] All tables created: users, sessions, tasks, etc.
  - [ ] Backups configured

---

## 📧 Email Configuration

- [ ] **Email service tested**
  - [ ] Gmail: App-specific password generated
  - [ ] OR Resend: API key verified
  - [ ] OR SendGrid: Account setup complete

- [ ] **Test email sending**
  ```bash
  curl -X POST https://pine-ai-backend.onrender.com/api/v1/email/test \
    -H "Authorization: Bearer <test-token>" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@gmail.com"}'
  ```

- [ ] **Email templates look good**
  - [ ] Responsive design (tested in Gmail, Outlook)
  - [ ] No broken images
  - [ ] Links work correctly
  - [ ] Branding included

---

## 🔌 API Endpoints

Test each critical endpoint:

- [ ] **Health Check** — `GET /health`
  ```bash
  curl https://pine-ai-backend.onrender.com/health
  ```

- [ ] **Registration** — `POST /api/v1/auth/register`
  ```bash
  curl -X POST https://pine-ai-backend.onrender.com/api/v1/auth/register \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"Test123!","full_name":"Test"}'
  ```

- [ ] **Login** — `POST /api/v1/auth/login`
  ```bash
  curl -X POST https://pine-ai-backend.onrender.com/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"Test123!"}'
  ```

- [ ] **Get Profile** — `GET /api/v1/auth/me`
  ```bash
  curl https://pine-ai-backend.onrender.com/api/v1/auth/me \
    -H "Authorization: Bearer <token>"
  ```

- [ ] **Create Session** — `POST /api/v1/sessions/upload`
  - [ ] Audio upload works
  - [ ] File size limits enforced
  - [ ] Processing starts

- [ ] **Get Sessions** — `GET /api/v1/sessions`
  - [ ] Returns list
  - [ ] Pagination works
  - [ ] Filtering works

---

## 🎨 Frontend Tests

- [ ] **Homepage loads** — https://pine-ai.vercel.app
  - [ ] No 404 errors
  - [ ] No console errors (F12)
  - [ ] All assets load
  - [ ] Mobile responsive

- [ ] **Authentication works**
  - [ ] Register new user
  - [ ] Receive confirmation email
  - [ ] Login with credentials
  - [ ] Logout clears session
  - [ ] Token connect works

- [ ] **Dashboard functional**
  - [ ] Sessions list loads
  - [ ] Can create new session
  - [ ] Upload modal appears
  - [ ] File picker works
  - [ ] Drag-drop works

- [ ] **Audio Upload**
  - [ ] Can select .mp3 file
  - [ ] Upload progress shows
  - [ ] Processing indicator appears
  - [ ] Results display after processing

- [ ] **Results Display**
  - [ ] Transcript tab shows audio
  - [ ] Tasks tab shows extracted tasks
  - [ ] Transactions tab shows expenses
  - [ ] Workflow tab shows diagram

- [ ] **Email Distribution**
  - [ ] Modal opens
  - [ ] Can add recipients
  - [ ] Send button works
  - [ ] Confirmation appears
  - [ ] Emails received

- [ ] **Settings Page**
  - [ ] User info displays
  - [ ] Token visible/hidden toggle works
  - [ ] Copy token button works
  - [ ] Connection info accurate

---

## 📱 Browser Compatibility

Test on:

- [ ] Chrome (latest)
  - [ ] Desktop (1920x1080)
  - [ ] Tablet (iPad)
  - [ ] Mobile (iPhone)

- [ ] Safari (latest)
  - [ ] Desktop (MacBook)
  - [ ] Mobile (iPhone)

- [ ] Firefox (latest)
  - [ ] Desktop

- [ ] Edge (latest)
  - [ ] Desktop

**Look for:**
- [ ] No console errors
- [ ] Layout looks correct
- [ ] Buttons clickable
- [ ] Forms submittable
- [ ] Images load
- [ ] Videos/audio play

---

## 🧪 Performance

- [ ] **Lighthouse Score** — Run in Chrome DevTools
  - [ ] Performance: ≥80
  - [ ] Accessibility: ≥80
  - [ ] Best Practices: ≥80
  - [ ] SEO: ≥90

- [ ] **Page Load Time** — Under 3 seconds
  ```bash
  time curl https://pine-ai.vercel.app > /dev/null
  ```

- [ ] **API Response Time** — Under 1 second
  ```bash
  time curl https://pine-ai-backend.onrender.com/health > /dev/null
  ```

- [ ] **Database Query Time** — Under 100ms
  - Check Neon dashboard → Monitoring

---

## 🚨 Error Handling

- [ ] **404 Page** — custom error page
- [ ] **500 Page** — generic error (no stack trace)
- [ ] **Network Error** — user-friendly message
- [ ] **Timeout** — with retry option
- [ ] **Validation Errors** — clear messages
- [ ] **Auth Errors** — redirect to login
- [ ] **File Upload Errors** — specific reason (size, type)
- [ ] **Email Errors** — graceful fallback

---

## 📊 Monitoring & Logging

- [ ] **Render Logs** — accessible and readable
  - [ ] No ERROR lines
  - [ ] No WARN lines (except expected)
  - [ ] Info logging working

- [ ] **Vercel Logs** — deployed successfully
  - [ ] Build logs clean
  - [ ] No warnings

- [ ] **Error Tracking Setup** (optional but recommended)
  - [ ] Sentry account created
  - [ ] Sentry DSN configured
  - [ ] Test error captured

- [ ] **Database Monitoring**
  - [ ] Neon dashboard accessible
  - [ ] Query performance visible
  - [ ] Connections stable

---

## 🔄 Backup & Recovery

- [ ] **Database Backups** — configured
  - [ ] Neon: Automatic daily backups
  - [ ] Or scheduled backup script

- [ ] **Code Backup** — GitHub
  - [ ] All important branches protected
  - [ ] Main/testing branch requires review

- [ ] **Secrets Backup** — documented
  - [ ] Write down JWT_SECRET (encrypted)
  - [ ] Write down API keys (encrypted)
  - [ ] Store securely (password manager)

- [ ] **Disaster Recovery Plan** — tested
  - [ ] Can restore from GitHub
  - [ ] Can restore from database backup
  - [ ] Documented recovery steps

---

## 📋 Documentation

- [ ] **README.md** — updated
  - [ ] Links to deployed app
  - [ ] Setup instructions
  - [ ] Feature overview

- [ ] **DEPLOYMENT_GUIDE.md** — complete
  - [ ] Step-by-step instructions
  - [ ] Troubleshooting section
  - [ ] Environment variables documented

- [ ] **API Documentation** — complete
  - [ ] All endpoints documented
  - [ ] Request/response examples
  - [ ] Error codes explained

- [ ] **Architecture Diagram** — created
  - [ ] Frontend, Backend, Database
  - [ ] Data flow
  - [ ] External services

---

## 🎯 Launch Checklist

Before announcing to users:

- [ ] **Test as new user** — go through entire flow
- [ ] **Test as returning user** — login and use features
- [ ] **Test on mobile** — responsive design works
- [ ] **Test file upload** — with real audio file
- [ ] **Test email** — receive notification
- [ ] **Check all links** — no broken links
- [ ] **Check contact info** — support email works
- [ ] **Check privacy policy** — link to page
- [ ] **Check terms of service** — link to page

---

## 🚀 Final Pre-Launch

- [ ] **Code Review** — at least one other person reviews
- [ ] **Security Audit** — check for vulnerabilities
  ```bash
  npm audit
  npm audit fix
  ```

- [ ] **Dependencies Updated** — no major security issues
  ```bash
  npm outdated
  npm update
  ```

- [ ] **Staging Test** — deploy to staging first
- [ ] **Database Backup** — backup before launch
- [ ] **Rollback Plan** — know how to revert
- [ ] **On-call Schedule** — who monitors first week

---

## 🎉 Launch!

- [ ] **Announce** — share link on social media
- [ ] **Monitor** — watch logs for errors
- [ ] **Respond** — answer user questions
- [ ] **Celebrate** — you did it! 🎉

---

## 📊 Post-Launch Monitoring

For first 24 hours:

- [ ] Check backend logs every hour
- [ ] Monitor for 500 errors
- [ ] Check database performance
- [ ] Verify emails are sending
- [ ] Monitor Vercel deployment status
- [ ] Be ready to rollback if needed

For first week:

- [ ] Daily error review
- [ ] Weekly performance review
- [ ] User feedback collection
- [ ] Bug fix prioritization
- [ ] Performance optimization

---

## ✅ Completion

When ALL items above are checked:

**You're ready to launch! 🚀**

---

**Last Updated:** May 21, 2026  
**Estimated Time:** 2-4 hours  
**Difficulty:** ⭐⭐ Moderate  

Deploy with confidence! 🎯
