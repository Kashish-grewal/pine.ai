const { OAuth2Client } = require('google-auth-library');

// Initialize Google OAuth2 client
// Your Google Client ID should be in .env
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Verifies a Google ID token
 * Called when user submits the Google Sign-In button
 * 
 * Returns:
 *   - userId: Google user ID
 *   - email: User email
 *   - name: User's full name
 *   - picture: User's profile picture
 */
async function verifyGoogleToken(idToken) {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified,
    };
  } catch (error) {
    console.error('[Google Auth] Token verification failed:', error.message);
    throw new Error('Invalid or expired Google token');
  }
}

module.exports = { verifyGoogleToken };
