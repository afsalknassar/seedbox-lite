/**
 * ============================================================================
 * AUTHENTICATION CONTROLLER
 * ============================================================================
 * 
 * This module handles authentication and health check endpoints.
 * 
 * Endpoints:
 * - GET /api/health - Health check endpoint
 * - POST /api/auth/login - User authentication
 * 
 * @module auth_controller
 */

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

/**
 * Health check endpoint to verify server is running
 */
const getHealth = (req, res) => {
  console.log(`💚 Health check requested from ${req.ip}`);
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
};

// ============================================================================
// AUTHENTICATION ENDPOINT
// ============================================================================

/**
 * User authentication endpoint
 * Validates password and returns authentication result
 */
const login = (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.ACCESS_PASSWORD || 'seedbox123';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔐 AUTHENTICATION ATTEMPT`);
  console.log(`   - IP Address: ${req.ip}`);
  console.log(`   - Password Provided: ${password ? 'YES' : 'NO'}`);
  console.log(`   - Timestamp: ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!password) {
    console.log(`❌ AUTHENTICATION FAILED: No password provided`);
    return res.status(400).json({
      success: false,
      error: 'Password is required'
    });
  }

  if (password === correctPassword) {
    console.log(`✅ AUTHENTICATION SUCCESSFUL`);
    return res.json({
      success: true,
      message: 'Authentication successful'
    });
  } else {
    console.log(`❌ AUTHENTICATION FAILED: Invalid password`);
    return res.status(401).json({
      success: false,
      error: 'Invalid password'
    });
  }
};

/**
 * Get configuration endpoint
 * Returns configuration data to the client
 */
const getConfig = (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`⚙️ CONFIGURATION REQUEST`);
  console.log(`   - IP Address: ${req.ip}`);
  console.log(`   - Timestamp: ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    apiBaseUrl: process.env.API_BASE_URL
  });
};



// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  getHealth,
  login,
  getConfig
};
