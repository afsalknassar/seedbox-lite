/**
 * ============================================================================
 * TORRENT CONTROLLER
 * ============================================================================
 * 
 * This module handles core torrent management operations:
 * - Adding torrents via magnet URI or hash
 * - Uploading .torrent files
 * - Listing all torrents
 * - Getting torrent details
 * - Removing individual torrents
 * - Clearing all torrents
 * 
 * @module torrent_controller
 */

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const fsPromises = require('fs').promises;
const parseTorrent = require('parse-torrent');
const { client, torrents, torrentIds, torrentNames, hashToName, nameToHash, imdbCache, detailsCache, isCloud } = require('../torrent_client');
const { universalTorrentResolver, loadTorrentFromId } = require('../utils/torrent_utils');

// ============================================================================
// FILE UPLOAD CONFIGURATION
// ============================================================================

const uploadsDir = 'uploads/';

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 [TORRENT CONTROLLER] Created uploads directory');
}

const upload = multer({
  dest: uploadsDir,
  fileFilter: (req, file, cb) => {
    cb(null, file.originalname.endsWith('.torrent'));
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for torrent files
  }
});

console.log(`📁 [TORRENT CONTROLLER] File upload configured (max: 5MB)`);

// ============================================================================
// ADD TORRENT ENDPOINT
// ============================================================================

/**
 * Add torrent via magnet URI or infoHash
 */
const addTorrent = async (req, res) => {
  const { torrentId, tmdbData } = req.body;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`➕ [TORRENT ADD] Request received`);
  console.log(`   - Torrent ID: ${torrentId ? torrentId.substring(0, 50) + '...' : 'MISSING'}`);
  console.log(`   - IP: ${req.ip}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!torrentId) {
    console.log(`❌ [TORRENT ADD] Failed: No torrentId provided`);
    return res.status(400).json({ error: 'No torrentId provided' });
  }

  try {
    // 1. Try Resolver - Check if torrent already exists
    console.log(`🔍 [TORRENT ADD] Checking if torrent already exists...`);
    const existingTorrent = universalTorrentResolver(torrentId);
    if (existingTorrent) {
      console.log(`✅ [TORRENT ADD] Found existing torrent: ${existingTorrent.name}`);
      
      if (tmdbData && existingTorrent.name) {
        imdbCache.set(existingTorrent.name, tmdbData);
        console.log(`💾 [TORRENT ADD] Cached frontend-provided TMDB data for ${existingTorrent.name}`);
      }
      
      return res.json({
        success: true,
        infoHash: existingTorrent.infoHash,
        name: existingTorrent.name || 'Loading...',
        size: existingTorrent.length || 0,
        status: 'found'
      });
    }

    // 2. Load New (handles its own duplicate logic internally)
    console.log(`🔄 [TORRENT ADD] Loading new torrent...`);
    const newTorrent = await loadTorrentFromId(torrentId);
    console.log(`✅ [TORRENT ADD] Torrent loaded successfully: ${newTorrent.name}`);

    if (tmdbData && newTorrent.name) {
      imdbCache.set(newTorrent.name, tmdbData);
      console.log(`💾 [TORRENT ADD] Cached frontend-provided TMDB data for ${newTorrent.name}`);
    }

    return res.json({
      success: true,
      infoHash: newTorrent.infoHash,
      name: newTorrent.name || 'Loading...',
      size: newTorrent.length || 0,
      status: 'loaded'
    });

  } catch (error) {
    console.error(`❌ [TORRENT ADD] Failed: ${error.message}`);
    res.status(500).json({ error: 'Failed to add torrent: ' + error.message });
  }
};

// ============================================================================
// FILE UPLOAD ENDPOINT
// ============================================================================

/**
 * Handle .torrent file uploads
 */
const uploadTorrentHandler = async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📁 [FILE UPLOAD] Request received`);
  console.log(`   - IP: ${req.ip}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!req.file) {
    console.log(`❌ [FILE UPLOAD] Failed: No torrent file provided`);
    return res.status(400).json({ error: 'No torrent file provided' });
  }

  const torrentPath = req.file.path;

  try {
    console.log(`📁 [FILE UPLOAD] Processing uploaded file: ${req.file.originalname}`);
    console.log(`   - Size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

    // ASYNC read - does not block the server
    const torrentBuffer = await fsPromises.readFile(torrentPath);
    console.log(`✅ [FILE UPLOAD] File read successfully`);

    const torrent = await new Promise((resolve, reject) => {
      let loadedTorrent;
      let resolved = false;
      let timeoutId;

      try {
        const torrentOptions = {
          announce: [
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://open.demonii.com:1337/announce',
            'udp://tracker.openbittorrent.com:6969/announce',
            'udp://exodus.desync.com:6969/announce'
          ],
          private: false,
          strategy: 'rarest',
          maxWebConns: 20
        };

        loadedTorrent = client.add(torrentBuffer, torrentOptions);
        console.log(`➕ [FILE UPLOAD] Added to WebTorrent client`);
      } catch (addError) {
        if (addError.message && addError.message.includes('duplicate')) {
          console.log(`🔍 [FILE UPLOAD] Duplicate detected, finding existing torrent`);
          try {
            const parsed = parseTorrent(torrentBuffer);
            const existingTorrent = client.torrents.find(t =>
              t.infoHash.toLowerCase() === parsed.infoHash.toLowerCase()
            );
            if (existingTorrent) {
              console.log(`✅ [FILE UPLOAD] Found existing duplicate: ${existingTorrent.name}`);
              return resolve(existingTorrent);
            }
          } catch (parseError) {
            console.error(`❌ [FILE UPLOAD] Error parsing for duplicate check:`, parseError.message);
          }
        }
        return reject(addError);
      }

      // Stop seeding when download is complete
      loadedTorrent.on('done', () => {
        console.log(`✅ [FILE UPLOAD] Download complete: ${loadedTorrent.name} - Stopping seeding`);
        loadedTorrent.uploadLimit = 0;
      });

      // TIMEOUT HANDLING
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log(`⏰ [FILE UPLOAD] Timeout loading torrent file: ${req.file.originalname}`);

          // CRITICAL: Kill the zombie torrent!
          if (loadedTorrent) {
            loadedTorrent.destroy((err) => {
              if (err) console.error(`❌ [FILE UPLOAD] Error destroying timed-out torrent:`, err);
            });
          }
          reject(new Error('Timeout loading torrent file metadata'));
        }
      }, 30000);

      // READY HANDLING
      loadedTorrent.on('ready', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId); // Prevent timeout from firing

        console.log(`✅ [FILE UPLOAD] Torrent uploaded and loaded: ${loadedTorrent.name}`);
        console.log(`   - Size: ${(loadedTorrent.length / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   - Files: ${loadedTorrent.files.length}`);

        // Track in global maps
        torrents[loadedTorrent.infoHash] = loadedTorrent;
        torrentIds[loadedTorrent.infoHash] = req.file.originalname;
        torrentNames[loadedTorrent.infoHash] = loadedTorrent.name;
        hashToName[loadedTorrent.infoHash] = loadedTorrent.name;
        if (loadedTorrent.name) nameToHash[loadedTorrent.name] = loadedTorrent.infoHash;

        loadedTorrent.addedAt = new Date().toISOString();
        loadedTorrent.uploadLimit = 2048;

        resolve(loadedTorrent);
      });

      // ERROR HANDLING
      loadedTorrent.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId); // Prevent timeout from firing

        console.error(`❌ [FILE UPLOAD] Error loading uploaded torrent:`, err.message);

        if (err.message && err.message.includes('duplicate')) {
          try {
            const parsed = parseTorrent(torrentBuffer);
            const existingTorrent = client.torrents.find(t =>
              t.infoHash.toLowerCase() === parsed.infoHash.toLowerCase()
            );
            if (existingTorrent) {
              console.log(`✅ [FILE UPLOAD] Found existing duplicate in error handler: ${existingTorrent.name}`);
              return resolve(existingTorrent);
            }
          } catch (parseError) {
            console.error(`❌ [FILE UPLOAD] Error parsing in error handler:`, parseError.message);
          }
        }

        // Clean up the failed torrent from the client
        loadedTorrent.destroy();
        reject(err);
      });
    });

    // Clean up uploaded file asynchronously
    await fsPromises.unlink(torrentPath);
    console.log(`🗑️ [FILE UPLOAD] Cleaned up uploaded file`);

    res.json({
      success: true,
      infoHash: torrent.infoHash,
      name: torrent.name,
      size: torrent.length,
      status: 'uploaded',
      files: torrent.files ? torrent.files.length : 0
    });

    console.log(`✅ [FILE UPLOAD] Upload completed successfully`);

  } catch (error) {
    console.error(`❌ [FILE UPLOAD] Failed: ${error.message}`);

    // Clean up file on error asynchronously
    try {
      await fsPromises.unlink(torrentPath).catch(() => { });
    } catch (cleanupError) {
      console.error(`❌ [FILE UPLOAD] Failed to cleanup file:`, cleanupError.message);
    }

    res.status(500).json({ error: 'Failed to upload torrent: ' + error.message });
  }
};

// Wrapper for multer middleware
const uploadTorrent = [upload.single('torrentFile'), uploadTorrentHandler];

// ============================================================================
// GET ALL TORRENTS ENDPOINT
// ============================================================================

/**
 * Get list of all active torrents with caching
 */
const getTorrents = (req, res) => {
  // Add a timeout to abort long-running requests
  res.setTimeout(3000, () => {
    console.log('⏱️ [GET TORRENTS] Request timed out');
    if (!res.headersSent) {
      res.status(503).json({ error: 'Request timeout', message: 'Server is busy, try again later' });
    }
  });

  try {
    // Use simple cache to avoid regenerating the same data repeatedly
    const now = Date.now();
    if (global.torrentListCache &&
      global.torrentListCacheTime &&
      now - global.torrentListCacheTime < 2000) { // 2 second cache
      if (process.env.DEBUG === 'true') {
        console.log(`💾 [GET TORRENTS] Returning cached data`);
      }
      return res.json(global.torrentListCache);
    }

    // Minimize operations by using more efficient code
    const activeTorrents = [];
    for (const key in torrents) {
      const torrent = torrents[key];

      if (!torrent) continue;

      // Try to get IMDB data from cache if it was already fetched
      const imdbData = imdbCache.get(torrent.name);

      activeTorrents.push({
        infoHash: torrent.infoHash,
        name: torrent.name,
        size: torrent.length || 0,
        downloaded: torrent.downloaded || 0,
        uploaded: 0,
        progress: torrent.progress || 0,
        downloadSpeed: torrent.downloadSpeed || 0,
        uploadSpeed: 0,
        peers: torrent.numPeers || 0,
        addedAt: torrent.addedAt || new Date().toISOString(),
        poster: imdbData ? imdbData.Poster : null
      });
    }

    if (process.env.DEBUG === 'true') {
      console.log(`📋 [GET TORRENTS] Returning ${activeTorrents.length} torrents`);
    }

    // Skip verbose logging on each poll
    const response = { torrents: activeTorrents };

    // Cache the result
    global.torrentListCache = response;
    global.torrentListCacheTime = now;

    res.json(response);
  } catch (error) {
    console.error('❌ [GET TORRENTS] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ============================================================================
// GET TORRENT DETAILS ENDPOINT
// ============================================================================

/**
 * Get detailed information about a specific torrent
 */
const getTorrentDetails = async (req, res) => {
  const identifier = req.params.identifier;
  const cacheKey = identifier.toLowerCase(); // Normalize keys

  if (process.env.DEBUG === 'true') {
    console.log(`📋 [TORRENT DETAILS] Request for: ${identifier}`);
  }

  try {
    // 1. Safe Cache Check
    const cached = detailsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 3000)) {
      if (process.env.DEBUG === 'true') {
        console.log(`💾 [TORRENT DETAILS] Returning cached data`);
      }
      return res.json(cached.data);
    }

    if (process.env.DEBUG === 'true') console.log(`🎯 [TORRENT DETAILS] Resolving: ${identifier}`);

    const torrent = await universalTorrentResolver(identifier);

    if (!torrent) {
      // O(1) Performance fix for suggestions: Don't use Object.values()
      const suggestions = [];
      const torrentKeys = Object.keys(torrents);
      for (let i = 0; i < Math.min(5, torrentKeys.length); i++) {
        const t = torrents[torrentKeys[i]];
        suggestions.push({ infoHash: t.infoHash, name: t.name });
      }

      console.log(`❌ [TORRENT DETAILS] Torrent not found: ${identifier}`);
      return res.status(404).json({
        error: 'Torrent not found',
        identifier,
        suggestions,
        availableTorrents: torrentKeys.length
      });
    }

    // --- NEW: Read local downloaded subtitles ---
    let localSubtitles = [];

    try {
      const subDir = path.join(__dirname, 'subtitles', identifier);

      // EXPLICITLY use the promises API right here to guarantee it works
      const fsPromises = require('fs').promises;

      const subFiles = await fsPromises.readdir(subDir);

      for (const file of subFiles) {
        const stats = await fsPromises.stat(path.join(subDir, file));
        localSubtitles.push({
          name: `${torrent.name}/${file}`,
          length: stats.size,
          downloaded: stats.size,
          progress: 1,
          isLocalSubtitle: true,
          fileName: file
        });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Error reading subtitles directory:', err);
      }
    }

    // --- NEW: Combine torrent files with our local subtitle files ---
    const torrentFilesArray = torrent.files || [];
    const allFiles = [...torrentFilesArray, ...localSubtitles];

    // 2. Map data
    const maxFilesToShow = 1000;
    const files = allFiles
      .slice(0, maxFilesToShow)
      .map((file, index) => ({
        index,
        name: file.name,
        size: file.length || 0,
        downloaded: file.downloaded || file.length || 0, // Fallback to length for subtitles
        progress: file.progress !== undefined ? file.progress : 1, // Default to 1 for subtitles
        isLocalSubtitle: file.isLocalSubtitle || false,
        fileName: file.fileName || null
      }));

    const response = {
      torrent: {
        infoHash: torrent.infoHash,
        name: torrent.name,
        size: torrent.length || 0,
        downloaded: torrent.downloaded || 0,
        uploaded: torrent.uploaded || 0,
        progress: torrent.progress || 0,
        downloadSpeed: torrent.downloadSpeed || 0,
        uploadSpeed: torrent.uploadSpeed || 0,
        peers: torrent.numPeers || 0,
        files: allFiles.length, // Updated to reflect combined file count
        addedAt: torrent.addedAt || new Date().toISOString()
      },
      files,
      filesTotal: allFiles.length, // Updated to reflect combined file count
      filesShown: files.length
    };

    // 3. Save to safe cache
    detailsCache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });

    if (process.env.DEBUG === 'true') {
      console.log(`✅ [TORRENT DETAILS] Returning details for: ${torrent.name}`);
    }

    res.json(response);

  } catch (error) {
    console.error(`❌ [TORRENT DETAILS] Failed:`, error.message);
    res.status(500).json({ error: 'Failed to get torrent details: ' + error.message });
  }
};

// ============================================================================
// REMOVE TORRENT ENDPOINT
// ============================================================================

/**
 * Remove a specific torrent and clean up all associated data
 */
const removeTorrent = async (req, res) => {
  const identifier = req.params.identifier.toLowerCase();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🗑️ [REMOVE TORRENT] Request received`);
  console.log(`   - Identifier: ${identifier}`);
  console.log(`   - IP: ${req.ip}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const torrent = universalTorrentResolver(identifier);

    if (!torrent) {
      console.log(`❌ [REMOVE TORRENT] Torrent not found: ${identifier}`);
      return res.status(404).json({ error: 'Torrent not found for removal' });
    }

    const torrentName = torrent.name;
    const infoHash = torrent.infoHash;
    const freedSpace = torrent.downloaded || 0;

    console.log(`📋 [REMOVE TORRENT] Removing: ${torrentName}`);
    console.log(`   - InfoHash: ${infoHash}`);
    console.log(`   - Space to free: ${(freedSpace / 1024 / 1024 / 1024).toFixed(2)} GB`);

    // Wrap the callback in a Promise so we can use clean async/await
    await new Promise((resolve, reject) => {
      // Pass the infoHash directly to client.remove to be absolutely certain
      client.remove(infoHash, { destroyStore: true }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // 1. Clean ALL manual tracking systems safely
    delete torrents[infoHash];
    delete torrentIds[infoHash];
    delete torrentNames[infoHash];
    delete hashToName[infoHash];
    if (torrentName) delete nameToHash[torrentName];

    // 2. Clean our newly implemented Caches so ghost data doesn't remain!
    const { detailsCache, statsCache } = require('../torrent_client');
    detailsCache.delete(infoHash.toLowerCase());
    statsCache.delete(infoHash.toLowerCase());
    if (torrentName) {
      detailsCache.delete(torrentName.toLowerCase());
      statsCache.delete(torrentName.toLowerCase());
    }

    console.log(`✅ [REMOVE TORRENT] Successfully removed: ${torrentName || infoHash}`);

    res.json({
      message: 'Torrent removed successfully',
      freedSpace,
      name: torrentName || 'Unknown'
    });

  } catch (error) {
    console.error(`❌ [REMOVE TORRENT] Failed:`, error.message);
    res.status(500).json({ error: 'Failed to remove torrent: ' + error.message });
  }
};

// ============================================================================
// CLEAR ALL TORRENTS ENDPOINT
// ============================================================================

/**
 * Remove all torrents and clean up all associated data
 * Uses sequential deletion to prevent disk overload
 */
const clearAllTorrents = async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🧹 [CLEAR ALL] Request received`);
  console.log(`   - IP: ${req.ip}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Use WebTorrent's client.torrents as the absolute source of truth
    const activeTorrents = client.torrents;

    if (!activeTorrents || activeTorrents.length === 0) {
      console.log(`ℹ️ [CLEAR ALL] No torrents to clear`);
      return res.json({ message: 'No torrents to clear', cleared: 0, totalFreed: 0 });
    }

    console.log(`📋 [CLEAR ALL] Found ${activeTorrents.length} torrents to remove`);

    let removedCount = 0;
    let totalFreed = 0;

    // SEQUENTIAL LOOP: Do NOT use Promise.all here. 
    // We must wait for one disk deletion to finish before starting the next.
    for (const torrent of activeTorrents) {
      totalFreed += torrent.downloaded || 0;

      console.log(`   - Removing: ${torrent.name || torrent.infoHash.substring(0, 16)}...`);

      try {
        await new Promise((resolve, reject) => {
          client.remove(torrent.infoHash, { destroyStore: true }, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        removedCount++;
      } catch (err) {
        console.error(`⚠️ [CLEAR ALL] Failed to remove ${torrent.infoHash}:`, err.message);
      }
    }

    // Wipe ALL tracking systems (using for...in loop so it works even if they are 'const')
    for (const key in torrents) delete torrents[key];
    for (const key in torrentIds) delete torrentIds[key];
    for (const key in torrentNames) delete torrentNames[key];
    for (const key in hashToName) delete hashToName[key];
    for (const key in nameToHash) delete nameToHash[key];

    // Wipe the entire Stats and Details Caches immediately
    const { detailsCache, statsCache } = require('../torrent_client');
    detailsCache.clear();
    statsCache.clear();

    console.log(`✅ [CLEAR ALL] Cleared ${removedCount} torrents from disk & memory`);
    console.log(`   - Total space freed: ${(totalFreed / 1024 / 1024 / 1024).toFixed(2)} GB`);

    res.json({
      message: `Cleared ${removedCount} torrents successfully`,
      cleared: removedCount,
      totalFreed
    });

  } catch (error) {
    console.error(`❌ [CLEAR ALL] Failed:`, error.message);
    res.status(500).json({ error: 'Failed to clear torrents: ' + error.message });
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  addTorrent,
  uploadTorrent,
  getTorrents,
  getTorrentDetails,
  removeTorrent,
  clearAllTorrents
};
