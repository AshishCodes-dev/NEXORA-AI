const mongoose = require('mongoose');

/**
 * Connect to MongoDB using MONGODB_URI environment variable
 * Hardened with connection timeout and runtime listeners.
 * @returns {Promise<mongoose.Connection>}
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI environment variable is missing. Check backend/.env');
  }

  // Register runtime connection health listeners once
  if (mongoose.connection.listenerCount('error') === 0) {
    mongoose.connection.on('error', (err) => {
      console.error(`[DATABASE] Runtime MongoDB error: ${err.message}`);
    });
  }

  if (mongoose.connection.listenerCount('disconnected') === 0) {
    mongoose.connection.on('disconnected', () => {
      console.warn('[DATABASE] MongoDB disconnected');
    });
  }

  if (mongoose.connection.listenerCount('reconnected') === 0) {
    mongoose.connection.on('reconnected', () => {
      console.log('[DATABASE] MongoDB reconnected');
    });
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });
    console.log(`[DATABASE] MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[DATABASE] MongoDB Connection Error: ${error.message}`);
    throw error;
  }
};

/**
 * Gracefully close the MongoDB connection
 * @param {boolean} [force=false]
 */
const closeDB = async (force = false) => {
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(force);
    console.log('[DATABASE] MongoDB connection closed');
  }
};

connectDB.closeDB = closeDB;

module.exports = connectDB;
