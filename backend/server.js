const express = require('express');
const missionsRouter = require('./routes/missions');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());

// CORS headers for local frontend integration
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
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
