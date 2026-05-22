/**
 * ============================================================================
 * TORRENT CLIENT MODULE
 * ============================================================================
 * 
 * This module initializes and manages the WebTorrent client along with all
 * shared state objects used across the application.
 * 
 * Responsibilities:
 * - Initialize WebTorrent client with optimized settings
 * - Manage torrent storage and lookup systems
 * - Handle caching for performance optimization
 * - Provide environment-specific configurations
 * 
 * @module torrent_client
 */

const WebTorrent = require('webtorrent');
const config = require('./config/config');

// ============================================================================
// ENVIRONMENT DETECTION
// ============================================================================

const isProduction = process.env.NODE_ENV === 'production';
const isCloud = process.env.CLOUD_DEPLOYMENT === 'true';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🌐 SEEDBOX LITE - TORRENT CLIENT INITIALIZATION`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
console.log(`☁️ Cloud Deployment: ${isCloud ? 'YES' : 'NO'}`);
console.log(`🔧 Debug Mode: ${process.env.DEBUG === 'true' ? 'ENABLED' : 'DISABLED'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ============================================================================
// WEBTORRENT CLIENT CONFIGURATION
// ============================================================================

/**
 * WebTorrent client with optimized settings for different environments
 * 
 * Production/Cloud optimizations:
 * - Limited connections to prevent socket exhaustion
 * - Bandwidth caps to avoid DDoS filters
 * - Disabled UDP/DHT in cloud (blocked by most providers)
 */
const client = new WebTorrent({
  // Bandwidth Limits
  uploadLimit: isProduction ? config.production.network.defaultUploadLimit : 10000,
  // CRITICAL: Cap downloads in the cloud (e.g., 10MB/s) to avoid triggering DDoS filters
  downloadLimit: isCloud ? (10 * 1024 * 1024) : -1,

  // Connections: Severely restrict in cloud to prevent socket exhaustion (ulimit crashes)
  maxConns: isCloud ? 30 : (isProduction ? config.production.network.maxConns : 150),
  webSeeds: true,

  // Protocol settings
  tracker: true,
  pex: true,

  // 🚨 THE CLOUD UDP TRAP 🚨
  // Cloud providers aggressively block UDP traffic. If enabled, Node.js will choke
  // the event loop trying to resolve unreachable DHT nodes and uTP peers.
  dht: !isCloud, // FALSE in cloud, TRUE locally
  utp: !isCloud  // FALSE in cloud, TRUE locally
});

console.log(`✅ WebTorrent client initialized`);
console.log(`   - Max Connections: ${isCloud ? 30 : (isProduction ? config.production.network.maxConns : 150)}`);
console.log(`   - Upload Limit: ${isProduction ? config.production.network.defaultUploadLimit : 10000} KB/s`);
console.log(`   - Download Limit: ${isCloud ? '10 MB/s (capped)' : 'Unlimited'}`);
console.log(`   - DHT: ${isCloud ? 'DISABLED (cloud)' : 'ENABLED (local)'}`);
console.log(`   - uTP: ${isCloud ? 'DISABLED (cloud)' : 'ENABLED (local)'}`);

// ============================================================================
// UNIVERSAL STORAGE SYSTEM
// ============================================================================
// Multiple lookup mechanisms to find torrents by any identifier:
// - infoHash (primary key)
// - Original torrent ID (magnet URI, hash, etc.)
// - Torrent name
// - Reverse lookups (name -> hash, hash -> name)

const torrents = {};           // Active torrent objects by infoHash
const torrentIds = {};         // Original torrent IDs by infoHash
const torrentNames = {};       // Torrent names by infoHash
const hashToName = {};         // Quick hash-to-name lookup
const nameToHash = {};         // Quick name-to-hash lookup

console.log(`📦 Storage systems initialized`);

// ============================================================================
// CACHING SYSTEMS
// ============================================================================
// Multiple caches to optimize performance and reduce external API calls

const imdbCache = new Map();           // Cache for IMDB/TMDB metadata
const detailsCache = new Map();        // Cache for torrent details
const statsCache = new Map();          // Cache for torrent statistics
const serverStatsCache = new Map();    // Cache for server-wide statistics

console.log(`💾 Caching systems initialized`);
console.log(`   - IMDB Cache: Map`);
console.log(`   - Details Cache: Map (3s TTL)`);
console.log(`   - Stats Cache: Map (2s TTL)`);
console.log(`   - Server Stats Cache: Map`);

// ============================================================================
// CACHE CLEANUP INTERVALS
// ============================================================================
// Periodic cleanup to prevent memory leaks from stale cache entries

// Clean details cache every 1 minute (3-second TTL)
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [key, value] of detailsCache.entries()) {
    if (now - value.timestamp > 3000) { // 3-second TTL
      detailsCache.delete(key);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0 && process.env.DEBUG === 'true') {
    console.log(`🧹 Details cache cleanup: Removed ${cleanedCount} stale entries`);
  }
}, 60000);

// Clean stats cache every 10 seconds (2-second TTL)
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [key, value] of statsCache.entries()) {
    if (now - value.timestamp > 2000) { // 2-second TTL
      statsCache.delete(key);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0 && process.env.DEBUG === 'true') {
    console.log(`🧹 Stats cache cleanup: Removed ${cleanedCount} stale entries`);
  }
}, 10000);

console.log(`⏰ Cache cleanup intervals started`);
console.log(`   - Details Cache: Every 60s (3s TTL)`);
console.log(`   - Stats Cache: Every 10s (2s TTL)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  client,
  torrents,
  torrentIds,
  torrentNames,
  hashToName,
  nameToHash,
  imdbCache,
  detailsCache,
  statsCache,
  serverStatsCache,
  isProduction,
  isCloud
};
