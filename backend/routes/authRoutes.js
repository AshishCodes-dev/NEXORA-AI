const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * Basic email format validator regex
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Authentication configuration and cookie helpers
 */
const JWT_SECRET = process.env.JWT_SECRET || 'nexora_dev_jwt_secret_change_in_production';
const COOKIE_NAME = 'nexora_token';

const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    path: '/'
  };
};

/**
 * POST /api/auth/signup
 * Register a new local user with email and password
 */
router.post('/signup', async (req, res) => {
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
router.post('/login', async (req, res) => {
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
      JWT_SECRET,
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
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/'
  });

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

module.exports = router;
