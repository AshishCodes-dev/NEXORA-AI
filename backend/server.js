const path = require('path');
const fs = require('fs');
const express = require('express');
const connectDB = require('./config/db');
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

// Middleware
app.use(express.json());

// CORS configuration restricted to development frontend origin
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || 'http://localhost:5173');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
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

// 2 & 3. Connect to MongoDB and start Express server only after successful DB connection
async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`NEXORA backend server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error(`Failed to start NEXORA server: ${error.message}`);
    process.exit(1);
  }
}

startServer();
