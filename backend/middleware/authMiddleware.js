const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'nexora_dev_jwt_secret_change_in_production';
const COOKIE_NAME = 'nexora_token';

/**
 * Authentication Middleware
 * Identifies the currently authenticated user from the HTTP-only nexora_token cookie.
 */
const authMiddleware = (req, res, next) => {
  // 1. Read token from cookie
  const token = req.cookies && req.cookies[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // 2. Verify JWT signature and expiration
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // 3. Attach authenticated identity to req.user
    req.user = {
      id: decoded.id,
      email: decoded.email,
      authProvider: decoded.authProvider
    };

    next();
  } catch (error) {
    // Malformed, invalid, or expired tokens all resolve to generic 401
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
};

module.exports = authMiddleware;
