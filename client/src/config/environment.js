/**
 * Environment Configuration
 * Provides centralized access to environment variables
 */

// Get API base URL from environment variables
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';



// Remove trailing slash if present
const normalizeUrl = (url) => url.endsWith('/') ? url.slice(0, -1) : url;

export const config = {
  // API Configuration
  apiBaseUrl: normalizeUrl(API_BASE_URL),
  apikeyTorrentclaw: import.meta.env.VITE_APIKEY_TORRENTCLAW,
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID 
  
  // API Endpoints
  api: {
    torrents: `${normalizeUrl(API_BASE_URL)}/api/torrents`,
    cache: `${normalizeUrl(API_BASE_URL)}/api/cache`,
    system: `${normalizeUrl(API_BASE_URL)}/api/system`,
  },
  
  // Development helpers
  isDevelopment: import.meta.env.DEV,
  isProduction: import.meta.env.PROD,
  
  // Helper functions
  getApiUrl: (endpoint) => `${normalizeUrl(API_BASE_URL)}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`,
  
  // Torrent API helpers
  getTorrentUrl: (infoHash, endpoint = '') => 
    `${normalizeUrl(API_BASE_URL)}/api/torrents/${infoHash}${endpoint ? `/${endpoint}` : ''}`,
    
  getStreamUrl: (infoHash, fileIndex) => 
    `${normalizeUrl(API_BASE_URL)}/api/torrents/${infoHash}/files/${fileIndex}/stream`,
    
  getDownloadUrl: (infoHash, fileIndex) => 
    `${normalizeUrl(API_BASE_URL)}/api/torrents/${infoHash}/files/${fileIndex}/download`,
};

// Log configuration in development
if (config.isDevelopment) {
  console.log('🔧 Environment Configuration:', {
    apiBaseUrl: config.apiBaseUrl,
    environment: config.isDevelopment ? 'development' : 'production'
  });
}
