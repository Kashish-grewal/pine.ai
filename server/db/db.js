const { Pool } = require('pg');

// ================================================================
// CONNECTION STRING CLEANUP
// ================================================================
const connectionString = (process.env.DATABASE_URL || '')
  .replace(/[?&]sslmode=[^&]*/g, '');

// ================================================================
// CONNECTION POOL
// ================================================================
const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false, // Required for Neon
  },
  max: 10,
  idleTimeoutMillis: 20000,       // Recycle idle connections faster (Neon drops them anyway)
  connectionTimeoutMillis: 30000, // 30s — Neon cold starts can take 10-20s
});

// ── Keepalive: prevent Neon from dropping idle connections ─────────
// Neon serverless kills connections after ~5min idle. This pings every 4min.
setInterval(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.warn('[DB Keepalive] Ping failed:', err.message);
  }
}, 4 * 60 * 1000);

// ================================================================
// POOL ERROR HANDLER (IMPORTANT)
// ================================================================
pool.on('error', (err) => {
  console.error('⚠️ Unexpected DB pool error:', err.message);
});

// ================================================================
// STARTUP CONNECTION TEST — retries for Neon cold starts
// ================================================================
const testConnection = async (retries = 3, delayMs = 5000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT NOW()');
      client.release();
      console.log('✅ Database connected at:', result.rows[0].now);
      return; // success — exit
    } catch (err) {
      console.error(`❌ Database connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) {
        console.log(`⏳ Retrying in ${delayMs / 1000}s (Neon cold-start)...`);
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        console.error('⚠️ All DB connection attempts failed. Server will start but DB queries may fail.');
      }
    }
  }
};

// ================================================================
// QUERY HELPER
// ================================================================
const query = (text, params) => pool.query(text, params);

// ================================================================
module.exports = { pool, query, testConnection };