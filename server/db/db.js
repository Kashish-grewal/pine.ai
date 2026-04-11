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
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ================================================================
// POOL ERROR HANDLER (IMPORTANT)
// ================================================================
pool.on('error', (err) => {
  console.error('⚠️ Unexpected DB pool error:', err.message);
});

// ================================================================
// STARTUP CONNECTION TEST
// ================================================================
const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connected at:', result.rows[0].now);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
  }
};

// ================================================================
// QUERY HELPER
// ================================================================
const query = (text, params) => pool.query(text, params);

// ================================================================
module.exports = { pool, query, testConnection };