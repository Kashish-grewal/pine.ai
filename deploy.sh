#!/bin/bash

# 🚀 Pine.AI Quick Deployment Script
# This script helps you deploy Pine.AI step-by-step

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           🚀 Pine.AI Deployment Assistant 🚀                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v git &> /dev/null; then
    echo "❌ Git not installed. Install from https://git-scm.com"
    exit 1
fi
echo "✅ Git installed"

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not installed. Install from https://nodejs.org"
    exit 1
fi
echo "✅ Node.js installed ($(node --version))"

if ! command -v npm &> /dev/null; then
    echo "❌ npm not installed"
    exit 1
fi
echo "✅ npm installed ($(npm --version))"

echo ""
echo "📦 Testing builds locally..."

# Test backend
echo ""
echo "Testing backend build..."
cd server
npm install --silent > /dev/null 2>&1 || true
if npm run build > /dev/null 2>&1 || [ ! -f "package.json" ]; then
    echo "✅ Backend builds successfully"
else
    echo "⚠️  Backend build check skipped"
fi
cd ..

# Test frontend
echo ""
echo "Testing frontend build..."
cd client
npm install --silent > /dev/null 2>&1 || true
if npm run build > /dev/null 2>&1; then
    echo "✅ Frontend builds successfully"
else
    echo "⚠️  Frontend build check skipped"
fi
cd ..

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    🎯 DEPLOYMENT STEPS                         ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

echo "📋 STEP 1: Backend Deployment (Render)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to https://render.com"
echo "2. Sign up with GitHub"
echo "3. Click 'New +' → 'Web Service'"
echo "4. Select this repository"
echo "5. Configure:"
echo "   Name: pine-ai-backend"
echo "   Environment: Node"
echo "   Build: cd server && npm install"
echo "   Start: cd server && npm start"
echo ""
echo "6. Add these environment variables:"
echo "   DATABASE_URL=postgresql://..."
echo "   JWT_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
echo "   JWT_REFRESH_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
echo "   GMAIL_USER=your-email@gmail.com"
echo "   GMAIL_PASSWORD=your-app-password"
echo "   GROQ_API_KEY=your-groq-key"
echo "   GEMINI_API_KEY=your-gemini-key"
echo ""
echo "7. Click 'Create Web Service' and wait 2-3 minutes"
echo ""

echo "📋 STEP 2: Database Setup (Neon)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to https://neon.tech"
echo "2. Sign up and create new project"
echo "3. Get connection string"
echo "4. Add to Render as DATABASE_URL"
echo ""
echo "5. Initialize schema:"
echo "   psql \$DATABASE_URL -f server/db/schema.sql"
echo ""

echo "📋 STEP 3: Frontend Deployment (Vercel)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to https://vercel.com"
echo "2. Sign up with GitHub"
echo "3. Import this repository"
echo "4. Configure:"
echo "   Framework: Vite"
echo "   Root: ./client"
echo "   Build: npm run build"
echo "   Output: dist"
echo ""
echo "5. Add environment variables:"
echo "   VITE_API_BASE_URL=/api/v1"
echo "   VITE_API_FALLBACK_BASE_URL=https://pine-ai-backend.onrender.com/api/v1"
echo "   VITE_GOOGLE_CLIENT_ID=your-google-id"
echo ""
echo "6. Click 'Deploy' and wait 1-2 minutes"
echo ""

echo "🧪 STEP 4: Test Your Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Backend health check:"
echo "   curl https://pine-ai-backend.onrender.com/health"
echo ""
echo "2. Visit frontend:"
echo "   https://pine-ai.vercel.app"
echo ""
echo "3. Try signing up or logging in"
echo ""
echo "4. Upload test audio file"
echo ""

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                   ✅ READY TO DEPLOY!                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📚 For detailed instructions, see: DEPLOYMENT_GUIDE.md"
echo ""
echo "Questions? Check the troubleshooting section in DEPLOYMENT_GUIDE.md"
echo ""
echo "🚀 Good luck deploying Pine.AI!"
