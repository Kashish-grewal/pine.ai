const jwt = require('jsonwebtoken');

// ================================================================
// AUTH MIDDLEWARE
// Sits in front of any route that requires a logged-in user.
// Reads the token from the Authorization header, verifies it,
// and attaches the decoded user payload to req.user.
//
// Usage in a route file:
//   const { protect } = require('../middleware/auth');
//   router.get('/me', protect, (req, res) => { ... })
//
// After protect runs successfully, req.user contains:
//   { userId, email, iat, exp }
// ================================================================
const protect = (req, res, next) => {
  // Header format: "Authorization: Bearer <token>"
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      code: 'NO_TOKEN',
      message: 'Access denied. No token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    // TokenExpiredError → token was valid but is now too old
    // Tell the frontend to silently call POST /auth/refresh
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_EXPIRED',
        message: 'Session expired. Please refresh your token.',
      });
    }

    // JsonWebTokenError → token is malformed or signature is wrong
    // Something is suspicious — force the user back to login
    return res.status(401).json({
      success: false,
      code: 'TOKEN_INVALID',
      message: 'Invalid token. Please log in again.',
    });
  }
};

module.exports = { protect };
