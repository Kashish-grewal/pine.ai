require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { testConnection } = require('./db/db');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
// ---------------------------------------------------------------------------
const authRoutes = require('./routes/auth');
app.use('/api/v1/auth', authRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
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