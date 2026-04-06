const { Pool } = require('pg');

// ================================================================
// CONNECTION POOL
// ================================================================
// We strip ?sslmode=require from the URL and handle SSL entirely
// through the pool's ssl config object. Mixing both causes pg v8+
// to emit a security warning and behave unpredictably.
// ================================================================
const connectionString = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, '');

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false, // Required for Neon — cert is self-signed
    // This is the pg-native equivalent of sslmode=require
    // (encrypts the connection without verifying the CA chain)
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ================================================================
// POOL ERROR HANDLER
// ================================================================
// pg.Pool emits an 'error' event when a background (idle) client
// loses its connection unexpectedly. Without this listener, Node.js
// treats it as an *unhandled* error event → crashes the process
// with exit code 1. This is the root cause of the "server starts
// then instantly shuts down" bug.
// ================================================================
pool.on('error', (err) => {
  console.error('⚠️  Unexpected DB pool error (idle client):', err.message);
  // Do NOT crash — log and let the app keep running.
  // Individual queries will fail and return proper errors to the client.
});

// ================================================================
// STARTUP CONNECTION TEST
// Wrapped in an async function so index.js can 'await' it.
// ================================================================
const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release(); // Always release the client back to the pool
    console.log('✅ Database connected at:', result.rows[0].now);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    // We log but do NOT re-throw — the server still starts so you
    // can debug connection issues without a hard crash on boot.
  }
};

// ================================================================
// QUERY HELPER
// ================================================================
const query = (text, params) => pool.query(text, params);

module.exports = { pool, query, testConnection };