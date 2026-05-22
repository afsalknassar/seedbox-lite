
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const torrentRoutes = require('./routes/torrent_routes');
const { disableSeedingForCompletedTorrents } = require('./controller/torrent_controller');
const config = require('./config');

// Server configuration
const PORT = config.server.port;
const HOST = config.server.host;

// Express app
const app = express();

// CORS configuration
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
}));

// JSON body parsing
app.use(express.json());

// Add performance monitoring middleware for API endpoints
app.use((req, res, next) => {

  const startTime = Date.now();
  let responseSent = false;

  // Skip for non-API routes
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const logResponseTime = () => {

    if (responseSent) {
      return;
    }
    responseSent = true;
    const duration = Date.now() - startTime;

    // Only log slow requests or in debug mode
    const isSlowRequest = duration > 1000;
    if (isSlowRequest) {
      const routeName = req.path;
      console.log(
        `⏱️ ${isSlowRequest ? '⚠️ SLOW API' : 'API'} ${req.method} ${routeName}: ${duration}ms` + (isSlowRequest ? ' - Consider optimization!' : '')
      );
    }
  };

  // Log when response is finished
  res.on('finish', logResponseTime);
  res.on('close', logResponseTime);

  // Set a global timeout for all API requests 
  res.setTimeout(50000, () => {

    console.log(`⏱️ ⚠️ Global timeout reached for ${req.path}`);
    if (!res.headersSent) {

      res.status(503).send({
        error: 'Request timeout',
        message: 'Server is busy, please try again later'
      });
    }

  });

  next();

});

// API routes
app.use('/api', torrentRoutes);

// Start server
app.listen(PORT, "0.0.0.0", () => {

  const serverUrl = `${config.server.protocol}://${HOST}:${PORT}`;
  console.log(`🌱 Seedbox Lite server running on ${serverUrl}`);
  console.log(`📱 Frontend URL: ${config.frontend.url}`);
  console.log(`🚀 UNIVERSAL TORRENT RESOLUTION SYSTEM ACTIVE`);

  // Disable seeding for any already completed torrents
  setTimeout(() => {

    console.log('🔄 Checking for completed torrents...');
    const completedCount = disableSeedingForCompletedTorrents();
    console.log(`✅ Completed torrents check finished`);
    if (completedCount > 0) {
      console.log(`🛑 Disabled seeding for ${completedCount} already completed torrents`);
    }

  }, 5000);

  if (config.isDevelopment) {
    console.log('🔧 Development mode - Environment variables loaded');
  }

});
