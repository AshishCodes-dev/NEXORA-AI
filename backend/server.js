const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { validateAuthConfig } = require('./config/authConfig');
const { notFoundHandler, centralErrorHandler } = require('./middleware/errorHandler');
const missionsRouter = require('./routes/missions');
const authRouter = require('./routes/authRoutes');

// 1. Load environment variables
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  } else {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim();
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    });
  }
}

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware with 100kb request body limit for production safety
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// CORS configuration restricted to development frontend origin
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || 'http://localhost:5173');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'NEXORA backend is running'
  });
});

// Missions routes
app.use('/api/missions', missionsRouter);

// Authentication routes
app.use('/api/auth', authRouter);

// 404 handler for unknown routes
app.use(notFoundHandler);

// Central error handler
app.use(centralErrorHandler);

let serverInstance = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler for HTTP server and database connections
 * @param {string} signal
 * @returns {Promise<void>}
 */
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[SHUTDOWN] Received ${signal}. Starting graceful shutdown...`);

  // Failsafe timer (10s) in case graceful shutdown hangs
  const forceTimer = setTimeout(() => {
    console.error('[SHUTDOWN] Forceful shutdown initiated after timeout.');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }, 10000);
  if (forceTimer.unref) forceTimer.unref();

  try {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
      console.log('[SHUTDOWN] HTTP server closed.');
    }
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
      console.log('[DATABASE] MongoDB connection closed.');
    }
    clearTimeout(forceTimer);
    console.log('[SHUTDOWN] Graceful shutdown completed cleanly.');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
  } catch (err) {
    console.error(`[SHUTDOWN] Error during shutdown: ${err.message}`);
    clearTimeout(forceTimer);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[PROCESS] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[PROCESS] Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Connect to MongoDB and start Express server only after successful auth validation and DB connection
async function startServer() {
  try {
    validateAuthConfig();
    await connectDB();
    serverInstance = app.listen(PORT, () => {
      console.log(`NEXORA backend server is running on port ${PORT}`);
    });
    return serverInstance;
  } catch (error) {
    console.error(`Failed to start NEXORA server: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, gracefulShutdown };
