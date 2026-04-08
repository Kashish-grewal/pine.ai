require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { testConnection } = require('./db/db');

const app = express();
const PORT = process.env.PORT || 5001;

// ---------------------------------------------------------------------------
// Ensure uploads/temp directory exists on startup
// ---------------------------------------------------------------------------
// When this project is cloned fresh or deployed to a new machine, the
// uploads/temp folder won't exist. This creates it automatically so the
// first upload doesn't crash with ENOENT.
// ---------------------------------------------------------------------------
const uploadsDir = path.join(__dirname, 'uploads', 'temp');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads/temp directory');
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet());

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const configuredClientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

const corsOptions = {
  origin: (origin, cb) => {
    // Allow non-browser clients (curl, server-to-server) with no Origin header.
    if (!origin) return cb(null, true);

    if (origin === configuredClientUrl) return cb(null, true);

    // In development, allow localhost/127.0.0.1 on any port.
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin)) {
      return cb(null, true);
    }

    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

// ---------------------------------------------------------------------------
// Body parser
// ---------------------------------------------------------------------------
// Note: multer handles multipart/form-data (file uploads) separately.
// express.json() only handles application/json requests.
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '10kb' })); // 10kb cap prevents JSON bomb attacks

// ---------------------------------------------------------------------------
// Global rate limiter — all routes
// ---------------------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
});
app.use(globalLimiter);

// ---------------------------------------------------------------------------
// Stricter rate limiter — auth routes only
// ---------------------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again in 15 minutes.', code: 'AUTH_RATE_LIMITED' },
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');

app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/sessions', sessionRoutes);

// ---------------------------------------------------------------------------
// API root
// ---------------------------------------------------------------------------
// Helpful when opening http://localhost:5001 in a browser.
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'pine.ai backend is running.',
    docs: {
      health: '/health',
      authBase: '/api/v1/auth',
      sessionsBase: '/api/v1/sessions',
    },
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ success: true, status: 'healthy', environment: process.env.NODE_ENV });
});

// ---------------------------------------------------------------------------
// 404 handler — catches requests to routes that don't exist
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found.` });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// Any time a route calls next(err), it lands here. We log it on the server
// and return a clean JSON response — never a stack trace to the client.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.originalUrl}`, err);

  const statusCode = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred.'
    : err.message;

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const startServer = async () => {
  await testConnection();

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down gracefully...');
    server.close(() => {
      console.log('✅ Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startServer();