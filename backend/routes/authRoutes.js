const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const router = express.Router();

/**
 * Basic email format validator regex
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

module.exports = router;
