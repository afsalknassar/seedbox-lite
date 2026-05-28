/**
 * ============================================================================
 * SYSTEM CONTROLLER
 * ============================================================================
 * 
 * This module handles system monitoring and health operations:
 * - Cache statistics and usage tracking
 * - Disk usage monitoring with timeout protection
 * - System health monitoring (memory, uptime, etc.)
 * - Automatic cleanup of stalled/dead torrents
 * - Emergency memory cleanup
 * 
 * Features:
 * - Periodic health checks every 10 minutes
 * - Automatic garbage collection trigger on high memory
 * - Dead torrent sweeper runs every 5 minutes
 * - Timeout protection for system commands
 * 
 * @module system_controller
 */

const { exec } = require('child_process');
const { client, serverStatsCache, torrents, torrentIds, torrentNames, hashToName, nameToHash } = require('../torrent_client');
const { detailsCache, statsCache } = require('../torrent_client');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format bytes to human-readable string
 */
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i < 0 || i >= sizes.length) return '0 B';
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// ============================================================================
// CACHE STATS ENDPOINT
// ============================================================================

/**
 * Get cache statistics with caching
 */
const getCacheStats = (req, res) => {
  const debugLevel = process.env.DEBUG === 'true';

  if (debugLevel) {
    console.log(`📊 [CACHE STATS] Request received`);
  }

  try {
    // 1. Safe Cache Check (2-second TTL to prevent CPU spam)
    const cached = serverStatsCache.get('cacheStats');
    if (cached && (Date.now() - cached.timestamp < 2000)) {
      if (debugLevel) {
        console.log(`💾 [CACHE STATS] Returning cached data`);
      }
      return res.json(cached.data);
    }

    const activeTorrents = client.torrents.length;
    let cacheSize = 0;
    let downloadedBytes = 0;

    // Iterate once
    for (const torrent of client.torrents) {
      cacheSize += torrent.length || 0;
      downloadedBytes += torrent.downloaded || 0;
    }

    const cacheLimitBytes = 5 * 1024 * 1024 * 1024; // 5GB
    const usagePercentage = cacheLimitBytes > 0 ? (cacheSize / cacheLimitBytes) * 100 : 0;

    const stats = {
      totalSizeFormatted: formatBytes(cacheSize),
      totalSize: cacheSize,
      activeTorrents,
      cacheSize: cacheSize,
      downloadedBytes: formatBytes(downloadedBytes),
      totalTorrentSize: cacheSize,
      totalTorrentSizeFormatted: formatBytes(cacheSize),
      cacheLimitFormatted: formatBytes(cacheLimitBytes),
      usagePercentage: Math.round(usagePercentage * 100) / 100
    };

    if (debugLevel) {
      console.log(`📊 [CACHE STATS] Active torrents: ${activeTorrents}, Cache: ${stats.totalSizeFormatted}`);
    }

    // Save to cache
    serverStatsCache.set('cacheStats', { data: stats, timestamp: Date.now() });

    res.json(stats);
  } catch (error) {
    console.error('❌ [CACHE STATS] Failed:', error.message);
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
};

// ============================================================================
// DISK USAGE ENDPOINT
// ============================================================================

/**
 * Get disk usage with timeout protection
 */
const getDiskUsage = (req, res) => {
  const debugLevel = process.env.DEBUG === 'true';

  if (debugLevel) {
    console.log(`💾 [DISK USAGE] Request received`);
  }

  try {
    // 1. Safe Cache Check (5-second TTL - disk space doesn't change instantly)
    const cached = serverStatsCache.get('diskStats');
    if (cached && (Date.now() - cached.timestamp < 5000)) {
      if (debugLevel) {
        console.log(`💾 [DISK USAGE] Returning cached data`);
      }
      return res.json(cached.data);
    }

    // 2. CRITICAL: Add a timeout to `exec` so it never hangs the server
    exec('df -k .', { timeout: 2000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('⚠️ [DISK USAGE] Check failed or timed out:', error.message);

        // Return fallback data instead of returning a 500 so the UI doesn't break
        const fallbackStats = { total: 0, used: 0, available: 0, percentage: 0 };
        return res.json(fallbackStats);
      }

      try {
        const lines = stdout.trim().split('\n');
        // Ensure the output format is actually what we expect before splitting
        if (lines.length < 2) throw new Error('Unexpected df output format');

        const data = lines[1].split(/\s+/);
        const total = parseInt(data[1], 10) * 1024;
        const used = parseInt(data[2], 10) * 1024;
        const available = parseInt(data[3], 10) * 1024;
        const percentage = Math.round((used / total) * 100) || 0;

        const diskInfo = { total, used, available, percentage };

        if (debugLevel) {
          console.log(`💾 [DISK USAGE] Total: ${formatBytes(total)}, Used: ${formatBytes(used)} (${percentage}%)`);
        }

        // Save to cache
        serverStatsCache.set('diskStats', { data: diskInfo, timestamp: Date.now() });

        res.json(diskInfo);
      } catch (parseError) {
        console.error('❌ [DISK USAGE] Parse error:', parseError.message);
        res.status(500).json({ error: 'Failed to parse disk stats' });
      }
    });
  } catch (error) {
    console.error('❌ [DISK USAGE] Failed:', error.message);
    res.status(500).json({ error: 'Failed to get disk stats' });
  }
};

// ============================================================================
// SYSTEM HEALTH MONITORING
// ============================================================================

/**
 * System health tracking object
 */
const systemHealth = {
  startTime: Date.now(),
  lastCheck: Date.now(),
  memoryWarnings: 0,
  highMemoryDetected: false,
  apiTimeouts: 0,
  streamErrors: 0,
  totalRequests: 0,
  stalledTorrentsRestarted: 0
};

/**
 * Set up periodic system health monitoring
 * Runs every 10 minutes to check memory, cleanup stalled torrents, etc.
 */
function setupSystemMonitoring() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🩺 [SYSTEM MONITOR] Setting up health monitoring`);
  console.log(`   - Check interval: 10 minutes`);
  console.log(`   - High memory threshold: 1GB`);
  console.log(`   - Stalled torrent threshold: 12 hours, <10% progress`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Check system health every 10 minutes (600,000 ms)
  setInterval(() => {
    try {
      const now = Date.now();
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const rssMemoryMB = Math.round(memoryUsage.rss / 1024 / 1024);

      systemHealth.lastCheck = now;

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🩺 [SYSTEM MONITOR] Health Check`);
      console.log(`   - Uptime: ${Math.round((now - systemHealth.startTime) / 60000)} minutes`);
      console.log(`   - Memory: ${heapUsedMB}MB heap / ${rssMemoryMB}MB RSS`);
      console.log(`   - Active Torrents: ${client.torrents.length}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // 1. MEMORY PROTECTION LOGIC
      const HIGH_MEMORY_THRESHOLD = 1024; // 1GB

      if (rssMemoryMB > HIGH_MEMORY_THRESHOLD) {
        console.log(`⚠️ [SYSTEM MONITOR] HIGH MEMORY DETECTED: ${rssMemoryMB}MB`);
        systemHealth.memoryWarnings++;
        systemHealth.highMemoryDetected = true;

        // Emergency Cleanup (Triggered after ~30 mins of sustained high memory)
        if (systemHealth.memoryWarnings >= 3) {
          console.log('🚨 [SYSTEM MONITOR] CRITICAL MEMORY - Triggering Emergency Cleanup');

          // Clear our dedicated Map caches completely
          if (typeof detailsCache !== 'undefined') {
            detailsCache.clear();
            console.log(`🗑️ [SYSTEM MONITOR] Cleared detailsCache`);
          }
          if (typeof statsCache !== 'undefined') {
            statsCache.clear();
            console.log(`🗑️ [SYSTEM MONITOR] Cleared statsCache`);
          }
          if (typeof serverStatsCache !== 'undefined') {
            serverStatsCache.clear();
            console.log(`🗑️ [SYSTEM MONITOR] Cleared serverStatsCache`);
          }

          // Force V8 Garbage Collection if the Node process was started with --expose-gc
          if (global.gc) {
            try {
              global.gc();
              console.log('♻️ [SYSTEM MONITOR] V8 Garbage Collection forced successfully');
            } catch (e) {
              console.log('⚠️ [SYSTEM MONITOR] V8 GC failed:', e.message);
            }
          } else {
            console.log('ℹ️ [SYSTEM MONITOR] Manual GC not available (requires node --expose-gc flag)');
          }

          // Reset warnings to give the system time to breathe
          systemHealth.memoryWarnings = 0;
        }
      } else {
        systemHealth.highMemoryDetected = false;
        if (systemHealth.memoryWarnings > 0) systemHealth.memoryWarnings--;
      }

      // 2. STALLED TORRENT MANAGEMENT
      if (client.torrents.length > 0) {
        let stalledCount = 0;

        client.torrents.forEach(torrent => {
          // Skip if completed or already destroyed
          if (torrent.progress >= 1 || torrent.destroyed) return;

          // Safely determine how long it has been running
          const addedTime = torrent.addedAt ? new Date(torrent.addedAt).getTime() : now;
          const runningHours = (now - addedTime) / (1000 * 60 * 60);

          // Stalled criteria: Running > 12 hours AND progress < 10%
          if (runningHours > 12 && torrent.progress < 0.1) {
            stalledCount++;
            const identifier = torrent.infoHash;

            console.log(`⚠️ [SYSTEM MONITOR] Stalled torrent: ${torrent.name || identifier}`);
            console.log(`   - Running: ${Math.round(runningHours)}h | Progress: ${(torrent.progress * 100).toFixed(1)}%`);

            try {
              // Clean our manual tracking maps
              if (typeof torrents !== 'undefined') delete torrents[identifier];
              if (typeof torrentIds !== 'undefined') delete torrentIds[identifier];
              if (typeof torrentNames !== 'undefined') delete torrentNames[identifier];
              if (typeof hashToName !== 'undefined') delete hashToName[identifier];
              if (torrent.name && typeof nameToHash !== 'undefined') delete nameToHash[torrent.name];

              systemHealth.stalledTorrentsRestarted++;
            } catch (e) {
              console.error(`❌ [SYSTEM MONITOR] Failed to cleanup stalled torrent:`, e.message);
            }
          }
        });

        if (stalledCount > 0) {
          console.log(`🧹 [SYSTEM MONITOR] Cleaned up ${stalledCount} dead/stalled torrents`);
        }
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    } catch (e) {
      console.error('❌ [SYSTEM MONITOR] Error in monitoring loop:', e.message);
    }
  }, 600000); // Check exactly every 10 minutes (600,000 ms)
}

// Initialize the monitor
setupSystemMonitoring();

// ============================================================================
// SYSTEM HEALTH ENDPOINT
// ============================================================================

/**
 * Get system health information
 */
const getSystemHealth = (req, res) => {
  const debugLevel = process.env.DEBUG === 'true';

  if (debugLevel) {
    console.log(`🩺 [SYSTEM HEALTH] Request received`);
  }

  try {
    const memoryUsage = process.memoryUsage();
    const healthData = {
      ...systemHealth,
      uptimeMinutes: Math.round((Date.now() - systemHealth.startTime) / 60000),
      currentMemoryMB: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024)
      },
      activeTorrents: client.torrents.length,
      caches: {
        details: typeof detailsCache !== 'undefined' ? detailsCache.size : 0,
        stats: typeof statsCache !== 'undefined' ? statsCache.size : 0,
      }
    };

    if (debugLevel) {
      console.log(`🩺 [SYSTEM HEALTH] Returning health data`);
    }

    res.json(healthData);
  } catch (error) {
    console.error('❌ [SYSTEM HEALTH] Failed:', error.message);
    res.status(500).json({ error: 'Failed to retrieve system health' });
  }
};

// ============================================================================
// DEAD TORRENT SWEEPER
// ============================================================================

/**
 * Auto-cleanup dead torrents (no peers, no speed after grace period)
 * Runs every 5 minutes
 */
setInterval(() => {
  const debugLevel = process.env.DEBUG === 'true';

  if (debugLevel) {
    console.log('🧹 [DEAD SWEEPER] Running Dead Torrent Sweeper...');
  }

  const now = Date.now();
  let cleanedCount = 0;

  client.torrents.forEach(torrent => {
    // 1. Skip torrents that are already 100% complete. They are safe in the cache!
    if (torrent.progress === 1) return;

    // 2. Skip torrents we intentionally paused via our "Deep Freeze" queue
    if (torrent.paused) return;

    // 3. Give new torrents a 10-minute "Grace Period" to find seeders
    if (!torrent.addedAt) return; // Safety check
    const timeAliveMs = now - new Date(torrent.addedAt).getTime();
    const minutesAlive = timeAliveMs / (1000 * 60);

    if (minutesAlive < 10) return;

    // 4. THE DEATH CRITERIA: 0 Speed and 0 Peers after the grace period
    if (torrent.downloadSpeed === 0 && torrent.numPeers === 0) {
      console.log(`💀 [DEAD SWEEPER] Auto-deleting: ${torrent.name || torrent.infoHash} (No peers for 10+ mins)`);
      cleanedCount++;

      const hash = torrent.infoHash;

      // Clean up the server's tracking dictionaries so it disappears from the system
      if (torrents[hash]) delete torrents[hash];
      if (torrentIds[hash]) delete torrentIds[hash];
      if (torrentNames[hash]) {
        // Also remove from nameToHash reverse lookup
        const name = torrentNames[hash];
        if (nameToHash[name]) delete nameToHash[name];
        delete torrentNames[hash];
      }
      if (hashToName[hash]) delete hashToName[hash];
    }
  });

  if (debugLevel && cleanedCount > 0) {
    console.log(`🧹 [DEAD SWEEPER] Cleaned ${cleanedCount} dead torrents`);
  }
}, 5 * 60 * 1000); // every 5 minutes

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  getCacheStats,
  getDiskUsage,
  getSystemHealth
};
