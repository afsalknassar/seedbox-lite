/**
 * ============================================================================
 * METADATA CONTROLLER
 * ============================================================================
 * 
 * This module handles metadata operations for torrents:
 * - Fetching IMDB/TMDB movie/series information
 * - Getting torrent statistics with caching
 * - Multiple API fallback strategies (TMDB, OMDb)
 * - Local fallback when APIs fail
 * 
 * Features:
 * - Concurrent API searches for faster results
 * - Smart caching to reduce API calls
 * - Timeout protection for external APIs
 * - Series/movie detection
 * 
 * @module metadata_controller
 */

const { client, imdbCache, statsCache } = require('../torrent_client');
const { universalTorrentResolver } = require('../utils/torrent_utils');
const { fetchWithTimeout, cleanTorrentName, generateSearchCandidates, formatTMDBData } = require('../utils/torrent_utils');

// ============================================================================
// IMDB DATA FETCHING
// ============================================================================

/**
 * Fetch IMDB/TMDB metadata for a torrent name
 * Uses multiple strategies: TMDB, OMDb, and local fallback
 */
async function fetchIMDBData(torrentName) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🎬 [IMDB FETCH] Starting for: "${torrentName}"`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Check cache first
  if (imdbCache.has(torrentName)) {
    console.log(`� [IMDB FETCH] Returning cached data`);
    return imdbCache.get(torrentName);
  }

  let { candidates, year, isLikelySeries } = await generateSearchCandidates(torrentName);

  if (!candidates || !candidates[0]) {
    console.log(`⚠️ [IMDB FETCH] No candidates generated, using fallback`);
    const fallback = cleanTorrentName(torrentName);
    candidates = fallback.candidates;
    year = fallback.year;
    isLikelySeries = fallback.isLikelySeries;
  }

  console.log(`📋 [IMDB FETCH] Generated ${candidates.length} candidates`);
  console.log(`   - Year: ${year || 'N/A'}`);
  console.log(`   - Type: ${isLikelySeries ? 'Series' : 'Movie'}`);

  const omdbKey = process.env.OMDB_API_KEY || 'trilogy';
  const tmdbKey = process.env.TMDB_API_KEY;
  const tcKey = process.env.TC_API_KEY;
  const fetchOpts = { headers: { 'Accept': 'application/json', 'User-Agent': 'SeedboxLite/1.0' } };

  // STRATEGY 1: CONCURRENT TMDB SEARCH
  console.log(`\n🔍 [TMDB] Starting concurrent search...`);
  
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
          console.log(`💾 [IMDB FETCH] Cached result`);
          return result;
        }
      }
    } catch (e) {
      console.log(`⚠️ [TMDB] Search failed for "${candidate}":`, e.message);
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
        console.log(`💾 [IMDB FETCH] Cached result`);
        return result;
      }
    } catch (e) {
      // Promise.any throws if all URLs fail, just continue to next candidate
    }
  }

  // STRATEGY 3: LOCAL FALLBACK
  console.log(`\n❌ [IMDB FETCH] All API strategies exhausted. Using local fallback.`);
  const fallbackResult = {
    Title: candidates[0],
    Year: year || 2026,
    imdbRating: 0,
    imdbVotes: 999,
    Plot: "Metadata generation failed. Standard parsing fallback active.",
    Director: 'N/A',
    Actors: 'N/A',
    Poster: '',
    Backdrop: '',
    Genre: 'Unknown',
    Runtime: '0 min',
    Rated: 'NR',
    imdbID: null,
    tmdbID: null,
    Type: isLikelySeries ? 'series' : 'movie',
    source: 'local-fallback'
  };
  
  console.log(`💾 [IMDB FETCH] Cached fallback result`);
  return fallbackResult;
}

// ============================================================================
// TORRENT STATS ENDPOINT
// ============================================================================

/**
 * Get torrent statistics with caching
 */
const getTorrentStats = (req, res) => {
  const identifier = req.params.identifier;
  const debugLevel = process.env.DEBUG === 'true';
  const cacheKey = identifier.toLowerCase();

  if (debugLevel) {
    console.log(`📊 [STATS] Request for: ${identifier}`);
  }

  try {
    // 1. Safe Cache Check (O(1) lookup)
    const cached = statsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 2000)) {
      if (debugLevel) {
        console.log(`� [STATS] Returning cached data`);
      }
      return res.json(cached.data);
    }

    const torrent = universalTorrentResolver(identifier);

    if (!torrent) {
      console.log(`❌ [STATS] Torrent not found: ${identifier}`);
      return res.status(404).json({ error: 'Torrent not found' });
    }

    // 2. Map real WebTorrent stats, stop hardcoding to 0
    const stats = {
      infoHash: torrent.infoHash,
      name: torrent.name,
      size: torrent.length || 0,
      downloaded: torrent.downloaded || 0,
      uploaded: torrent.uploaded || 0,
      progress: torrent.progress || 0,
      downloadSpeed: torrent.downloadSpeed || 0,
      uploadSpeed: torrent.uploadSpeed || 0,
      peers: torrent.numPeers || 0,
      timeStamp: Date.now()
    };

    if (debugLevel) {
      console.log(`📊 [STATS] Returning stats for: ${torrent.name}`);
    }

    // 3. Save to safe cache
    statsCache.set(cacheKey, {
      data: stats,
      timestamp: Date.now()
    });

    res.json(stats);

  } catch (error) {
    console.error(`❌ [STATS] Failed:`, error.message);
    res.status(500).json({ error: 'Failed to get torrent stats: ' + error.message });
  }
};

// ============================================================================
// IMDB DATA ENDPOINT
// ============================================================================

/**
 * Get IMDB/TMDB metadata for a torrent
 */
const getIMDBData = async (req, res) => {
  const identifier = req.params.identifier;
  const debugLevel = process.env.DEBUG === 'true';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🎬 [IMDB ENDPOINT] Request for: ${identifier}`);
  console.log(`   - IP: ${req.ip}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Add a timeout to prevent hanging requests from external APIs
  const requestTimeout = setTimeout(() => {
    console.log(`⏱️ [IMDB ENDPOINT] Request timed out for: ${identifier}`);
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
      if (debugLevel) {
        console.log(`💾 [IMDB ENDPOINT] Returning cached data`);
      }
      clearTimeout(requestTimeout);
      return res.json(global[cacheKey]);
    }

    const torrent = await universalTorrentResolver(identifier);

    if (!torrent) {
      clearTimeout(requestTimeout);
      console.log(`❌ [IMDB ENDPOINT] Torrent not found: ${identifier}`);
      if (debugLevel) console.log(`❌ Torrent not found for identifier: ${identifier}`);
      return res.status(404).json({ error: 'Torrent not found' });
    }

    if (debugLevel) console.log(`🎬 [IMDB ENDPOINT] Found torrent: ${torrent.name}, fetching IMDB data...`);

    const passedTitle = req.query.title;
    const searchName = passedTitle ? passedTitle : torrent.name;

    // Use Promise.race to implement a secondary timeout for just the API call
    console.log(`🎬 [IMDB ENDPOINT] Fetching IMDB data for: ${searchName}`);

    const imdbDataPromise = fetchIMDBData(searchName);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('IMDB API timeout')), 10000)
    );

    const imdbData = await Promise.race([imdbDataPromise, timeoutPromise])
      .catch(err => {
        console.log(`⚠️ [IMDB ENDPOINT] API error/timeout: ${err.message}`);
        return null;
      });

    if (debugLevel) console.log(`🎬 [IMDB ENDPOINT] Result:`, imdbData ? 'SUCCESS' : 'NULL/UNDEFINED');

    let response;

    if (imdbData) {
      response = {
        success: true,
        torrentName: torrent.name,
        imdb: imdbData,
        cached: false
      };
      console.log(`✅ [IMDB ENDPOINT] IMDB data found for: ${torrent.name}`);
    } else {
      response = {
        success: false,
        torrentName: torrent.name,
        message: 'IMDB data not found',
        cached: false
      };
      console.log(`❌ [IMDB ENDPOINT] No IMDB data found for: ${torrent.name}`);
    }

    // Cache the response
    global[cacheKey] = response;
    global[`${cacheKey}_time`] = now;

    clearTimeout(requestTimeout);
    res.json(response);

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error(`❌ [IMDB ENDPOINT] Failed:`, error.message);
    res.status(500).json({ error: 'Failed to get IMDB data: ' + error.message });
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  getTorrentStats,
  getIMDBData,
  fetchIMDBData
};
