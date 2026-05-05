const { Pool } = require('pg');

const connectionString = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, '');

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  statement_timeout: 30000,          // 30s — kill queries that hang too long
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => {
  console.error('⚠️  Unexpected DB pool error (idle client):', err.message);
});

const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connected at:', result.rows[0].now);

    // Cleanup expired/revoked refresh tokens on startup
    try {
      const cleanup = await pool.query(
        `DELETE FROM refresh_tokens WHERE is_revoked = TRUE OR expires_at < NOW()`
      );
      if (cleanup.rowCount > 0) {
        console.log(`🧹 Cleaned up ${cleanup.rowCount} expired/revoked refresh tokens`);
      }
    } catch (cleanupErr) {
      console.warn('⚠️  Refresh token cleanup failed:', cleanupErr.message);
    }
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
  }
};

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query, testConnection };
