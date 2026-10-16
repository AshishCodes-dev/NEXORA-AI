const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const { getJwtSecret, COOKIE_NAME, getCookieOptions, getClearCookieOptions, getGoogleClientId } = require('../config/authConfig');
const { authRateLimiter } = require('../middleware/rateLimiter');

let defaultOAuthClient = null;
function getOAuth2Client(clientId) {
  if (!defaultOAuthClient) {
    defaultOAuthClient = new OAuth2Client(clientId);
  }
  return defaultOAuthClient;
}

let customGoogleTokenVerifier = null;
function setGoogleTokenVerifierForTesting(verifier) {
  customGoogleTokenVerifier = verifier;
}

const router = express.Router();

/**
 * Basic email format validator regex
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/signup
 * Register a new local user with email and password
 */
router.post('/signup', authRateLimiter, async (req, res) => {
  const { name, email, password } = req.body || {};

  // 1. Validate name
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Name is required and cannot be empty or whitespace-only'
    });
  }

  // 2. Validate email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Email is required and cannot be empty or whitespace-only'
    });
  }

  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid email address'
    });
  }

  // 3. Validate password
  if (
    !password ||
    typeof password !== 'string' ||
    password.trim().length === 0 ||
    password.length < 8
  ) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 8 characters long and cannot be whitespace-only'
    });
  }

  try {
    // 4. Duplicate check before creation
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // 5. Hash password with bcryptjs
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 6. Create local user record in MongoDB
    const newUser = await User.create({
      name: trimmedName,
      email: normalizedEmail,
      passwordHash,
      authProvider: 'local',
      firebaseUid: null
    });

    // 7. Return safe user response (never return password or passwordHash)
    return res.status(201).json({
      success: true,
      user: {
        id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        authProvider: newUser.authProvider
      }
    });
  } catch (error) {
    // Handle MongoDB duplicate key race condition safely
    if (error.code === 11000 || (error.name === 'MongoServerError' && error.code === 11000)) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    console.error('[AUTH SIGNUP ERROR]', error.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong while creating the account'
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate local user with email & password and issue secure HTTP-only cookie
 */
router.post('/login', authRateLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  // 1. Validate email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Email is required and cannot be empty or whitespace-only'
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid email address'
    });
  }

  // 2. Validate password
  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Password is required and cannot be empty or whitespace-only'
    });
  }

  try {
    // 3. User lookup by normalized email
    const user = await User.findOne({ email: normalizedEmail });

    // Account enumeration prevention: generic 401 response if user does not exist
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // 4. Verify auth provider is local (do not authenticate Google users with password)
    if (user.authProvider !== 'local' || !user.passwordHash) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // 5. Verify password hash using bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // 6. Sign JWT session token
    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        authProvider: user.authProvider
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    // 7. Set secure HTTP-only cookie
    res.cookie(COOKIE_NAME, token, getCookieOptions());

    // 8. Return safe user response
    return res.status(200).json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        authProvider: user.authProvider
      }
    });
  } catch (error) {
    console.error('[AUTH LOGIN ERROR]', error.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong while processing your login request'
    });
  }
});

/**
 * POST /api/auth/logout
 * Invalidate session by clearing the authentication cookie
 */
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, getClearCookieOptions());

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile from verified session cookie
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    // If the token was valid but the user was deleted from the database
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        authProvider: user.authProvider
      }
    });
  } catch (error) {
    console.error('[AUTH ME ERROR]', error.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong while retrieving user profile'
    });
  }
});

/**
 * POST /api/auth/google
 * Authenticates user via Google Identity Services (GIS) ID token.
 * Verifies token signature, issuer, audience, and email verification claim.
 * Creates new user or links to existing Google user, then issues secure session cookie.
 */
router.post('/google', authRateLimiter, async (req, res) => {
  const { credential } = req.body || {};

  if (!credential || typeof credential !== 'string' || !credential.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Google credential token is required'
    });
  }

  const clientId = getGoogleClientId();
  if (!clientId) {
    return res.status(503).json({
      success: false,
      message: 'Google authentication is not configured on the server'
    });
  }

  let payload;
  try {
    if (customGoogleTokenVerifier) {
      payload = await customGoogleTokenVerifier(credential.trim(), clientId);
    } else {
      const client = getOAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken: credential.trim(),
        audience: clientId
      });
      payload = ticket.getPayload();
    }
  } catch (verifyError) {
    console.warn('[AUTH GOOGLE] Token verification failed:', verifyError.message);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired Google credential token'
    });
  }

  if (!payload || typeof payload !== 'object') {
    return res.status(401).json({
      success: false,
      message: 'Invalid Google token payload'
    });
  }

  const { sub: googleSub, email, email_verified, iss, aud, name } = payload;

  if (!googleSub || typeof googleSub !== 'string' || !googleSub.trim()) {
    return res.status(401).json({
      success: false,
      message: 'Google token missing required subject claim'
    });
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(401).json({
      success: false,
      message: 'Google token missing required email claim'
    });
  }

  const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
  if (!iss || !VALID_ISSUERS.includes(iss)) {
    return res.status(401).json({
      success: false,
      message: 'Invalid Google token issuer'
    });
  }

  if (aud !== clientId) {
    return res.status(401).json({
      success: false,
      message: 'Google token audience mismatch'
    });
  }

  if (email_verified !== true) {
    return res.status(401).json({
      success: false,
      message: 'Google account email is not verified'
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const userName = (name && typeof name === 'string' && name.trim()) ? name.trim() : normalizedEmail.split('@')[0];

  try {
    // 1. Look up user by googleId
    let user = await User.findOne({ googleId: googleSub });

    if (!user) {
      // 2. Check if a user with this email already exists
      const existingUserByEmail = await User.findOne({ email: normalizedEmail });

      if (existingUserByEmail) {
        if (existingUserByEmail.authProvider === 'local' || existingUserByEmail.passwordHash) {
          // Prevent account collision / overwrite of password-protected local accounts
          return res.status(409).json({
            success: false,
            message: 'An account with this email already exists using password authentication. Please log in with your email and password.'
          });
        }

        // If existing user has google provider but googleId wasn't set, link it safely
        if (existingUserByEmail.authProvider === 'google') {
          if (!existingUserByEmail.googleId) {
            existingUserByEmail.googleId = googleSub;
            await existingUserByEmail.save();
            user = existingUserByEmail;
          } else if (existingUserByEmail.googleId !== googleSub) {
            return res.status(409).json({
              success: false,
              message: 'Google account conflict: email is already associated with another Google ID'
            });
          }
        }
      } else {
        // 3. Create new user with authProvider 'google' and passwordHash null
        try {
          user = await User.create({
            name: userName,
            email: normalizedEmail,
            googleId: googleSub,
            authProvider: 'google',
            passwordHash: null,
            firebaseUid: null
          });
        } catch (createErr) {
          if (createErr.code === 11000 || (createErr.name === 'MongoServerError' && createErr.code === 11000)) {
            // Concurrent race condition: attempt lookup of the existing user
            user = await User.findOne({ googleId: googleSub });
            if (!user) {
              return res.status(409).json({
                success: false,
                message: 'An account with this email or Google identity already exists'
              });
            }
          } else {
            throw createErr;
          }
        }
      }
    }

    if (!user) {
      return res.status(500).json({
        success: false,
        message: 'Failed to establish user identity'
      });
    }

    // 4. Sign JWT session token
    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        authProvider: user.authProvider
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    // 5. Set secure HTTP-only cookie
    res.cookie(COOKIE_NAME, token, getCookieOptions());

    // 6. Return safe user profile
    return res.status(200).json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        authProvider: user.authProvider
      }
    });
  } catch (dbError) {
    console.error('[AUTH GOOGLE ERROR]', dbError.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong while processing your Google login request'
    });
  }
});

router.setGoogleTokenVerifierForTesting = setGoogleTokenVerifierForTesting;
router.resetGoogleTokenVerifierForTesting = () => {
  customGoogleTokenVerifier = null;
};

module.exports = router;
