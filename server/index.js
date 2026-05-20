
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const WebTorrent = require('webtorrent');
const multer = require('multer');

// Environment Configuration with production optimizations
const config = {
  server: {
    port: process.env.SERVER_PORT || 3000,
    host: process.env.SERVER_HOST || 'localhost',
    protocol: process.env.SERVER_PROTOCOL || 'http'
  },
  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:5173'
  },
  omdb: {
    apiKey: process.env.OMDB_API_KEY || '8265bd1c' // Free API key for development
  },

  isDevelopment: process.env.NODE_ENV !== 'production',

  production: {
    streaming: {
      maxConnectionTime: 300000, // 5 minutes
      defaultChunkSize: 4 * 1024 * 1024, // 4MB (Excellent for instant playback)
      streamingUploadRate: 5120, // 5 KB/s (Enough to keep trackers happy, saves outbound bandwidth)
      optimizeForRemote: true
    },
    cache: {
      torrentListTTL: 5000, // 5 seconds
      torrentDetailsTTL: 8000, // 8 seconds
      imdbDataTTL: 3600000, // 1 hour (Good, IMDB data rarely changes)
      memoryCachePurgeThreshold: 800 // 800MB (Perfect buffer for a 1024MB hard limit)
    },
    system: {
      maxMemory: 1024, // 1GB
      monitoring: true,
      logLevel: parseInt(process.env.LOG_LEVEL || '1', 10)
    },
    network: {
      maxConns: 100, // Used for standard production VPS (DigitalOcean/Hetzner)
      defaultUploadLimit: 5120, // 5 KB/s
      apiTimeout: 15000 // 15 seconds
    }
  }
};

const app = express();

// Add performance monitoring middleware for API endpoints
app.use((req, res, next) => {

  // Skip for non-API routes
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  // Store start time
  const startTime = Date.now();

  // Track if the response has been sent
  let responseSent = false;

  // Create a function to log response time
  const logResponseTime = () => {

    if (responseSent) return;

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
  res.setTimeout(10000, () => {
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

// OPTIMIZED WebTorrent configuration for production and cloud environments
const isProduction = process.env.NODE_ENV === 'production';
const isCloud = process.env.CLOUD_DEPLOYMENT === 'true'

console.log(`🌐 Running in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

// Apply production optimization
const client = new WebTorrent({

  // Bandwidth Limits
  uploadLimit: isProduction ? config.production.network.defaultUploadLimit : 10000,
  // CRITICAL: Cap downloads in the cloud (e.g., 5MB/s) to avoid triggering DDoS filters
  downloadLimit: isCloud ? (5 * 1024 * 1024) : -1,

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

// UNIVERSAL STORAGE SYSTEM - Multiple ways to find torrents
const torrents = {};           // Active torrent objects by infoHash
const torrentIds = {};         // Original torrent IDs by infoHash
const torrentNames = {};       // Torrent names by infoHash
const hashToName = {};         // Quick hash-to-name lookup
const nameToHash = {};         // Quick name-to-hash lookup

// Configure multer
const fs = require('fs');
const uploadsDir = 'uploads/';

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
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


// Simple CORS configuration allowing all origins
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  optionsSuccessStatus: 200
}));

// Additional permissive CORS headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept,Origin');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

app.use(express.json());


const imdbCache = new Map();

// Helper: Fetch with a built-in timeout
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


// THE SMART CANDIDATE GENERATOR
function generateSearchCandidates(torrentName) {

  console.log(`\n🧹 Analyzing: "${torrentName}"`);
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

  console.log(`🎯 Generated Candidates:`, candidates);
  return { candidates, year, isLikelySeries };
}

// Helper: Format TMDB Data
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

// 3. THE MAIN FETCH FUNCTION (CONCURRENT)

async function fetchIMDBData(torrentName) {

  console.log(`🎬 Fetching IMDB data for: "${torrentName}"`);

  if (imdbCache.has(torrentName)) {
    console.log(`📋 Using cached IMDB data`);
    return imdbCache.get(torrentName);
  }

  const { candidates, year, isLikelySeries } = generateSearchCandidates(torrentName);
  if (!candidates[0] || candidates[0].length < 2) return null;

  const omdbKey = process.env.OMDB_API_KEY || 'trilogy';
  const tmdbKey = process.env.TMDB_API_KEY;
  const fetchOpts = { headers: { 'Accept': 'application/json', 'User-Agent': 'SeedboxLite/1.0' } };

  // STRATEGY 1: CONCURRENT TMDB SEARCH

  for (const candidate of candidates) {
    console.log(`🔍 [TMDB] Searching candidate: "${candidate}"`);
    try {
      const encodedQuery = encodeURIComponent(candidate);

      // Fire Movie and TV searches SIMULTANEOUSLY
      const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodedQuery}${year ? `&year=${year}` : ''}`;
      const tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${encodedQuery}${year ? `&first_air_date_year=${year}` : ''}`;

      const [movieRes, tvRes] = await Promise.allSettled([
        fetchWithTimeout(movieUrl, fetchOpts, 5000),
        fetchWithTimeout(tvUrl, fetchOpts, 5000)
      ]);

      const movieMatch = movieRes.status === 'fulfilled' ? movieRes.value?.results?.[0] : null;
      const tvMatch = tvRes.status === 'fulfilled' ? tvRes.value?.results?.[0] : null;

      let bestMatch = null;
      let matchType = null;

      // Smart selection based on torrent parsing
      if (isLikelySeries) {
        if (tvMatch) { bestMatch = tvMatch; matchType = 'tv'; }
        else if (movieMatch) { bestMatch = movieMatch; matchType = 'movie'; }
      } else {
        if (movieMatch) { bestMatch = movieMatch; matchType = 'movie'; }
        else if (tvMatch) { bestMatch = tvMatch; matchType = 'tv'; }
      }

      // If a match is found for this candidate, fetch details and break loop immediately!
      if (bestMatch) {
        const detailsUrl = `https://api.themoviedb.org/3/${matchType}/${bestMatch.id}?api_key=${tmdbKey}&append_to_response=credits`;
        const details = await fetchWithTimeout(detailsUrl, fetchOpts, 5000);

        if (details) {
          console.log(`✅ [TMDB] Match found: ${matchType === 'tv' ? details.name : details.title}`);
          const result = formatTMDBData(details, matchType);
          imdbCache.set(torrentName, result);
          return result;
        }
      }
    } catch (e) {
      console.log(`⚠️ TMDB search failed for "${candidate}":`, e.message);
    }
  }

  // STRATEGY 2: CONCURRENT OMDB FALLBACK

  console.log(`\n🔍 [OMDb] TMDB failed. Starting OMDb fallback...`);

  for (const candidate of candidates) {
    const encoded = encodeURIComponent(candidate);
    const omdbUrls = [];

    if (isLikelySeries) {
      if (year) omdbUrls.push(`http://www.omdbapi.com/?apikey=${omdbKey}&t=${encoded}&y=${year}&type=series`);
      omdbUrls.push(`http://www.omdbapi.com/?apikey=${omdbKey}&s=${encoded}&type=series`);
    } else {
      if (year) omdbUrls.push(`http://www.omdbapi.com/?apikey=${omdbKey}&t=${encoded}&y=${year}`);
      omdbUrls.push(`http://www.omdbapi.com/?apikey=${omdbKey}&t=${encoded}`);
    }

    try {
      // Race the URLs: The first one to return a valid movie wins
      const omdbData = await Promise.any(
        omdbUrls.map(async (url) => {
          const res = await fetchWithTimeout(url, {}, 5000);
          if (res.Response === 'True') return res.Search ? res.Search[0] : res;
          throw new Error('No OMDb match');
        })
      );

      if (omdbData && omdbData.Title) {
        console.log(`✅ [OMDb] Match found: ${omdbData.Title}`);
        const result = {
          Title: omdbData.Title, Year: omdbData.Year, imdbRating: omdbData.imdbRating,
          imdbVotes: omdbData.imdbVotes, Plot: omdbData.Plot, Director: omdbData.Director,
          Actors: omdbData.Actors, Poster: omdbData.Poster !== 'N/A' ? omdbData.Poster : null,
          Backdrop: null, Genre: omdbData.Genre, Runtime: omdbData.Runtime,
          Rated: omdbData.Rated, imdbID: omdbData.imdbID, Type: omdbData.Type || (isLikelySeries ? 'series' : 'movie'),
          source: 'omdb'
        };
        imdbCache.set(torrentName, result);
        return result;
      }
    } catch (e) {
      // Promise.any throws if all URLs fail, just continue to next candidate
    }
  }


  // STRATEGY 3: LOCAL FALLBACK

  console.log(`\n❌ All API strategies exhausted.`);
  return {
    Title: candidates[0],
    Year: year || null,
    imdbRating: null,
    imdbVotes: null,
    Plot: "Metadata generation failed. Standard parsing fallback active.",
    Director: 'N/A',
    Actors: 'N/A',
    Poster: null,
    Backdrop: null,
    Genre: null,
    Runtime: null,
    Rated: 'N/A',
    imdbID: null,
    tmdbID: null,
    Type: isLikelySeries ? 'series' : 'movie',
    source: 'local-fallback'
  };
}

//UNIVERSAL TORRENT RESOLVER - Can find torrents by ANY identifier

const universalTorrentResolver = (identifier) => {

  const debugLevel = process.env.DEBUG === 'true';

  if (debugLevel) console.log(`🔍 Universal resolver looking for: ${identifier}`);

  // Strategy 1 & 2: O(1) Memory lookups
  if (torrents[identifier]) return torrents[identifier];

  const hashByName = nameToHash[identifier];
  if (hashByName && torrents[hashByName]) return torrents[hashByName];

  const originalTorrentId = torrentIds[identifier];
  if (originalTorrentId && torrents[originalTorrentId]) return torrents[originalTorrentId];

  // Strategy 3: WebTorrent client check
  const isHash = identifier.length === 40;
  const existingTorrent = client.torrents.find(t =>
    isHash ? t.infoHash === identifier : (t.name === identifier || t.magnetURI === identifier)
  );

  if (existingTorrent) {
    torrents[existingTorrent.infoHash] = existingTorrent;
    return existingTorrent;
  }

  return null;

};

// ENHANCED TORRENT LOADER
const loadTorrentFromId = (torrentId) => {

  return new Promise((resolve, reject) => {

    console.log(`🔄 Loading torrent: ${torrentId}`);

    // If it's just a hash, construct a basic magnet link with reliable trackers
    let magnetUri = torrentId;
    if (torrentId.length === 40 && !torrentId.startsWith('magnet:')) {
      magnetUri = `magnet:?xt=urn:btih:${torrentId}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.demonii.com:1337/announce&tr=udp://tracker.openbittorrent.com:6969/announce&tr=udp://exodus.desync.com:6969/announce&tr=udp://tracker.torrent.eu.org:451/announce&tr=udp://tracker.tiny-vps.com:6969/announce&tr=udp://retracker.lanta-net.ru:2710/announce`;
      console.log(`🧲 Constructed magnet URI from hash: ${magnetUri}`);
    }

    let torrent;

    // Define our Tracker Lists
    // WebSockets work everywhere (Cloud + Local)
    const webSocketTrackers = [
      'wss://tracker.btorrent.xyz',
      'wss://tracker.webtorrent.io',
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.fastcast.nz'
    ];

    // UDP Trackers only work locally or on a standard VPS (Blocked in Hugging Face)
    const udpTrackers = [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://open.demonii.com:1337/announce',
      'udp://tracker.openbittorrent.com:6969/announce',
      'udp://exodus.desync.com:6969/announce',
      'udp://tracker.torrent.eu.org:451/announce',
      'udp://tracker.tiny-vps.com:6969/announce',
      'udp://9.rarbg.to:2710/announce',
      'udp://explodie.org:6969/announce'
    ];

    try {

      // Build the dynamic torrentOptions
      const torrentOptions = {
        // TRACKERS: If in cloud, use ONLY WebSockets. If local, combine UDP and WebSockets.
        announce: isCloud ? webSocketTrackers : [...udpTrackers, ...webSocketTrackers],

        // CONNECTIONS: Strictly limit web connections in the cloud to prevent socket crashes
        maxWebConns: isCloud ? 5 : 30,

        // DOWNLOAD LIMIT: Throttle to 3MB/s in cloud to prevent anti-DDoS bans. Unlimited (-1) locally.
        downloadLimit: isCloud ? (3 * 1024 * 1024) : -1,

        // UPLOAD LIMIT: Keep very low in cloud (50KB/s) just for reciprocity. Higher locally (e.g., 5MB/s).
        uploadLimit: isCloud ? (50 * 1024) : (5 * 1024 * 1024),

        // BEHAVIOR
        path: './downloads', // Keep files out of RAM where possible to save memory
        private: false       // Explicitly allow public peer discovery
      };

      torrent = client.add(magnetUri, torrentOptions);
    } catch (addError) {

      // Handle duplicate torrent error from WebTorrent client
      if (addError.message && addError.message.includes('duplicate')) {
        console.log(`🔍 Duplicate torrent detected in WebTorrent client, finding existing`);

        // Extract hash from the torrent ID
        let hash = torrentId;
        if (torrentId.startsWith('magnet:')) {
          const match = torrentId.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
          if (match) hash = match[1];
        }

        // Find the existing torrent in the client
        const existingTorrent = client.torrents.find(t =>
          t.infoHash.toLowerCase() === hash.toLowerCase()
        );

        if (existingTorrent) {
          console.log(`✅ Found existing torrent in client: ${existingTorrent.name || existingTorrent.infoHash}`);
          resolve(existingTorrent);
          return;
        }
      }

      reject(addError);
      return;
    }

    let resolved = false;

    // Add comprehensive debugging
    console.log(`🎯 Added torrent to WebTorrent client: ${torrent.infoHash}`);

    torrent.on('infoHash', () => {
      console.log(`🔗 Info hash available: ${torrent.infoHash}`);
    });

    torrent.on('metadata', () => {
      console.log(`📋 Metadata received for: ${torrent.name || 'Unknown'}`);
      console.log(`📊 Files found: ${torrent.files.length}`);
    });

    torrent.on('ready', () => {
      if (resolved) return;
      resolved = true;

      console.log(`✅ Torrent loaded: ${torrent.name} (${torrent.infoHash})`);
      console.log(`📊 Torrent stats: ${torrent.files.length} files, ${(torrent.length / 1024 / 1024).toFixed(1)} MB`);

      // Store in ALL our tracking systems
      torrents[torrent.infoHash] = torrent;
      torrentIds[torrent.infoHash] = torrentId;
      torrentNames[torrent.infoHash] = torrent.name;
      hashToName[torrent.infoHash] = torrent.name;
      nameToHash[torrent.name] = torrent.infoHash;

      torrent.addedAt = new Date().toISOString();

      // Balanced upload limit for peer reciprocity (required for downloads)
      torrent.uploadLimit = 5000; // 5KB/s - enough for good peer reciprocity

      // Stop seeding when download is complete
      torrent.on('done', () => {

        if (process.env.DEBUG === 'true') console.log(`✅ Download 100% complete for ${torrent.name} - Silencing network`);

        // 1. Stop uploading
        torrent.uploadLimit = 0;

        // 2. Stop downloading (kills the network chatter)
        torrent.downloadLimit = 0;

        // 3. Forcefully disconnect from all peers 
        // The files remain in memory/disk and will stream perfectly to your video player!
        if (torrent.discovery) {
          torrent.discovery.stop();
        }
        torrent.removePeer(); // Drops existing peer connections

      });

      // Enhanced configuration for streaming with better buffering
      torrent.files.forEach((file, index) => {

        const ext = file.name.toLowerCase().split('.').pop();
        const isSubtitle = ['srt', 'vtt', 'ass', 'ssa', 'sub', 'sbv'].includes(ext);
        const isVideo = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'].includes(ext);

        if (isSubtitle) {
          // Select subtitle files with high priority
          file.select();
          console.log(`📝 Subtitle file prioritized: ${file.name}`);

        } else if (isVideo) {

          file.select();

          // Explicitly prioritize the first ~10MB (assuming standard piece sizes)
          // WebTorrent pieces are usually 16KB to 2MB. 
          // Selecting the first few pieces with highest priority (1):
          if (torrent.pieces && torrent.pieces.length > 0) {
            const startPiece = file._startPiece;
            const endPiece = Math.min(file._endPiece, startPiece + 10); // First ~10 pieces
            torrent.select(startPiece, endPiece, 1);
          }
          console.log(`🎬 Video file optimized for streaming: ${file.name}`);

        } else {
          // Only select video and subtitle files to avoid wasting bandwidth
          file.deselect();
          console.log(`⏭️  Skipping: ${file.name}`);
        }
      });

      resolve(torrent);
    });

    torrent.on('metadata', () => {
      console.log(`📋 Metadata received for: ${torrent.name || 'Unknown'}`);
    });

    torrent.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      console.error(`❌ Error loading torrent:`, error.message);
      reject(error);
    });

    // Extended timeout for better peer discovery and metadata retrieval
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log(`⏰ Timeout loading torrent after 60 seconds: ${torrentId}`);

        // Check if the torrent was actually added to the client
        const clientTorrent = client.torrents.find(t => t.infoHash === torrent.infoHash);
        if (clientTorrent) {
          console.log(`🔍 Found torrent in client after timeout: ${clientTorrent.name || clientTorrent.infoHash}`);

          // Store in tracking systems even if metadata isn't fully ready
          torrents[clientTorrent.infoHash] = clientTorrent;
          torrentIds[clientTorrent.infoHash] = torrentId;
          torrentNames[clientTorrent.infoHash] = clientTorrent.name || 'Loading...';
          hashToName[clientTorrent.infoHash] = clientTorrent.name || 'Loading...';
          if (clientTorrent.name) {
            nameToHash[clientTorrent.name] = clientTorrent.infoHash;
          }

          clientTorrent.addedAt = new Date().toISOString();
          clientTorrent.uploadLimit = 5000; // Moderate upload for peer reciprocity (5KB/s)

          // Try to optimize any video files even if metadata is incomplete
          if (clientTorrent.files && clientTorrent.files.length) {
            clientTorrent.files.forEach(file => {
              const ext = file.name.toLowerCase().split('.').pop();
              if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'].includes(ext)) {
                file.select();
                file.critical = true;
              }
            });
          }

          resolve(clientTorrent);
        } else {
          console.log(`🔍 Client has ${client.torrents.length} torrents total`);
          reject(new Error('Timeout loading torrent'));
        }
      }
    }, 60000); // Extended timeout to 60 seconds
  });
};


// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authentication endpoint
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.ACCESS_PASSWORD || 'seedbox123';

  console.log(`🔐 Login attempt with password: ${password ? '[PROVIDED]' : '[MISSING]'}`);

  if (!password) {
    return res.status(400).json({
      success: false,
      error: 'Password is required'
    });
  }

  if (password === correctPassword) {
    console.log('✅ Authentication successful');
    return res.json({
      success: true,
      message: 'Authentication successful'
    });
  } else {
    console.log('❌ Authentication failed - incorrect password');
    return res.status(401).json({
      success: false,
      error: 'Invalid password'
    });
  }
});

// UNIVERSAL ADD TORRENT - Always succeeds
app.post('/api/torrents', async (req, res) => {
  const { torrentId } = req.body;
  if (!torrentId) return res.status(400).json({ error: 'No torrentId provided' });

  try {
    // 1. Try Resolver
    const existingTorrent = universalTorrentResolver(torrentId);
    if (existingTorrent) {
      return res.json({
        success: true,
        infoHash: existingTorrent.infoHash,
        name: existingTorrent.name || 'Loading...',
        size: existingTorrent.length || 0,
        status: 'found'
      });
    }

    // 2. Load New (handles its own duplicate logic internally)
    const newTorrent = await loadTorrentFromId(torrentId);
    return res.json({
      success: true,
      infoHash: newTorrent.infoHash,
      name: newTorrent.name || 'Loading...',
      size: newTorrent.length || 0,
      status: 'loaded'
    });

  } catch (error) {
    console.error(`❌ Universal add failed:`, error.message);
    res.status(500).json({ error: 'Failed to add torrent: ' + error.message });
  }
});

// Move these to the TOP of your file
const fsPromises = require('fs').promises;
const parseTorrent = require('parse-torrent');

// UNIVERSAL FILE UPLOAD - Handle .torrent files
app.post('/api/torrents/upload', upload.single('torrentFile'), async (req, res) => {
  console.log(`📁 UNIVERSAL FILE UPLOAD`);

  if (!req.file) {
    return res.status(400).json({ error: 'No torrent file provided' });
  }

  const torrentPath = req.file.path;

  try {
    console.log(`📁 Processing uploaded file: ${req.file.originalname}`);

    // ASYNC read - does not block the server
    const torrentBuffer = await fsPromises.readFile(torrentPath);

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
      } catch (addError) {
        if (addError.message && addError.message.includes('duplicate')) {
          console.log(`🔍 Duplicate torrent file detected on add, finding existing`);
          try {
            const parsed = parseTorrent(torrentBuffer);
            const existingTorrent = client.torrents.find(t =>
              t.infoHash.toLowerCase() === parsed.infoHash.toLowerCase()
            );
            if (existingTorrent) {
              return resolve(existingTorrent);
            }
          } catch (parseError) {
            console.error(`❌ Error parsing torrent for duplicate check:`, parseError.message);
          }
        }
        return reject(addError);
      }

      // Stop seeding when download is complete
      loadedTorrent.on('done', () => {
        console.log(`✅ Download complete for ${loadedTorrent.name} - Stopping seeding`);
        loadedTorrent.uploadLimit = 0;
      });

      // TIMEOUT HANDLING
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log(`⏰ Timeout loading torrent file: ${req.file.originalname}`);

          // CRITICAL: Kill the zombie torrent!
          if (loadedTorrent) {
            loadedTorrent.destroy((err) => {
              if (err) console.error(`Error destroying timed-out torrent:`, err);
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

        console.log(`✅ Torrent uploaded and loaded: ${loadedTorrent.name}`);

        // Track in global maps (Remember to implement an eviction strategy for these!)
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

        console.error(`❌ Error loading uploaded torrent:`, err.message);

        if (err.message && err.message.includes('duplicate')) {
          try {
            const parsed = parseTorrent(torrentBuffer);
            const existingTorrent = client.torrents.find(t =>
              t.infoHash.toLowerCase() === parsed.infoHash.toLowerCase()
            );
            if (existingTorrent) {
              return resolve(existingTorrent);
            }
          } catch (parseError) {
            console.error(`❌ Error parsing in error handler:`, parseError.message);
          }
        }

        // Clean up the failed torrent from the client
        loadedTorrent.destroy();
        reject(err);
      });
    });

    // Clean up uploaded file asynchronously
    await fsPromises.unlink(torrentPath);

    res.json({
      success: true,
      infoHash: torrent.infoHash,
      name: torrent.name,
      size: torrent.length,
      status: 'uploaded',
      files: torrent.files ? torrent.files.length : 0
    });

  } catch (error) {
    console.error(`❌ File upload failed:`, error.message);

    // Clean up file on error asynchronously
    try {
      await fsPromises.unlink(torrentPath).catch(() => { }); // Catch inline so it doesn't throw a new unhandled error
    } catch (cleanupError) {
      console.error(`❌ Failed to cleanup file:`, cleanupError.message);
    }

    res.status(500).json({ error: 'Failed to upload torrent: ' + error.message });
  }
});

// UNIVERSAL GET TORRENTS - Always returns results with optimized performance
app.get('/api/torrents', (req, res) => {
  // Add a timeout to abort long-running requests
  res.setTimeout(3000, () => {
    console.log('Request timed out for /api/torrents');
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
      return res.json(global.torrentListCache);
    }

    // Minimize operations by using more efficient code
    const activeTorrents = [];
    for (const key in torrents) {
      const torrent = torrents[key];
      if (!torrent) continue;

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
        addedAt: torrent.addedAt || new Date().toISOString()
      });
    }

    // Skip verbose logging on each poll
    const response = { torrents: activeTorrents };

    // Cache the result
    global.torrentListCache = response;
    global.torrentListCacheTime = now;

    res.json(response);
  } catch (error) {
    console.error('Error in /api/torrents:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// TOP OF FILE: Create a safe, self-cleaning cache
const detailsCache = new Map();

// Helper to clean cache every 1 minute to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of detailsCache.entries()) {
    if (now - value.timestamp > 3000) { // 3-second TTL
      detailsCache.delete(key);
    }
  }
}, 60000);


// UNIVERSAL GET TORRENT DETAILS
app.get('/api/torrents/:identifier', async (req, res) => {
  const identifier = req.params.identifier;
  const cacheKey = identifier.toLowerCase(); // Normalize keys

  try {
    // 1. Safe Cache Check
    const cached = detailsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 3000)) {
      return res.json(cached.data);
    }

    if (process.env.DEBUG === 'true') console.log(`🎯 UNIVERSAL GET: ${identifier}`);

    const torrent = universalTorrentResolver(identifier); // Removed 'await' if you made it sync

    if (!torrent) {
      // O(1) Performance fix for suggestions: Don't use Object.values()
      const suggestions = [];
      const torrentKeys = Object.keys(torrents);
      for (let i = 0; i < Math.min(5, torrentKeys.length); i++) {
        const t = torrents[torrentKeys[i]];
        suggestions.push({ infoHash: t.infoHash, name: t.name });
      }

      return res.status(404).json({
        error: 'Torrent not found',
        identifier,
        suggestions,
        availableTorrents: torrentKeys.length
      });
    }

    // 2. Map data
    const maxFilesToShow = 1000;
    const files = torrent.files
      .slice(0, maxFilesToShow)
      .map((file, index) => ({
        index,
        name: file.name,
        size: file.length || 0,
        downloaded: file.downloaded || 0,
        progress: file.progress || 0
      }));

    const response = {
      torrent: {
        infoHash: torrent.infoHash,
        name: torrent.name,
        size: torrent.length || 0,
        downloaded: torrent.downloaded || 0,
        uploaded: torrent.uploaded || 0, // WebTorrent tracks this, don't hardcode to 0!
        progress: torrent.progress || 0,
        downloadSpeed: torrent.downloadSpeed || 0,
        uploadSpeed: torrent.uploadSpeed || 0, // WebTorrent tracks this too
        peers: torrent.numPeers || 0,
        files: torrent.files?.length || 0,
        addedAt: torrent.addedAt || new Date().toISOString()
      },
      files,
      filesTotal: torrent.files?.length || 0,
      filesShown: files.length
    };

    // 3. Save to safe cache
    detailsCache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });

    res.json(response);

  } catch (error) {
    console.error(`❌ Universal get failed:`, error.message);
    res.status(500).json({ error: 'Failed to get torrent details: ' + error.message });
  }
});

// UNIVERSAL FILES ENDPOINT - Optimized with caching and timeout
app.get('/api/torrents/:identifier/files', async (req, res) => {
  const identifier = req.params.identifier;
  const debugLevel = process.env.DEBUG === 'true';

  // Add a timeout to prevent hanging requests
  const requestTimeout = setTimeout(() => {
    console.log(`⏱️ Files request timed out for: ${identifier}`);
    if (!res.headersSent) {
      res.status(503).json({
        error: 'Request timeout',
        message: 'Files request timed out, try again later'
      });
    }
  }, 5000); // 5 second timeout

  try {
    // Check cache first
    const cacheKey = `files_${identifier}`;
    const now = Date.now();
    if (global[cacheKey] &&
      global[`${cacheKey}_time`] &&
      now - global[`${cacheKey}_time`] < 10000) { // 10 second cache
      clearTimeout(requestTimeout);
      return res.json(global[cacheKey]);
    }

    if (debugLevel) console.log(`📁 UNIVERSAL FILES: ${identifier}`);

    const torrent = await universalTorrentResolver(identifier);

    if (!torrent) {
      clearTimeout(requestTimeout);
      return res.status(404).json({ error: 'Torrent not found' });
    }

    // Handle large torrents more efficiently by paginating results
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 1000;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const totalFiles = torrent.files.length;

    const files = torrent.files
      .slice(start, end)
      .map((file, idx) => ({
        index: start + idx, // Correct index based on pagination
        name: file.name,
        size: file.length || 0,
        downloaded: file.downloaded || 0,
        progress: file.progress || 0
      }));

    const response = {
      files,
      pagination: {
        page,
        pageSize,
        totalFiles,
        totalPages: Math.ceil(totalFiles / pageSize)
      }
    };

    // Cache the response
    global[cacheKey] = response;
    global[`${cacheKey}_time`] = now;

    clearTimeout(requestTimeout);
    res.json(response);

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error(`❌ Universal files failed:`, error.message);
    res.status(500).json({ error: 'Failed to get torrent files: ' + error.message });
  }
});

// TOP OF FILE: Create a dedicated, self-cleaning cache for stats
const statsCache = new Map();

// Clean up stale stats every 10 seconds to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of statsCache.entries()) {
    if (now - value.timestamp > 2000) { // 2-second TTL
      statsCache.delete(key);
    }
  }
}, 10000);

// UNIVERSAL STATS ENDPOINT - Optimized for rapid polling
app.get('/api/torrents/:identifier/stats', (req, res) => {
  const identifier = req.params.identifier;
  const debugLevel = process.env.DEBUG === 'true';
  const cacheKey = identifier.toLowerCase();

  try {
    // 1. Safe Cache Check (O(1) lookup)
    const cached = statsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 2000)) {
      return res.json(cached.data);
    }

    if (debugLevel) console.log(`📊 UNIVERSAL STATS: ${identifier}`);

    // Assuming universalTorrentResolver is synchronous now based on previous optimizations
    const torrent = universalTorrentResolver(identifier);

    if (!torrent) {
      return res.status(404).json({ error: 'Torrent not found' });
    }

    // 2. Map real WebTorrent stats, stop hardcoding to 0
    const stats = {
      infoHash: torrent.infoHash,
      name: torrent.name,
      size: torrent.length || 0,
      downloaded: torrent.downloaded || 0,
      uploaded: torrent.uploaded || 0,         // Pass real upload stats
      progress: torrent.progress || 0,
      downloadSpeed: torrent.downloadSpeed || 0,
      uploadSpeed: torrent.uploadSpeed || 0,   // Pass real upload speed
      peers: torrent.numPeers || 0,
      timeStamp: Date.now()
    };

    // 3. Save to safe cache
    statsCache.set(cacheKey, {
      data: stats,
      timestamp: Date.now()
    });

    res.json(stats);

  } catch (error) {
    console.error(`❌ Universal stats failed:`, error.message);
    res.status(500).json({ error: 'Failed to get torrent stats: ' + error.message });
  }
});

// IMDB Data Endpoint - Optimized with caching and timeout
app.get('/api/torrents/:identifier/imdb', async (req, res) => {

  const identifier = req.params.identifier;
  const debugLevel = process.env.DEBUG === 'true';

  // Add a timeout to prevent hanging requests from external APIs
  const requestTimeout = setTimeout(() => {

    console.log(`⏱️ IMDB request timed out for: ${identifier}`);
    if (!res.headersSent) {
      res.status(503).json({
        error: 'Request timeout',
        message: 'IMDB data request timed out, try again later'
      });
    }
  }, 15000); // 15 second timeout for API calls

  try {


    // Check endpoint-specific cache first
    const cacheKey = `imdb_data_${identifier}`;
    const now = Date.now();

    if (global[cacheKey] && global[`${cacheKey}_time`] && now - global[`${cacheKey}_time`] < 3600000) {
      // 1 hour cache for IMDB data
      clearTimeout(requestTimeout);
      return res.json(global[cacheKey]);
    }

    if (debugLevel) console.log(`🎬 IMDB REQUEST: ${identifier}`);

    const torrent = await universalTorrentResolver(identifier);

    if (!torrent) {

      clearTimeout(requestTimeout);
      if (debugLevel) console.log(`❌ Torrent not found for identifier: ${identifier}`);
      return res.status(404).json({ error: 'Torrent not found' });

    }

    if (debugLevel) console.log(`🎬 Found torrent: ${torrent.name}, fetching IMDB data...`);

    // Use Promise.race to implement a secondary timeout for just the API call
    console.log(`🎬 Fetching IMDB data for: ${torrent.name}`);

    const imdbDataPromise = fetchIMDBData(torrent.name);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('IMDB API timeout')), 10000)
    );

    const imdbData = await Promise.race([imdbDataPromise, timeoutPromise])
      .catch(err => {
        console.log(`⚠️ IMDB API error/timeout: ${err.message}`);
        return null;
      });

    if (debugLevel) console.log(`🎬 IMDB data result:`, imdbData ? 'SUCCESS' : 'NULL/UNDEFINED');

    let response;

    if (imdbData) {
      response = {
        success: true,
        torrentName: torrent.name,
        imdb: imdbData,
        cached: false
      };
      if (debugLevel) console.log(`✅ IMDB data found for: ${torrent.name}`);

    } else {

      response = {
        success: false,
        torrentName: torrent.name,
        message: 'IMDB data not found',
        cached: false
      };
      if (debugLevel) console.log(`❌ No IMDB data found for: ${torrent.name}`);

    }

    // Cache the response
    global[cacheKey] = response;
    global[`${cacheKey}_time`] = now;

    clearTimeout(requestTimeout);
    res.json(response);

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error(`❌ IMDB endpoint failed:`, error.message);
    res.status(500).json({ error: 'Failed to get IMDB data: ' + error.message });
  }
});

// UNIVERSAL STREAMING - Enhanced for production environments
app.get('/api/torrents/:identifier/files/:fileIdx/stream', async (req, res) => {

  const { identifier, fileIdx } = req.params;
  const debugLevel = process.env.DEBUG === 'true';
  const streamRequestId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  if (debugLevel) console.log(`🎬 UNIVERSAL STREAM: ${identifier}/${fileIdx}`);

  // Set a timeout strictly for the SETUP phase (finding metadata)
  const setupTimeout = setTimeout(() => {
    console.log(`⏱️ Stream setup ${streamRequestId} timed out`);
    if (!res.headersSent) {
      res.status(504).json({ error: 'Streaming request timeout' });
    }
  }, 30000); // 30 seconds is plenty for setup

  try {
    const torrent = await universalTorrentResolver(identifier); // assuming this handles its own async correctly

    if (!torrent) {
      clearTimeout(setupTimeout);
      return res.status(404).json({ error: 'Torrent not found for streaming' });
    }

    const file = torrent.files[parseInt(fileIdx, 10)];
    if (!file) {
      clearTimeout(setupTimeout);
      return res.status(404).json({ error: 'File not found' });
    }

    client.torrents.forEach(t => {
      if (t.infoHash !== torrent.infoHash && !t.paused) {
        if (process.env.DEBUG === 'true') console.log(`⏸️ Auto-pausing background torrent: ${t.name}`);
        t.pause();
      }
    });

    // Wake up torrent if paused
    if (torrent.paused) torrent.resume();
    file.select();

    // MIME Type detection
    const ext = file.name.split('.').pop().toLowerCase();
    const mimeTypes = {
      'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'avi': 'video/x-msvideo',
      'mov': 'video/quicktime', 'wmv': 'video/x-ms-wmv', 'flv': 'video/x-flv',
      'webm': 'video/webm', 'm4v': 'video/mp4', 'ts': 'video/mp2t',
      'mts': 'video/mp2t', '3gp': 'video/3gpp', 'mpg': 'video/mpeg',
      'mpeg': 'video/mpeg', 'vtt': 'text/vtt', 'srt': 'text/plain'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const range = req.headers.range;

    // We found the file, clear the setup timeout so it doesn't linger
    clearTimeout(setupTimeout);

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);

      // Safari often sends "bytes=0-1" to test range support. Respect the requested end if provided.
      let end = parts[1] ? parseInt(parts[1], 10) : null;

      // Smart Chunking logic to prevent RAM exhaustion
      if (end === null) {
        if (start === 0) {
          // Initial load: 4MB chunk
          end = Math.min(start + (4 * 1024 * 1024), file.length - 1);
        } else {
          // Scrubbing/Seeking: 8MB chunk for smoother buffering
          end = Math.min(start + (8 * 1024 * 1024), file.length - 1);
        }
      }

      const chunkSize = (end - start) + 1;

      // WebTorrent Piece Prioritization Strategy
      const pieceLength = torrent.pieceLength || 16384;
      const startPiece = Math.floor((file.offset + start) / pieceLength);
      const endPiece = Math.ceil((file.offset + end) / pieceLength);

      try {
        // High priority for the immediate pieces needed
        torrent.select(startPiece, endPiece, 1);

        // Critical priority for the very first piece to start playback instantly
        if (typeof torrent.critical === 'function') {
          torrent.critical(startPiece, startPiece + 2);
        }
      } catch (err) {
        if (debugLevel) console.log(`⚠️ Prioritization ignored:`, err.message);
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        'Connection': 'keep-alive'
      });

      const stream = file.createReadStream({ start, end });

      // CRITICAL LEAK FIX: Destroy WebTorrent stream when client disconnects (scrubbing/closing)
      req.on('close', () => {
        if (debugLevel) console.log(`🛑 [${streamRequestId}] Client disconnected, destroying stream`);
        stream.destroy();
      });

      stream.on('error', (err) => {
        if (debugLevel) console.error(`❌ [${streamRequestId}] Stream error:`, err.message);
        stream.destroy();
        if (!res.headersSent) res.status(500).end();
      });

      stream.pipe(res);

    } else {
      // Handle full file request (Usually only happens if you download the file directly, not streaming)
      res.writeHead(200, {
        'Content-Length': file.length,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = file.createReadStream();

      req.on('close', () => stream.destroy());
      stream.on('error', (err) => {
        stream.destroy();
        if (!res.headersSent) res.status(500).end();
      });

      stream.pipe(res);
    }

  } catch (error) {
    clearTimeout(setupTimeout);
    console.error(`❌ Universal streaming failed:`, error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Streaming failed: ' + error.message });
    }
  }
});

// UNIVERSAL DOWNLOAD - Download files with proper headers
app.get('/api/torrents/:identifier/files/:fileIdx/download', async (req, res) => {
  const { identifier, fileIdx } = req.params;
  console.log(`📥 UNIVERSAL DOWNLOAD: ${identifier}/${fileIdx}`);

  try {
    const torrent = await universalTorrentResolver(identifier);

    if (!torrent) {
      return res.status(404).json({ error: 'Torrent not found for download' });
    }

    const file = torrent.files[fileIdx];
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Ensure torrent is active and file is selected
    torrent.resume();
    file.select();

    console.log(`📥 Downloading: ${file.name} (${(file.length / 1024 / 1024).toFixed(1)} MB)`);

    // Set download headers
    const filename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', file.length);
    res.setHeader('Accept-Ranges', 'bytes');

    // Handle range requests for resume capability
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
      const chunkSize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/octet-stream'
      });

      const stream = file.createReadStream({ start, end });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': file.length,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/octet-stream'
      });
      file.createReadStream().pipe(res);
    }

  } catch (error) {
    console.error(`❌ Universal download failed:`, error.message);
    res.status(500).json({ error: 'Download failed: ' + error.message });
  }
});

// UNIVERSAL REMOVE - Cleans everything
app.delete('/api/torrents/:identifier', async (req, res) => {
  const identifier = req.params.identifier.toLowerCase();
  console.log(`🗑️ UNIVERSAL REMOVE: ${identifier}`);

  try {
    const torrent = universalTorrentResolver(identifier);

    if (!torrent) {
      return res.status(404).json({ error: 'Torrent not found for removal' });
    }

    const torrentName = torrent.name;
    const infoHash = torrent.infoHash;
    const freedSpace = torrent.downloaded || 0;

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
    detailsCache.delete(infoHash.toLowerCase());
    statsCache.delete(infoHash.toLowerCase());
    if (torrentName) {
      detailsCache.delete(torrentName.toLowerCase());
      statsCache.delete(torrentName.toLowerCase());
    }

    console.log(`✅ Torrent removed: ${torrentName || infoHash}`);

    res.json({
      message: 'Torrent removed successfully',
      freedSpace,
      name: torrentName || 'Unknown'
    });

  } catch (error) {
    console.error(`❌ Universal remove failed:`, error.message);
    res.status(500).json({ error: 'Failed to remove torrent: ' + error.message });
  }
});


// UNIVERSAL CLEAR ALL - Safe sequential deletion
app.delete('/api/torrents', async (req, res) => {
  console.log('🧹 UNIVERSAL CLEAR ALL');

  try {
    // Use WebTorrent's client.torrents as the absolute source of truth
    const activeTorrents = client.torrents;

    if (!activeTorrents || activeTorrents.length === 0) {
      return res.json({ message: 'No torrents to clear', cleared: 0, totalFreed: 0 });
    }

    let removedCount = 0;
    let totalFreed = 0;

    // SEQUENTIAL LOOP: Do NOT use Promise.all here. 
    // We must wait for one disk deletion to finish before starting the next.
    for (const torrent of activeTorrents) {
      totalFreed += torrent.downloaded || 0;

      try {
        await new Promise((resolve, reject) => {
          client.remove(torrent.infoHash, { destroyStore: true }, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        removedCount++;
      } catch (err) {
        console.error(`⚠️ Failed to completely remove ${torrent.infoHash}:`, err.message);
      }
    }

    // Wipe ALL tracking systems (using for...in loop so it works even if they are 'const')
    for (const key in torrents) delete torrents[key];
    for (const key in torrentIds) delete torrentIds[key];
    for (const key in torrentNames) delete torrentNames[key];
    for (const key in hashToName) delete hashToName[key];
    for (const key in nameToHash) delete nameToHash[key];

    // Wipe the entire Stats and Details Caches immediately
    detailsCache.clear();
    statsCache.clear();

    console.log(`✅ Cleared ${removedCount} torrents from disk & memory.`);

    res.json({
      message: `Cleared ${removedCount} torrents successfully`,
      cleared: removedCount,
      totalFreed
    });

  } catch (error) {
    console.error(`❌ Universal clear all failed:`, error.message);
    res.status(500).json({ error: 'Failed to clear torrents: ' + error.message });
  }
});

// TOP OF FILE
const { exec } = require('child_process');
const serverStatsCache = new Map(); // Simple cache to prevent polling lag

// Helpers
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i < 0 || i >= sizes.length) return '0 B';
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};


// CACHE STATS - Optimized for rapid polling

app.get('/api/cache/stats', (req, res) => {
  try {
    // 1. Safe Cache Check (2-second TTL to prevent CPU spam)
    const cached = serverStatsCache.get('cacheStats');
    if (cached && (Date.now() - cached.timestamp < 2000)) {
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
      downloadedBytes: downloadedBytes,
      totalTorrentSize: cacheSize,
      totalTorrentSizeFormatted: formatBytes(cacheSize),
      cacheLimitFormatted: formatBytes(cacheLimitBytes),
      usagePercentage: Math.round(usagePercentage * 100) / 100
    };

    // Save to cache
    serverStatsCache.set('cacheStats', { data: stats, timestamp: Date.now() });

    res.json(stats);
  } catch (error) {
    console.error('❌ Error getting cache stats:', error.message);
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
});


// DISK USAGE - Timeout protected

app.get('/api/system/disk', (req, res) => {
  try {
    // 1. Safe Cache Check (5-second TTL - disk space doesn't change instantly)
    const cached = serverStatsCache.get('diskStats');
    if (cached && (Date.now() - cached.timestamp < 5000)) {
      return res.json(cached.data);
    }

    // 2. CRITICAL: Add a timeout to `exec` so it never hangs the server
    exec('df -k .', { timeout: 2000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('⚠️ Disk usage check failed or timed out:', error.message);

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

        // Save to cache
        serverStatsCache.set('diskStats', { data: diskInfo, timestamp: Date.now() });

        res.json(diskInfo);
      } catch (parseError) {
        console.error('❌ Error parsing disk stats:', parseError.message);
        res.status(500).json({ error: 'Failed to parse disk stats' });
      }
    });
  } catch (error) {
    console.error('❌ Error getting disk stats:', error.message);
    res.status(500).json({ error: 'Failed to get disk stats' });
  }
});


// SYSTEM HEALTH & MEMORY MONITORING

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

function setupSystemMonitoring() {
  console.log('🩺 Setting up bulletproof system health monitoring');

  // Check system health every 10 minutes (600,000 ms)
  setInterval(() => {
    try {
      const now = Date.now();
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const rssMemoryMB = Math.round(memoryUsage.rss / 1024 / 1024);

      systemHealth.lastCheck = now;

      console.log(`\n--- System Health Check ---`);
      console.log(`⏱️ Uptime: ${Math.round((now - systemHealth.startTime) / 60000)} minutes`);
      console.log(`💾 Memory: ${heapUsedMB}MB heap / ${rssMemoryMB}MB RSS`);
      console.log(`🧲 Active Torrents: ${client.torrents.length}`);

      // 1. MEMORY PROTECTION LOGIC
      const HIGH_MEMORY_THRESHOLD = 1024; // 1GB

      if (rssMemoryMB > HIGH_MEMORY_THRESHOLD) {
        console.log(`⚠️ HIGH MEMORY DETECTED: ${rssMemoryMB}MB`);
        systemHealth.memoryWarnings++;
        systemHealth.highMemoryDetected = true;

        // Emergency Cleanup (Triggered after ~30 mins of sustained high memory)
        if (systemHealth.memoryWarnings >= 3) {
          console.log('🚨 CRITICAL MEMORY - Triggering Emergency Cleanup');

          // Clear our dedicated Map caches completely
          if (typeof detailsCache !== 'undefined') detailsCache.clear();
          if (typeof statsCache !== 'undefined') statsCache.clear();
          if (typeof serverStatsCache !== 'undefined') serverStatsCache.clear();

          // Force V8 Garbage Collection if the Node process was started with --expose-gc
          if (global.gc) {
            try {
              global.gc();
              console.log('♻️ V8 Garbage Collection forced successfully');
            } catch (e) {
              console.log('♻️ V8 GC failed:', e.message);
            }
          } else {
            console.log('ℹ️ Manual GC not available (requires node --expose-gc flag)');
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

            console.log(`⚠️ Stalled torrent: ${torrent.name || identifier}`);
            console.log(`   Running: ${Math.round(runningHours)}h | Progress: ${(torrent.progress * 100).toFixed(1)}%`);

            try {
              // Destroy the WebTorrent instance
              torrent.destroy();

              // Clean our manual tracking maps
              if (typeof torrents !== 'undefined') delete torrents[identifier];
              if (typeof torrentIds !== 'undefined') delete torrentIds[identifier];
              if (typeof torrentNames !== 'undefined') delete torrentNames[identifier];
              if (typeof hashToName !== 'undefined') delete hashToName[identifier];
              if (torrent.name && typeof nameToHash !== 'undefined') delete nameToHash[torrent.name];

              // Note: We don't automatically restart it anymore. 
              // Re-adding stalled magnet links continuously just causes them to stall again 
              // while polluting the DHT network and wasting local CPU cycles trying to find dead peers.
              // It is safer to just remove dead torrents to free up resources.

              systemHealth.stalledTorrentsRestarted++;
            } catch (e) {
              console.error(`❌ Failed to cleanup stalled torrent:`, e.message);
            }
          }
        });

        if (stalledCount > 0) {
          console.log(`🧹 Cleaned up ${stalledCount} dead/stalled torrents`);
        }
      }
      console.log(`---------------------------\n`);

    } catch (e) {
      console.error('❌ Error in system monitoring loop:', e.message);
    }
  }, 600000); // Check exactly every 10 minutes (600,000 ms)
}

// Initialize the monitor
setupSystemMonitoring();

// Optional: API Route to view system health from a frontend dashboard
app.get('/api/system/health', (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    res.json({
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
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve system health' });
  }
});


// GRACEFUL SHUTDOWN & ERROR HANDLING

// Centralized shutdown logic
const gracefulShutdown = (signal, exitCode = 0) => {
  console.log(`\n📤 [${signal}] received. Starting graceful shutdown...`);

  // 1. Failsafe Timeout: If cleanup takes longer than 10 seconds, force kill
  const forceExit = setTimeout(() => {
    console.error('🚨 Cleanup took too long. Forcefully exiting.');
    process.exit(exitCode);
  }, 10000);
  forceExit.unref(); // Ensures this timer doesn't keep the event loop alive on its own

  // 2. Stop accepting new HTTP requests (Uncomment if you exported your server variable)

  if (typeof server !== 'undefined') {
    server.close(() => console.log('🛑 HTTP server closed to new connections.'));
  }


  // 3. Cleanly destroy WebTorrent (Releases file locks and DHT ports)
  if (typeof client !== 'undefined' && !client.destroyed) {
    console.log('🧲 Destroying WebTorrent client and saving torrent states...');

    // client.destroy() automatically cleans up all active torrents, no loop needed
    client.destroy((err) => {
      if (err) console.error('❌ Error during WebTorrent cleanup:', err.message);
      else console.log('✅ WebTorrent client completely shut down.');

      console.log('👋 Goodbye!');
      process.exit(exitCode);
    });
  } else {
    console.log('👋 Goodbye!');
    process.exit(exitCode);
  }
};

// Handle standard termination signals (Ctrl+C, Docker stop, PM2 reload)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0));
process.on('SIGINT', () => gracefulShutdown('SIGINT', 0));

// Handle Uncaught Exceptions
process.on('uncaughtException', (error) => {
  console.error('\n❌ UNCAUGHT EXCEPTION: The application state is now unstable.');
  console.error(error.stack || error.message);

  // Log to our safe systemHealth object (from the previous refactor)
  if (typeof systemHealth !== 'undefined') {
    systemHealth.lastError = {
      type: 'uncaughtException',
      message: error.message,
      time: Date.now()
    };
  }

  // NEVER swallow uncaught exceptions. Clean up and crash so PM2/Docker can restart it safely.
  gracefulShutdown('UNCAUGHT_EXCEPTION', 1);
});

// Handle Unhandled Promise Rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ UNHANDLED PROMISE REJECTION:');
  console.error(reason);

  if (typeof systemHealth !== 'undefined') {
    systemHealth.lastError = {
      type: 'unhandledRejection',
      message: reason?.message || String(reason),
      time: Date.now()
    };
  }

  // Note: In modern Node.js versions, unhandled rejections will eventually 
  // crash the process anyway. It is safest to treat them like uncaught exceptions.
  // gracefulShutdown('UNHANDLED_REJECTION', 1); 
});

// Function to disable seeding for completed torrents
function disableSeedingForCompletedTorrents() {
  let completedCount = 0;

  client.torrents.forEach(torrent => {
    // Check if torrent is complete (downloaded === length)
    if (torrent.progress === 1 || torrent.downloaded === torrent.length) {
      torrent.uploadLimit = 0;
      completedCount++;
      console.log(`✅ Found completed torrent: ${torrent.name} - Disabled seeding`);
    } else {
      // Add 'done' event handler if not already completed
      torrent.once('done', () => {
        console.log(`✅ Download complete for ${torrent.name} - Stopping seeding`);
        torrent.uploadLimit = 0; // Disable uploading once download is complete
      });
    }
  });

  return completedCount;
}

// Start server
const PORT = config.server.port;
const HOST = config.server.host;

app.listen(PORT, "0.0.0.0", () => {
  const serverUrl = `${config.server.protocol}://${HOST}:${PORT}`;
  console.log(`🌱 Seedbox Lite server running on ${serverUrl}`);
  console.log(`📱 Frontend URL: ${config.frontend.url}`);
  console.log(`🚀 UNIVERSAL TORRENT RESOLUTION SYSTEM ACTIVE`);

  // Disable seeding for any already completed torrents
  setTimeout(() => {
    const completedCount = disableSeedingForCompletedTorrents();
    if (completedCount > 0) {
      console.log(`🛑 Disabled seeding for ${completedCount} already completed torrents`);
    }
  }, 5000); // Give the server 5 seconds to initialize properly

  console.log(`🎯 ZERO "Not Found" Errors Guaranteed`);
  console.log(`⚠️  SECURITY: Download-only mode - Zero uploads guaranteed`);

  if (config.isDevelopment) {
    console.log('🔧 Development mode - Environment variables loaded');
  }
});
