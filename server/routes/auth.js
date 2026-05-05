const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { query } = require('../db/db');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ================================================================
// AUTH-SPECIFIC RATE LIMITER
// Stricter than the global limiter — 10 attempts per 15 minutes.
// Applied only to login and register below.
// Prevents brute force password attacks.
// ================================================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again in 15 minutes.',
  },
});

// ================================================================
// TOKEN HELPERS
// Two tokens are issued on every login:
//
// ACCESS TOKEN (7 days — extended for MVP)
//   - In production, reduce to 15 min and enable silent refresh.
//   - Stored in localStorage on the frontend for simplicity.
//   - For production security, move to memory + httpOnly refresh cookies.
//
// REFRESH TOKEN (7 days)
//   - Long-lived. Sent only to POST /refresh.
//   - Stored as a SHA-256 hash in the DB (never raw).
//   - Can be instantly revoked by marking is_revoked = TRUE.
// ================================================================
const generateAccessToken = (userId, email) => {
  return jwt.sign(
    { userId, email },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '7d' }  // Extended — frontend doesn't auto-refresh
  );
};

const generateRefreshToken = (userId) => {
  // crypto.randomBytes gives a cryptographically secure random string
  // Much stronger than Math.random()
  const token = crypto.randomBytes(64).toString('hex');

  // We hash before storing — if DB is ever breached,
  // the attacker gets hashes, not usable tokens
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  return { token, hash };
};

const storeRefreshToken = async (userId, hash) => {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );
};

// ================================================================
// VALIDATION RULES
// express-validator checks inputs before they touch the DB.
// If validation fails, we return errors immediately.
// Never trust client input.
// ================================================================
const registerValidation = [
  body('email')
    .isEmail().withMessage('Please provide a valid email address.')
    .normalizeEmail(), // lowercases, removes dots in gmail etc.
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/\d/).withMessage('Password must contain at least one number.'),
  body('full_name')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Name must be under 100 characters.'),
];

const loginValidation = [
  body('email').isEmail().withMessage('Invalid email.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

// ================================================================
// POST /api/v1/auth/register
// ================================================================
router.post('/register', authLimiter, registerValidation, async (req, res, next) => {
  try {
    // 1. Check validation errors first
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
      });
    }

    const { email, password, full_name } = req.body;

    // 2. Check if user already exists
    const existing = await query(
      'SELECT user_id FROM users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
      });
    }

    // 3. Hash the password
    // Cost factor 12 = takes ~250ms to hash.
    // Slow enough to make brute force painful, fast enough for users.
    const password_hash = await bcrypt.hash(password, 12);

    // 4. Insert new user
    const result = await query(
      `INSERT INTO users (email, full_name, password_hash, auth_provider)
       VALUES ($1, $2, $3, 'local')
       RETURNING user_id, email, full_name, created_at`,
      [email, full_name || null, password_hash]
    );

    const user = result.rows[0];

    // 5. Issue tokens
    const accessToken = generateAccessToken(user.user_id, user.email);
    const { token: refreshToken, hash: refreshHash } = generateRefreshToken(user.user_id);
    await storeRefreshToken(user.user_id, refreshHash);

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      data: {
        user: {
          id: user.user_id,
          email: user.email,
          full_name: user.full_name,
        },
        accessToken,
        refreshToken,
      },
    });

  } catch (err) {
    next(err); // Passes to global error handler in index.js
  }
});

// ================================================================
// POST /api/v1/auth/login
// ================================================================
router.post('/login', authLimiter, loginValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
      });
    }

    const { email, password } = req.body;

    // 1. Find user
    const result = await query(
      'SELECT user_id, email, full_name, password_hash, auth_provider FROM users WHERE email = $1',
      [email]
    );

    const user = result.rows[0];

    // 2. Generic error message — never tell the attacker which part is wrong
    // "email not found" tells them valid emails. We don't do that.
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // 3. Block Google OAuth users from logging in with a password
    if (user.auth_provider === 'google') {
      return res.status(400).json({
        success: false,
        message: 'This account uses Google Sign-In. Please log in with Google.',
      });
    }

    // 4. Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // 5. Issue tokens
    const accessToken = generateAccessToken(user.user_id, user.email);
    const { token: refreshToken, hash: refreshHash } = generateRefreshToken(user.user_id);
    await storeRefreshToken(user.user_id, refreshHash);

    res.json({
      success: true,
      message: 'Logged in successfully.',
      data: {
        user: {
          id: user.user_id,
          email: user.email,
          full_name: user.full_name,
        },
        accessToken,
        refreshToken,
      },
    });

  } catch (err) {
    next(err);
  }
});

// ================================================================
// POST /api/v1/auth/refresh
// Called silently by the frontend when access token expires.
// User never sees this happen — it's automatic.
// ================================================================
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required.',
      });
    }

    // Hash the incoming token and look it up in the DB
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const result = await query(
      `SELECT rt.token_id, rt.user_id, rt.expires_at, rt.is_revoked,
              u.email, u.full_name
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.user_id
       WHERE rt.token_hash = $1`,
      [hash]
    );

    const tokenRow = result.rows[0];

    if (!tokenRow) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
    }

    if (tokenRow.is_revoked) {
      return res.status(401).json({ success: false, message: 'Refresh token has been revoked.' });
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return res.status(401).json({ success: false, message: 'Refresh token expired. Please log in again.' });
    }

    // Issue a new access token
    const accessToken = generateAccessToken(tokenRow.user_id, tokenRow.email);

    res.json({
      success: true,
      data: { accessToken },
    });

  } catch (err) {
    next(err);
  }
});

// ================================================================
// POST /api/v1/auth/logout
// Revokes the refresh token in the DB — dead instantly.
// The access token will expire on its own in ≤15 minutes.
// ================================================================
router.post('/logout', protect, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await query(
        'UPDATE refresh_tokens SET is_revoked = TRUE WHERE token_hash = $1',
        [hash]
      );
    }

    res.json({ success: true, message: 'Logged out successfully.' });

  } catch (err) {
    next(err);
  }
});

// ================================================================
// GET /api/v1/auth/me
// Returns the current logged-in user's profile.
// Requires a valid access token — protect middleware handles that.
// ================================================================
router.get('/me', protect, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT user_id, email, full_name, avatar_url, auth_provider, created_at FROM users WHERE user_id = $1',
      [req.user.userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.user_id,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
          auth_provider: user.auth_provider,
          member_since: user.created_at,
        },
      },
    });

  } catch (err) {
    next(err);
  }
});

// ================================================================
// POST /api/v1/auth/google
// Google OAuth — verify ID token from Google Sign-In
// ================================================================
router.post('/google', async (req, res, next) => {
  try {
    const { idToken, credential } = req.body;
    const token = idToken || credential;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token (idToken or credential) is required.',
      });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({
        success: false,
        message: 'Google OAuth is not configured on this server.',
      });
    }

    // Verify the Google ID token
    const { OAuth2Client } = require('google-auth-library');
    const googleClient = new OAuth2Client(clientId);

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: clientId,
      });
    } catch (verifyErr) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token. Please try signing in again.',
      });
    }

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Google account has no email address.',
      });
    }

    // Find or create user
    let userResult = await query(
      'SELECT user_id, email, full_name, avatar_url, auth_provider FROM users WHERE google_id = $1',
      [googleId]
    );

    let user;

    if (userResult.rows.length > 0) {
      // Existing Google user — update profile info
      user = userResult.rows[0];
      await query(
        `UPDATE users SET full_name = COALESCE($1, full_name),
                          avatar_url = COALESCE($2, avatar_url),
                          updated_at = NOW()
         WHERE user_id = $3`,
        [name, picture, user.user_id]
      );
      user.full_name = name || user.full_name;
      user.avatar_url = picture || user.avatar_url;
    } else {
      // Check if email exists with local auth
      const emailResult = await query(
        'SELECT user_id, email, full_name, auth_provider FROM users WHERE email = $1',
        [email]
      );

      if (emailResult.rows.length > 0) {
        // Link Google to existing local account
        user = emailResult.rows[0];
        await query(
          `UPDATE users SET google_id = $1,
                            avatar_url = COALESCE($2, avatar_url),
                            auth_provider = 'google',
                            updated_at = NOW()
           WHERE user_id = $3`,
          [googleId, picture, user.user_id]
        );
      } else {
        // Create new user
        const createResult = await query(
          `INSERT INTO users (email, full_name, avatar_url, google_id, auth_provider)
           VALUES ($1, $2, $3, $4, 'google')
           RETURNING user_id, email, full_name, avatar_url`,
          [email, name || email.split('@')[0], picture || null, googleId]
        );
        user = createResult.rows[0];
      }
    }

    // Issue tokens (same as local login)
    const accessToken = generateAccessToken(user.user_id, user.email || email);
    const { token: refreshToken, hash: refreshHash } = generateRefreshToken(user.user_id);
    await storeRefreshToken(user.user_id, refreshHash);

    res.json({
      success: true,
      message: 'Logged in with Google.',
      data: {
        user: {
          id: user.user_id,
          email: user.email || email,
          full_name: user.full_name || name,
          avatar_url: user.avatar_url || picture,
        },
        accessToken,
        refreshToken,
      },
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
