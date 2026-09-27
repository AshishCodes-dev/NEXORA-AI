const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'NEXORA backend is running'
  });
});

app.listen(PORT, () => {
  console.log(`NEXORA backend server is running on port ${PORT}`);
});
