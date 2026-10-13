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
let shutdownPromise = null;

/**
 * Graceful shutdown handler for HTTP server and database connections
 * @param {string} signal
 * @returns {Promise<void>}
 */
const gracefulShutdown = async (signal) => {
  if (shutdownPromise) {
    console.log(`[SHUTDOWN] Shutdown already in progress. Reusing existing shutdown promise for ${signal}.`);
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
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
      // Stage 1: Stop periodic recovery sweeper and await in-flight sweep completion
      console.log('[SHUTDOWN] [Stage 1/4] Stopping periodic recovery sweeper...');
      let recoveryDrained = true;
      try {
        const { stopPeriodicRecovery } = require('./services/missionRecoveryService');
        const sweepResult = await stopPeriodicRecovery({ timeoutMs: 5000 });
        if (sweepResult && !sweepResult.inFlightDrained) {
          recoveryDrained = false;
          console.warn('[SHUTDOWN] [Stage 1/4] Warning: In-flight recovery sweep did not drain within 5000ms.');
        } else {
          console.log('[SHUTDOWN] [Stage 1/4] Periodic recovery sweeper stopped cleanly.');
        }
      } catch (sweeperErr) {
        console.warn(`[SHUTDOWN] [Stage 1/4] Warning stopping periodic recovery: ${sweeperErr.message}`);
      }

      // Stage 2: Pause task claims and drain active workers
      console.log('[SHUTDOWN] [Stage 2/4] Pausing task claims and draining active workers...');
      try {
        const { drainActiveWorkers } = require('./orchestrator/taskExecutor');
        const drainResult = await drainActiveWorkers({ timeoutMs: 5000 });
        console.log(`[SHUTDOWN] [Stage 2/4] Active workers drained (drained: ${drainResult.drained}, active: ${drainResult.activeCount}, surrendered: ${drainResult.surrenderedCount}).`);
      } catch (workerErr) {
        console.warn(`[SHUTDOWN] [Stage 2/4] Warning draining active workers: ${workerErr.message}`);
      }

      // Stage 3: Close HTTP server
      console.log('[SHUTDOWN] [Stage 3/4] Closing HTTP server...');
      if (serverInstance) {
        await new Promise((resolve) => serverInstance.close(resolve));
        console.log('[SHUTDOWN] [Stage 3/4] HTTP server closed.');
      } else {
        console.log('[SHUTDOWN] [Stage 3/4] HTTP server was not active.');
      }

      // Stage 4: Close MongoDB connection safely
      console.log('[SHUTDOWN] [Stage 4/4] Closing database connections...');
      if (!recoveryDrained) {
        console.error('[SHUTDOWN] [Stage 4/4] In-flight recovery operation is still active; refusing to close database connection to prevent racing queries.');
        if (process.env.NODE_ENV !== 'test') {
          process.exit(1);
        }
        return;
      }

      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.connection.close(false);
        console.log('[DATABASE] MongoDB connection closed.');
      } else {
        console.log('[DATABASE] MongoDB was not connected.');
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
  })();

  return shutdownPromise;
};

function _resetShutdownForTesting() {
  isShuttingDown = false;
  shutdownPromise = null;
  serverInstance = null;
}

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

    // NEXORA Phase 2.3: Startup Crash Recovery & Stale Worker Reconciliation
    try {
      const { runStartupRecovery } = require('./services/missionRecoveryService');
      await runStartupRecovery({ timeoutMs: 5000 });
    } catch (recErr) {
      console.warn('[STARTUP RECOVERY] Non-fatal recovery warning during startup:', recErr.message);
    }

    serverInstance = app.listen(PORT, () => {
      console.log(`NEXORA backend server is running on port ${PORT}`);
    });

    // NEXORA Phase 2.5: Continuous Periodic Recovery Sweeper
    try {
      const { startPeriodicRecovery } = require('./services/missionRecoveryService');
      startPeriodicRecovery();
      console.log('[PERIODIC RECOVERY] Background recovery sweeper started.');
    } catch (sweepErr) {
      console.warn('[PERIODIC RECOVERY] Failed to start periodic recovery sweeper:', sweepErr.message);
    }

    return serverInstance;
  } catch (error) {
    console.error(`Failed to start NEXORA server: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, gracefulShutdown, _resetShutdownForTesting };
