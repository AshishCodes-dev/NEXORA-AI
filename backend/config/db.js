const mongoose = require('mongoose');

/**
 * Connect to MongoDB using MONGODB_URI environment variable
 * @returns {Promise<mongoose.Connection>}
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI environment variable is missing. Check backend/.env');
  }

  try {
    const conn = await mongoose.connect(uri);
    console.log(`[DATABASE] MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[DATABASE] MongoDB Connection Error: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
