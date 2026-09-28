const express = require('express');
const missionsRouter = require('./routes/missions');

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

app.listen(PORT, () => {
  console.log(`NEXORA backend server is running on port ${PORT}`);
});
