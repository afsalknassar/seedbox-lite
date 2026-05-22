/**
 * ============================================================================
 * SEEDBOX LITE - MAIN SERVER ENTRY POINT
 * ============================================================================
 * 
 * This is the main entry point for the Seedbox Lite server.
 * It initializes the Express application, applies middleware,
 * and starts the HTTP server.
 * 
 * Features:
 * - CORS enabled for cross-origin requests
 * - JSON body parsing
 * - Performance monitoring middleware
 * - Global request timeout protection
 * - Automatic seeding disable for completed torrents
 * 
 * @module index
 */

const express = require('express');
const cors = require('cors');

const torrentRoutes = require('./routes/torrent_routes');
const { disableSeedingForCompletedTorrents } = require('./utils/torrent_utils');
const config = require('./config/config');

// ============================================================================
// SERVER CONFIGURATION
// ============================================================================

const PORT = config.server.port;
const HOST = config.server.host;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🚀 [SERVER] Starting Seedbox Lite Server`);
console.log(`   - Port: ${PORT}`);
console.log(`   - Host: ${HOST}`);
console.log(`   - Environment: ${config.isDevelopment ? 'Development' : 'Production'}`);
console.log(`   - Debug Mode: ${process.env.DEBUG === 'true' ? 'Enabled' : 'Disabled'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ============================================================================
// EXPRESS APP INITIALIZATION
// ============================================================================

const app = express();

// ============================================================================
// MIDDLEWARE CONFIGURATION
// ============================================================================

/**
 * CORS Configuration
 * Enables Cross-Origin Resource Sharing for all origins
 */
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
}));

console.log(`🔓 [SERVER] CORS enabled for all origins`);

/**
 * JSON Body Parser
 * Parses incoming request bodies with JSON payloads
 */
app.use(express.json());

console.log(`📦 [SERVER] JSON body parser enabled`);

// ============================================================================
// PERFORMANCE MONITORING MIDDLEWARE
// ============================================================================

/**
 * Performance monitoring middleware for API endpoints
 * Logs slow requests and sets global timeout
 */
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
    if (isSlowRequest || process.env.DEBUG === 'true') {
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
    console.log(`⏱️ ⚠️ [SERVER] Global timeout reached for ${req.path}`);
    if (!res.headersSent) {
      res.status(503).send({
        error: 'Request timeout',
        message: 'Server is busy, please try again later'
      });
    }
  });

  next();
});

console.log(`⏱️ [SERVER] Performance monitoring enabled (50s global timeout)`);

// ============================================================================
// ROUTE MOUNTING
// ============================================================================

/**
 * Mount API routes
 * All API endpoints are prefixed with /api
 */
app.use('/api', torrentRoutes);

console.log(`📡 [SERVER] API routes mounted at /api`);

// ============================================================================
// SERVER STARTUP
// ============================================================================

/**
 * Start the HTTP server
 */
app.listen(PORT, "0.0.0.0", () => {
  const serverUrl = `${config.server.protocol}://${HOST}:${PORT}`;
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ [SERVER] Seedbox Lite server running`);
  console.log(`   - Server URL: ${serverUrl}`);
  console.log(`   - Frontend URL: ${config.frontend.url}`);
  console.log(`   - Universal Torrent Resolution: ACTIVE`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Disable seeding for any already completed torrents
  setTimeout(() => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔄 [SERVER] Checking for completed torrents...`);
    
    const completedCount = disableSeedingForCompletedTorrents();
    
    console.log(`✅ [SERVER] Completed torrents check finished`);
    if (completedCount > 0) {
      console.log(`🛑 [SERVER] Disabled seeding for ${completedCount} already completed torrents`);
    } else {
      console.log(`ℹ️ [SERVER] No completed torrents found`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }, 5000);

  if (config.isDevelopment) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔧 [SERVER] Development mode active`);
    console.log(`   - Environment variables loaded`);
    console.log(`   - Debug logging: ${process.env.DEBUG === 'true' ? 'ENABLED' : 'DISABLED'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }
});
