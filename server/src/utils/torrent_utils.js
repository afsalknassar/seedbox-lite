/**
 * ============================================================================
 * TORRENT UTILITIES MODULE
 * ============================================================================
 * 
 * This module provides utility functions for torrent operations including:
 * - HTTP requests with timeout
 * - Torrent name cleaning and parsing
 * - Search candidate generation
 * - TMDB data formatting
 * - Universal torrent resolution
 * - Torrent loading from various sources
 * - Seeding management
 * 
 * @module torrent_utils
 */

const { client, torrents, torrentIds, torrentNames, hashToName, nameToHash, isCloud } = require('../torrent_client');

// ============================================================================
// HTTP REQUEST UTILITIES
// ============================================================================

/**
 * Fetch with built-in timeout to prevent hanging requests
 */
async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// ============================================================================
// TORRENT NAME CLEANING
// ============================================================================

/**
 * Enhanced title cleaning for better API results
 * Removes torrent artifacts, quality indicators, release groups, etc.
 */
function cleanTorrentName(torrentName) {
  console.log(`🔍 [NAME CLEANER] Processing: "${torrentName}"`);

  // Extract year first before cleaning
  const yearMatch = torrentName.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;

  // Enhanced series detection - more comprehensive patterns
  const isLikelySeries = /\b(S\d+|Season|SEASON|series|Series|SERIES|E\d+|Episode|EPISODE|COMPLETE|Complete|complete)\b/i.test(torrentName);
  console.log(`📺 [NAME CLEANER] Series detection: ${isLikelySeries ? 'YES' : 'NO'}`);
  console.log(`📅 [NAME CLEANER] Year extracted: ${year || 'N/A'}`);

  // First pass: Remove common torrent artifacts
  let cleaned = torrentName
    .replace(/\[(.*?)\]/g, '') // Remove [groups] like [YTS.MX], [OxTorrent.com]
    .replace(/\((.*?)\)/g, '') // Remove (year) and other parentheses content initially
    .replace(/\.(720p|1080p|480p|2160p|4K)/gi, '') // Remove quality indicators
    .replace(/\.(BluRay|WEBRip|WEB-DL|DVDRip|CAMRip|TS|TC|WEB)/gi, '') // Remove source indicators
    .replace(/\.(x264|x265|H264|H265|HEVC|AVC)/gi, '') // Remove codec info
    .replace(/\.(AAC|MP3|AC3|DTS|FLAC)/gi, '') // Remove audio codec
    .replace(/\.(mkv|mp4|avi|mov|flv)/gi, '') // Remove file extensions
    .replace(/\b(REPACK|PROPER|EXTENDED|UNRATED|DIRECTORS|CUT)\b/gi, '') // Remove edition info
    .replace(/\b\d+CH\b/gi, '') // Remove channel info like 2CH, 5.1CH
    .replace(/\b(PSA|YTS|YIFY|RARBG|EZTV|TGx)\b/gi, '') // Remove release groups
    .replace(/\./g, ' ') // Replace dots with spaces
    .replace(/[-_]/g, ' ') // Replace hyphens and underscores with spaces
    .replace(/\s+/g, ' ') // Normalize multiple spaces
    .trim();

  console.log(`🧹 [NAME CLEANER] After basic cleaning: "${cleaned}"`);

  if (isLikelySeries) {
    console.log(`📺 [NAME CLEANER] Applying series-specific cleaning`);

    // For series, aggressively remove season/episode specific info
    cleaned = cleaned
      .replace(/\b(S\d+.*)/gi, '') // Remove S01 and everything after
      .replace(/\b(Season\s*\d+.*)/gi, '') // Remove Season 1 and everything after
      .replace(/\b(SEASON\s*\d+.*)/gi, '') // Remove SEASON 1 and everything after
      .replace(/\b(E\d+.*)/gi, '') // Remove E01 and everything after
      .replace(/\b(Episode\s*\d+.*)/gi, '') // Remove Episode 1 and everything after
      .replace(/\b(EPISODE\s*\d+.*)/gi, '') // Remove EPISODE 1 and everything after
      .replace(/\b(COMPLETE.*)/gi, '') // Remove COMPLETE and everything after
      .replace(/\b(Complete.*)/gi, '') // Remove Complete and everything after
      .replace(/\b(complete.*)/gi, '') // Remove complete and everything after
      .replace(/\bSERIES\b/gi, '') // Remove standalone SERIES word
      .replace(/\bSeries\b/gi, '') // Remove standalone Series word
      .replace(/\bseries\b/gi, '') // Remove standalone series word
      .replace(/\bWEB\b/gi, '') // Remove WEB
      .replace(/\b\d+CH\b/gi, '') // Remove channel info again
      .replace(/\b(PSA|YTS|YIFY|RARBG|EZTV|TGx)\b/gi, '') // Remove release groups again
      .trim();
  }

  // Final cleanup
  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .trim();

  console.log(`✨ [NAME CLEANER] Final result: title="${cleaned}", year=${year}, isSeries=${isLikelySeries}`);
  return { candidates: cleaned, year, isLikelySeries };
}

// ============================================================================
// SEARCH CANDIDATE GENERATION
// ============================================================================

/**
 * Smart candidate generator for API searches
 * Generates multiple search variations from torrent name
 */
function generateSearchCandidates(torrentName) {
  console.log(`\n🧹 [CANDIDATE GEN] Analyzing: "${torrentName}"`);
  
  let cleaned = torrentName.replace(/(?:www\.|https?:\/\/)[^\s]+|\b[a-zA-Z0-9]+\.[a-z]{2,8}\b(?:\s*-\s*)?/gi, '').replace(/\.[a-z0-9]{3,4}$/i, '');
  const yearMatch = cleaned.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? yearMatch[0] : null;
  const isLikelySeries = /\b([Ss]\d{1,2}|Season|Episode)\b/i.test(torrentName);
  const boundaryRegex = /(?:\b(19\d{2}|20\d{2})\b|\b([Ss]\d{1,2}[Ee]\d{1,2}|[Ss]\d{1,2})\b|\b(Season|Episode)\b|\b(480p|720p|1080p|2160p|4[Kk]|8[Kk])\b|\b(HDR|WEBRip|WEB-DL|BluRay|BDRip|CAM|TS|Malayalam|Tamil|Hindi|Telugu|HQ)\b)/i;

  const match = cleaned.match(boundaryRegex);
  let rawTitle = match ? cleaned.substring(0, match.index) : cleaned;

  let baseTitle = rawTitle.replace(/[\._\-\(\)\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const candidates = [baseTitle];
  const words = baseTitle.split(' ');

  if (words.length > 2) {
    candidates.push(words.slice(1).join(' ')); // Drop 1st word
    if (words.length > 3) candidates.push(words.slice(2).join(' ')); // Drop 1st and 2nd word
  }

  console.log(`🎯 [CANDIDATE GEN] Generated ${candidates.length} candidates:`, candidates);
  return { candidates, year, isLikelySeries };
}

// ============================================================================
// TMDB DATA FORMATTING
// ============================================================================

/**
 * Format TMDB API response to standardized format
 */
function formatTMDBData(details, type) {
  const isTV = type === 'tv';
  return {
    Title: isTV ? details.name : details.title,
    Year: (isTV ? details.first_air_date : details.release_date)?.substring(0, 4) || null,
    imdbRating: details.vote_average ? details.vote_average.toFixed(1) : null,
    imdbVotes: details.vote_count ? `${details.vote_count.toLocaleString()}` : null,
    Plot: details.overview,
    Director: (details.created_by?.map(c => c.name).join(', ')) || (details.credits?.crew?.find(p => p.job === 'Director')?.name) || 'N/A',
    Actors: details.credits?.cast?.slice(0, 4).map(a => a.name).join(', ') || 'N/A',
    Poster: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null,
    Backdrop: details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : null,
    Genre: details.genres?.map(g => g.name).join(', ') || null,
    Runtime: isTV ? (details.episode_run_time?.[0] ? `${details.episode_run_time[0]} min` : null) : (details.runtime ? `${details.runtime} min` : null),
    Rated: 'N/A',
    tmdbID: details.id,
    Type: isTV ? 'series' : 'movie',
    source: `tmdb-${type}`
  };
}

// ============================================================================
// UNIVERSAL TORRENT RESOLVER
// ============================================================================

/**
 * Universal torrent resolver - Can find torrents by ANY identifier
 * Supports: infoHash, magnet URI, torrent name, original ID
 * 
 * Resolution strategies (in order):
 * 1. Direct infoHash lookup (O(1))
 * 2. Name-to-hash lookup (O(1))
 * 3. Original ID lookup (O(1))
 * 4. WebTorrent client scan (O(n))
 */
const universalTorrentResolver = (identifier) => {
  const debugLevel = process.env.DEBUG === 'true';

  if (debugLevel) {
    console.log(`🔍 [RESOLVER] Looking for: "${identifier}"`);
  }

  // Strategy 1: Direct infoHash lookup (O(1))
  if (torrents[identifier]) {
    if (debugLevel) console.log(`✅ [RESOLVER] Found via direct hash lookup`);
    return torrents[identifier];
  }

  // Strategy 2: Name-to-hash lookup (O(1))
  const hashByName = nameToHash[identifier];
  if (hashByName && torrents[hashByName]) {
    if (debugLevel) console.log(`✅ [RESOLVER] Found via name-to-hash lookup`);
    return torrents[hashByName];
  }

  // Strategy 3: Original ID lookup (O(1))
  const originalTorrentId = torrentIds[identifier];
  if (originalTorrentId && torrents[originalTorrentId]) {
    if (debugLevel) console.log(`✅ [RESOLVER] Found via original ID lookup`);
    return torrents[originalTorrentId];
  }

  // Strategy 4: WebTorrent client scan (O(n))
  const isHash = identifier.length === 40;
  const existingTorrent = client.torrents.find(t =>
    isHash ? t.infoHash === identifier : (t.name === identifier || t.magnetURI === identifier)
  );

  if (existingTorrent) {
    if (debugLevel) console.log(`✅ [RESOLVER] Found via client scan`);
    torrents[existingTorrent.infoHash] = existingTorrent;
    return existingTorrent;
  }

  if (debugLevel) console.log(`❌ [RESOLVER] Torrent not found`);
  return null;
};

// ============================================================================
// TORRENT LOADER
// ============================================================================

/**
 * Enhanced torrent loader with duplicate detection and network optimization
 * 
 * Features:
 * - Duplicate interception to prevent re-adding
 * - Red Carpet Protocol: Pauses background torrents for faster metadata
 * - 30-second timeout with background queue
 * - Automatic file selection for media files
 */
const loadTorrentFromId = (torrentId) => {
  return new Promise((resolve, reject) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔄 [TORRENT LOADER] Starting load: ${torrentId.substring(0, 50)}${torrentId.length > 50 ? '...' : ''}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Convert hash to magnet URI if needed
    let magnetUri = torrentId;
    if (torrentId.length === 40 && !torrentId.startsWith('magnet:')) {
      magnetUri = `magnet:?xt=urn:btih:${torrentId}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.demonii.com:1337/announce&tr=udp://tracker.openbittorrent.com:6969/announce&tr=wss://tracker.btorrent.xyz`;
      console.log(`🔗 [TORRENT LOADER] Converted hash to magnet URI`);
    }

    // Configure trackers based on environment
    const webSocketTrackers = ['wss://tracker.btorrent.xyz', 'wss://tracker.webtorrent.io', 'wss://tracker.openwebtorrent.com'];
    const udpTrackers = ['udp://tracker.opentrackr.org:1337/announce', 'udp://open.demonii.com:1337/announce', 'udp://tracker.openbittorrent.com:6969/announce'];

    const torrentOptions = {
      announce: isCloud ? webSocketTrackers : [...udpTrackers, ...webSocketTrackers],
      maxWebConns: isCloud ? 5 : 30,
      downloadLimit: isCloud ? (10 * 1024 * 1024) : -1,
      uploadLimit: isCloud ? (50 * 1024) : (5 * 1024 * 1024),
      path: './downloads',
      private: false
    };

    console.log(`⚙️ [TORRENT LOADER] Trackers: ${isCloud ? 'WebSocket only (cloud)' : 'UDP + WebSocket (local)'}`);

    // 1. DUPLICATE INTERCEPTOR
    let hash = torrentId;
    if (torrentId.startsWith('magnet:')) {
      const match = torrentId.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
      if (match) hash = match[1];
    } else if (torrentId.length === 40) {
      hash = torrentId;
    }

    const existingTorrent = client.get(hash);
    if (existingTorrent) {
      console.log(`⚡ [TORRENT LOADER] Duplicate detected - already in memory: ${existingTorrent.name || existingTorrent.infoHash}`);
      torrents[existingTorrent.infoHash] = existingTorrent;

      if (existingTorrent.ready || existingTorrent.metadata) {
        console.log(`✅ [TORRENT LOADER] Returning existing torrent (ready)`);
        return resolve(existingTorrent);
      } else {
        console.log(`⏳ [TORRENT LOADER] Waiting for metadata on existing torrent...`);
        existingTorrent.once('metadata', () => resolve(existingTorrent));
        return;
      }
    }

    let resolved = false;

    // 2. THE RED CARPET PROTOCOL (Fixes network starvation)
    const activeTorrents = client.torrents.filter(t => !t.paused && t.progress < 1);

    if (activeTorrents.length > 0) {
      console.log(`🚦 [RED CARPET] Pausing ${activeTorrents.length} background torrents for priority...`);
      activeTorrents.forEach(t => {
        t.pause(); // Cleanly stops network activity
      });
    }

    const restoreBackgroundSpeeds = () => {
      if (activeTorrents.length > 0) {
        console.log(`🚦 [RED CARPET] Resuming ${activeTorrents.length} background torrents`);
        activeTorrents.forEach(t => {
          // Only resume if it actually needs to finish downloading
          if (t.paused && t.progress < 1) {
            t.resume();
          }
        });
      }
    };

    // 3. ADD AND PROCESS TORRENT
    try {
      const torrent = client.add(magnetUri, torrentOptions);
      console.log(`➕ [TORRENT LOADER] Added to WebTorrent client`);

      torrent.on('metadata', () => {
        console.log(`📋 [TORRENT LOADER] Metadata received: ${torrent.name || 'Unknown'}`);
        restoreBackgroundSpeeds(); // Wake up other downloads
      });

      torrent.on('ready', () => {
        if (resolved) return;
        resolved = true;

        console.log(`✅ [TORRENT LOADER] Torrent ready: ${torrent.name}`);
        console.log(`   - Size: ${(torrent.length / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   - Files: ${torrent.files.length}`);

        // Store in all lookup systems
        torrents[torrent.infoHash] = torrent;
        torrentIds[torrent.infoHash] = torrentId;
        torrentNames[torrent.infoHash] = torrent.name;
        hashToName[torrent.infoHash] = torrent.name;
        nameToHash[torrent.name] = torrent.infoHash;
        torrent.addedAt = new Date().toISOString();

        // Configure seeding behavior
        torrent.on('done', () => {
          console.log(`🎉 [TORRENT LOADER] Download complete: ${torrent.name}`);
          torrent.uploadLimit = 0;
          torrent.downloadLimit = 0;
          if (!torrent.paused) torrent.pause();
        });

        // Smart file selection
        let selectedMedia = 0;
        let selectedSubs = 0;
        torrent.files.forEach((file) => {
          const ext = file.name.toLowerCase().split('.').pop();
          if (['srt', 'vtt', 'ass'].includes(ext)) {
            file.select();
            selectedSubs++;
          } else if (['mp4', 'mkv', 'avi'].includes(ext)) {
            file.select();
            selectedMedia++;
            if (torrent.pieces && torrent.pieces.length > 0) {
              const startPiece = file._startPiece;
              const endPiece = Math.min(file._endPiece, startPiece + 10);
              torrent.select(startPiece, endPiece, 1);
            }
          } else {
            file.deselect();
          }
        });

        console.log(`   - Selected media files: ${selectedMedia}`);
        console.log(`   - Selected subtitle files: ${selectedSubs}`);

        resolve(torrent);
      });

      torrent.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        console.error(`❌ [TORRENT LOADER] Error: ${error.message}`);
        restoreBackgroundSpeeds(); // Wake up on error
        reject(error);
      });

      // 4. THE 30-SECOND BACKGROUND QUEUE (Fixes the Headers Sent Crash!)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log(`⏳ [TORRENT LOADER] Slow metadata - moving to background queue`);
          console.log(`   - InfoHash: ${torrent.infoHash.substring(0, 16)}...`);

          restoreBackgroundSpeeds(); // Wake up on timeout

          const placeholderName = `Finding Peers... (${torrent.infoHash.substring(0, 8)})`;

          torrents[torrent.infoHash] = torrent;
          torrentIds[torrent.infoHash] = torrentId;
          torrentNames[torrent.infoHash] = placeholderName;
          hashToName[torrent.infoHash] = placeholderName;
          torrent.addedAt = new Date().toISOString();

          // Resolve cleanly so Express sends a response BEFORE the cloud timeout
          resolve({
            infoHash: torrent.infoHash,
            name: placeholderName,
            status: 'queued',
            isBackground: true
          });
        }
      }, 30000); // CRITICAL: Must be 30000 to beat the 60s proxy timeout

    } catch (addError) {
      console.error(`❌ [TORRENT LOADER] Add error: ${addError.message}`);
      restoreBackgroundSpeeds();
      reject(addError);
    }
  });
};

// ============================================================================
// SEEDING MANAGEMENT
// ============================================================================

/**
 * Disable seeding for completed torrents
 * Stops upload bandwidth for torrents that are 100% downloaded
 */
const disableSeedingForCompletedTorrents = () => {
  let count = 0;
  
  console.log(`🛑 [SEEDING MANAGER] Checking completed torrents...`);
  
  client.torrents.forEach(torrent => {
    if (torrent.progress >= 1 && !torrent.paused) {
      torrent.pause();
      torrent.uploadLimit = 0;
      torrent.downloadLimit = 0;
      count++;
      console.log(`   - Disabled seeding for: ${torrent.name}`);
    }
  });
  
  if (count > 0) {
    console.log(`✅ [SEEDING MANAGER] Disabled seeding for ${count} torrents`);
  } else {
    console.log(`ℹ️ [SEEDING MANAGER] No completed torrents found`);
  }
  
  return count;
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  fetchWithTimeout,
  cleanTorrentName,
  generateSearchCandidates,
  formatTMDBData,
  universalTorrentResolver,
  loadTorrentFromId,
  disableSeedingForCompletedTorrents
};
