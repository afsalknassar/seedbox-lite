/**
 * ============================================================================
 * STREMIO ADDON ROUTES
 * ============================================================================
 *
 * Implements the Stremio Addon Protocol v4 natively in Express.
 * No stremio-addon-sdk needed — we just return the standard JSON contract.
 *
 * Stremio ID format: seedbox:{infoHash}:{fileIndex}
 * This maps directly to:  /api/torrents/:infoHash/files/:fileIdx/stream
 *
 * Endpoints:
 *   GET /stremio/:token/manifest.json   → Addon manifest
 *   GET /stremio/:token/catalog/...     → Active torrents catalog
 *   GET /stremio/:token/meta/...        → Torrent metadata
 *   GET /stremio/:token/stream/...      → Streamable video file URLs
 *
 * @module stremio_routes
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { client } = require('../torrent_client');
const { universalTorrentResolver, loadTorrentFromId } = require('../utils/torrent_utils');
const { fetchIMDBData, fetchTitleByIMDBId } = require('../controller/metadata_controller');

// ============================================================================
// CONSTANTS & HELPERS
// ============================================================================

const ADDON_ID       = 'personal.seedbox-lite.streams';
const ADDON_VERSION  = '1.0.0';
const ADDON_NAME     = 'My Seedbox';
const ADDON_DESC     = 'Stream torrents directly from your personal Seedbox Lite instance.';

// Video extensions we expose to Stremio
const VIDEO_EXTENSIONS = new Set([
  'mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v',
  'mpg', 'mpeg', 'm2ts', 'ts', 'vob', '3gp', 'ogv', 'rm', 'rmvb'
]);

/**
 * Derive a simple token from ACCESS_PASSWORD using SHA-256.
 * This makes the addon URL private without a full auth system.
 */
function getAddonToken() {
  const password = process.env.ACCESS_PASSWORD || 'seedbox';
  return crypto.createHash('sha256').update(password).digest('hex').slice(0, 16);
}

/**
 * Build the absolute base URL for stream links.
 *
 * Priority order:
 * 1. STREMIO_PUBLIC_URL env var  — explicit override (e.g. https://your-domain.com)
 * 2. SPACE_HOST env var          — set automatically by Hugging Face Spaces
 * 3. x-forwarded-host header     — set by most reverse proxies / cloud platforms
 * 4. req.get('host')             — raw Host header (works for direct local access)
 */
function getBaseUrl(req) {
  // 1. Explicit override always wins
  if (process.env.STREMIO_PUBLIC_URL) {
    return process.env.STREMIO_PUBLIC_URL.replace(/\/$/, '');
  }

  // 2. Hugging Face Spaces sets SPACE_HOST = "username-reponame.hf.space"
  if (process.env.SPACE_HOST) {
    return `https://${process.env.SPACE_HOST}`;
  }

  // 3. Standard reverse-proxy headers
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host     = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';

  // 4. Avoid returning 127.0.0.1 — that's never reachable externally
  if (host.startsWith('127.0.0.1') || host.startsWith('localhost')) {
    // Last resort: fall back to the request's origin if available
    const origin = req.headers['origin'];
    if (origin) return origin.replace(/\/$/, '');
  }

  return `${protocol}://${host}`;
}


/**
 * Validate the token in the request matches our derived token.
 */
function validateToken(req, res, next) {
  const expected = getAddonToken();
  const provided  = req.params.token;
  if (provided !== expected) {
    return res.status(403).json({ error: 'Forbidden — invalid addon token' });
  }
  next();
}

/**
 * Check if a filename is a video file.
 */
function isVideoFile(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Format bytes into a human-readable size string.
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Convert a progress float (0–1) to a readable percentage string.
 */
function formatProgress(progress) {
  return `${Math.round((progress || 0) * 100)}%`;
}

// ============================================================================
// CORS HEADERS — Stremio requires permissive CORS on addon routes
// ============================================================================

router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// ============================================================================
// MANIFEST ENDPOINT
// ============================================================================

/**
 * GET /stremio/:token/manifest.json
 * Returns the addon manifest telling Stremio what resources this addon provides.
 */
router.get('/:token/manifest.json', validateToken, (req, res) => {
  console.log(`🎬 [STREMIO] Manifest requested`);

  const manifest = {
    id:          ADDON_ID,
    version:     ADDON_VERSION,
    name:        ADDON_NAME,
    description: ADDON_DESC,
    logo:        'https://i.imgur.com/HJ9OPsV.png',

    resources: ['catalog', 'meta', 'stream'],
    types:     ['movie', 'series', 'other'],

    catalogs: [
      {
        type:  'other',
        id:    'seedbox-active',
        name:  '🌱 My Seedbox — Active Torrents',
        extra: [{ name: 'skip', isRequired: false }]
      }
    ],

    idPrefixes: ['tt', 'seedbox:'],

    behaviorHints: {
      adult:              false,
      p2p:                false,
      configurable:       false,
      configurationRequired: false
    }
  };

  res.json(manifest);
});

// ============================================================================
// CATALOG ENDPOINT
// ============================================================================

/**
 * GET /stremio/:token/catalog/other/seedbox-active.json
 * Returns all active torrents as Stremio meta items.
 */
router.get('/:token/catalog/other/seedbox-active.json', validateToken, async (req, res) => {
  console.log(`📋 [STREMIO] Catalog requested`);

  try {
    const skip  = parseInt(req.query.skip || '0', 10);
    const limit = 100;

    const activeTorrents = client.torrents || [];
    const sliced = activeTorrents.slice(skip, skip + limit);

    const metas = await Promise.all(sliced.map(async (torrent) => {
      const videoFiles = (torrent.files || []).filter(f => isVideoFile(f.name));
      const totalSize  = torrent.length || 0;
      const progress   = torrent.progress || 0;
      
      const imdbData = await fetchIMDBData(torrent.name).catch(() => null);

      const imdbId = imdbData && imdbData.imdbID ? imdbData.imdbID : null;

      return {
        id:          imdbId ? imdbId : `seedbox:${torrent.infoHash}`,
        type:        (imdbData && imdbData.Type === 'series') ? 'series' : (imdbId ? 'movie' : 'other'),
        name:        (imdbData && imdbData.Title) ? imdbData.Title : (torrent.name || torrent.infoHash),
        poster:      (imdbData && imdbData.Poster) ? imdbData.Poster : null,
        posterShape: (imdbData && imdbData.Poster) ? 'regular' : 'landscape',
        background:  (imdbData && imdbData.Backdrop) ? imdbData.Backdrop : null,
        description: [
          (imdbData && imdbData.Plot) ? `${imdbData.Plot}\n` : '',
          `📦 Size: ${formatBytes(totalSize)}`,
          `⬇️ Progress: ${formatProgress(progress)}`,
          `🎬 Video files: ${videoFiles.length}`,
          `📡 Peers: ${torrent.numPeers || 0}`
        ].join('\n').trim(),
        releaseInfo: (imdbData && imdbData.Year) ? imdbData.Year.toString() : new Date().getFullYear().toString(),
        imdbRating:  (imdbData && imdbData.imdbRating) ? imdbData.imdbRating.toString() : (progress * 10).toFixed(1),
        genres:      (imdbData && imdbData.Genre) ? imdbData.Genre.split(', ') : []
      };
    }));

    res.json({ metas });
  } catch (err) {
    console.error(`❌ [STREMIO] Catalog error:`, err.message);
    res.json({ metas: [] });
  }
});

// ============================================================================
// META ENDPOINT
// ============================================================================

/**
 * GET /stremio/:token/meta/:type/:id.json
 * Returns rich metadata for a specific torrent (identified by seedbox:{infoHash}).
 */
router.get('/:token/meta/:type/:id.json', validateToken, async (req, res) => {
  const { type, id: stremioId } = req.params;
  console.log(`🎬 [STREMIO] Meta requested for: ${stremioId} (type: ${type})`);

  try {
    if (!stremioId.startsWith('seedbox:')) {
      return res.json({ meta: {} });
    }

    const infoHash = stremioId.replace('seedbox:', '');
    const torrent  = await universalTorrentResolver(infoHash);

    if (!torrent) {
      return res.json({ meta: {} });
    }

    const videoFiles = (torrent.files || []).filter(f => isVideoFile(f.name));
    const totalSize  = torrent.length || 0;
    const progress   = torrent.progress || 0;

    const videos = videoFiles.map((file, idx) => {
      const fileIdx = torrent.files.indexOf(file);
      return {
        id:        `seedbox:${torrent.infoHash}:${fileIdx}`,
        title:     file.name,
        released:  new Date().toISOString(),
        overview:  `${formatBytes(file.length)} • ${formatProgress(file.progress || 0)} downloaded`,
        thumbnail: null,
        streams:   []
      };
    });

    const imdbData = await fetchIMDBData(torrent.name).catch(() => null);

    const meta = {
      id:          stremioId,
      type:        type,
      name:        (imdbData && imdbData.Title) ? imdbData.Title : (torrent.name || infoHash),
      poster:      (imdbData && imdbData.Poster) ? imdbData.Poster : null,
      posterShape: (imdbData && imdbData.Poster) ? 'regular' : 'landscape',
      background:  (imdbData && imdbData.Backdrop) ? imdbData.Backdrop : null,
      description: [
        (imdbData && imdbData.Plot) ? `${imdbData.Plot}\n` : '',
        `📦 Total Size: ${formatBytes(totalSize)}`,
        `⬇️ Progress: ${formatProgress(progress)}`,
        `🎬 Video files: ${videoFiles.length}`,
        `📡 Active Peers: ${torrent.numPeers || 0}`,
        `🔑 InfoHash: ${torrent.infoHash}`
      ].join('\n').trim(),
      releaseInfo: (imdbData && imdbData.Year) ? imdbData.Year.toString() : new Date().getFullYear().toString(),
      imdbRating:  (imdbData && imdbData.imdbRating) ? imdbData.imdbRating.toString() : null,
      genres:      (imdbData && imdbData.Genre) ? imdbData.Genre.split(', ') : [],
      director:    (imdbData && imdbData.Director && imdbData.Director !== 'N/A') ? imdbData.Director.split(', ') : [],
      cast:        (imdbData && imdbData.Actors && imdbData.Actors !== 'N/A') ? imdbData.Actors.split(', ') : [],
      runtime:     (imdbData && imdbData.Runtime && imdbData.Runtime !== 'N/A') ? imdbData.Runtime : null,
      videos:      videos,
      trailers:    [],
      links:       [],
      behaviorHints: {
        defaultVideoId: videos.length === 1 ? videos[0].id : null,
        hasScheduledVideos: false
      }
    };

    res.json({ meta });
  } catch (err) {
    console.error(`❌ [STREMIO] Meta error:`, err.message);
    res.json({ meta: {} });
  }
});

// ============================================================================
// STREAM ENDPOINT
// ============================================================================

/**
 * GET /stremio/:token/stream/:type/:id.json
 * Returns HTTP stream URLs for a specific file or all video files in a torrent.
 */
router.get('/:token/stream/:type/:id.json', validateToken, async (req, res) => {
  const { type, id: stremioId } = req.params;
  const baseUrl = getBaseUrl(req);

  console.log(`🎬 [STREMIO] Stream requested for: ${stremioId} (type: ${type})`);

  try {
    let torrent = null;
    let fileIdx = null;

    if (stremioId.startsWith('seedbox:')) {
      const parts    = stremioId.replace('seedbox:', '').split(':');
      const infoHash = parts[0];
      fileIdx  = parts[1] !== undefined ? parseInt(parts[1], 10) : null;
      torrent = await universalTorrentResolver(infoHash);
    } 
    else if (stremioId.startsWith('tt')) {
      // IMDB ID (e.g. tt1234567 or tt1234567:1:1 for series)
      const parts = stremioId.split(':');
      const imdbId = parts[0];
      
      const activeTorrents = client.torrents || [];
      for (const t of activeTorrents) {
        // fetchIMDBData leverages internal memory caching, so this is fast
        const imdbData = await fetchIMDBData(t.name).catch(() => null);
        if (imdbData && imdbData.imdbID === imdbId) {
          torrent = t;
          break;
        }
      }
    }

    if (!torrent) {
      if (stremioId.startsWith('tt')) {
        const imdbId = stremioId.split(':')[0];
        try {
          const proxyUrl = `https://rich-clownfish-18.epaperhubdaily.deno.net/api/v1/search?q=${imdbId}&availability=all`;
          const proxyRes = await fetch(proxyUrl, { 
            headers: { 
              Authorization: "Bearer tc_cc07d834fe3a9fb54d4343e379eec4d8c74f898c9d6048c1", 
              Accept: "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
            } 
          });
          
          if (proxyRes.ok) {
            const proxyData = await proxyRes.json();
            let matches = (proxyData.results || []).filter(r => r.imdb_code === imdbId || r.imdbId === imdbId);
            if (matches.length === 0 && proxyData.results?.[0]) matches.push(proxyData.results[0]);
            
            const allTorrents = [];
            matches.forEach(m => { if (m.torrents) allTorrents.push(...m.torrents); });
            
            if (allTorrents.length > 0) {
              const streams = allTorrents.map(t => {
                const hashOrUrl = t.magnetUrl || t.infoHash; // magnet is better for auto-add
                return {
                  url: `${baseUrl}/stremio/${req.params.token}/auto-add/${encodeURIComponent(hashOrUrl)}`,
                  name: ADDON_NAME + '\n(External)',
                  title: `▶ Download & Stream\nQuality: ${t.quality || 'Unknown'} | Size: ${formatBytes(t.sizeBytes)} | Seeders: ${t.seeders || 0}`,
                  behaviorHints: { notWebReady: false }
                };
              });
              console.log(`✅ [STREMIO] Returning ${streams.length} external stream(s) for: ${imdbId}`);
              return res.json({ streams });
            }
          }
        } catch (searchErr) {
          console.error(`❌ [STREMIO] External search error:`, searchErr.message);
        }
      }
      return res.json({ streams: [] });
    }

    const infoHash = torrent.infoHash;
    const buildStreamUrl = (idx) =>
      `${baseUrl}/api/torrents/${infoHash}/files/${idx}/stream`;

    let streams = [];

    if (fileIdx !== null) {
      const file = torrent.files?.[fileIdx];
      if (file && isVideoFile(file.name)) {
        streams = [{
          url:   buildStreamUrl(fileIdx),
          name:  ADDON_NAME,
          title: `▶ ${file.name}\n${formatBytes(file.length)} • ${formatProgress(file.progress || 0)}`,
          behaviorHints: { notWebReady: false }
        }];
      }
    } else {
      const videoFiles = (torrent.files || [])
        .map((file, idx) => ({ file, idx }))
        .filter(({ file }) => isVideoFile(file.name));

      streams = videoFiles.map(({ file, idx }) => ({
        url:   buildStreamUrl(idx),
        name:  ADDON_NAME,
        title: `▶ ${file.name}\n${formatBytes(file.length)} • ${formatProgress(file.progress || 0)}`,
        behaviorHints: { notWebReady: false }
      }));
    }

    console.log(`✅ [STREMIO] Returning ${streams.length} stream(s) for: ${torrent.name}`);
    res.json({ streams });

  } catch (err) {
    console.error(`❌ [STREMIO] Stream error:`, err.message);
    res.json({ streams: [] });
  }
});

// ============================================================================
// AUTO-ADD ENDPOINT
// ============================================================================

/**
 * GET /stremio/:token/auto-add/:infoHash
 * Automatically adds a torrent to the seedbox, waits for metadata, and redirects to the stream
 */
router.get('/:token/auto-add/:id', validateToken, async (req, res) => {
  const { id } = req.params;
  const baseUrl = getBaseUrl(req);

  console.log(`🎬 [STREMIO] Auto-add requested for: ${id}`);

  try {
    const newTorrent = await loadTorrentFromId(id);
    const infoHash = newTorrent.infoHash;

    const waitForReadyAndRedirect = () => {
      // Find largest video file
      const videoFiles = (newTorrent.files || [])
        .map((file, idx) => ({ file, idx }))
        .filter(({ file }) => isVideoFile(file.name));

      if (videoFiles.length === 0) {
        return res.status(404).send('No streamable video files found in torrent.');
      }

      videoFiles.sort((a, b) => b.file.length - a.file.length);
      const largestFileIdx = videoFiles[0].idx;

      const streamUrl = `${baseUrl}/api/torrents/${infoHash}/files/${largestFileIdx}/stream`;
      console.log(`🎬 [STREMIO] Redirecting to stream: ${streamUrl}`);
      res.redirect(302, streamUrl);
    };

    if (newTorrent.ready || newTorrent.metadata) {
      waitForReadyAndRedirect();
    } else {
      newTorrent.once('metadata', waitForReadyAndRedirect);
    }
  } catch (err) {
    console.error(`❌ [STREMIO] Auto-add error:`, err.message);
    res.status(500).send('Failed to add torrent.');
  }
});

// ============================================================================
// TOKEN INFO ENDPOINT (for the seedbox UI)
// ============================================================================

/**
 * GET /stremio/info
 * Internal endpoint — returns token and install URLs for the seedbox frontend.
 */
router.get('/info', (req, res) => {
  const token   = getAddonToken();
  const baseUrl = getBaseUrl(req);
  const manifestUrl = `${baseUrl}/stremio/${token}/manifest.json`;
  const installUrl  = manifestUrl.replace(/^https?:\/\//, 'stremio://');

  res.json({
    token,
    manifestUrl,
    installUrl,
    addonName: ADDON_NAME,
    addonId: ADDON_ID
  });
});

module.exports = router;
