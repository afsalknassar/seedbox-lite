/**
 * ============================================================================
 * FILE CONTROLLER
 * ============================================================================
 * 
 * This module handles file operations for torrents:
 * - Getting torrent file lists with pagination
 * - Streaming video files with HTTP range support
 * - Downloading files with pause/resume support
 * - Serving subtitle files (SRT/VTT conversion)
 * 
 * Features:
 * - Deep Freeze protocol for streaming optimization
 * - Smart chunking to prevent RAM exhaustion
 * - Debounced thaw to prevent chunk thrashing
 * - SRT to VTT conversion on the fly
 * 
 * @module file_controller
 */

const { client } = require('../torrent_client');
const { universalTorrentResolver } = require('../utils/torrent_utils');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
// ============================================================================
// GET TORRENT FILES ENDPOINT
// ============================================================================

/**
 * Get list of files in a torrent with pagination support
 */
const getTorrentFiles = async (req, res) => {
  const identifier = req.params.identifier;
  const debugLevel = process.env.DEBUG === 'true';

  if (debugLevel) {
    console.log(`📁 [GET FILES] Request for: ${identifier}`);
  }

  // Add a timeout to prevent hanging requests
  const requestTimeout = setTimeout(() => {
    console.log(`⏱️ [GET FILES] Request timed out for: ${identifier}`);
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
      if (debugLevel) {
        console.log(`💾 [GET FILES] Returning cached data`);
      }
      clearTimeout(requestTimeout);
      return res.json(global[cacheKey]);
    }

    const torrent = await universalTorrentResolver(identifier);

    if (!torrent) {
      clearTimeout(requestTimeout);
      console.log(`❌ [GET FILES] Torrent not found: ${identifier}`);
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

    if (debugLevel) {
      console.log(`✅ [GET FILES] Returning ${files.length} files (page ${page}/${Math.ceil(totalFiles / pageSize)})`);
    }

    clearTimeout(requestTimeout);
    res.json(response);

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error(`❌ [GET FILES] Failed:`, error.message);
    res.status(500).json({ error: 'Failed to get torrent files: ' + error.message });
  }
};

// ============================================================================
// SUBTITLE ENDPOINT
// ============================================================================

/**
 * Serve subtitle files with SRT to VTT conversion on the fly
 */
const getSubtitle = async (req, res) => {
  const { identifier, fileIdx } = req.params;
  const isLocal = req.query.isLocal === 'true'; // Allow frontend to tell us it's a local file

  if (process.env.DEBUG === 'true') {
    console.log(`📝 [SUBTITLE] Request for: ${identifier}/${fileIdx} (Local: ${isLocal})`);
  }

  try {
    // 1. Set standard headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');

    let stream;
    let fileName = fileIdx;

    // 2. Determine where to get the stream from (Local Disk vs Torrent Buffer)
    if (isLocal) {
      const fsStream = require('fs');
      const filePath = path.join(__dirname, 'subtitles', identifier, fileIdx);

      if (!fsStream.existsSync(filePath)) {
        console.log(`❌ [SUBTITLE] Local file not found: ${filePath}`);
        return res.status(404).send('Local subtitle not found');
      }

      stream = fsStream.createReadStream(filePath);
    } else {
      // It's a torrent subtitle, read from torrent stream
      const torrent = await universalTorrentResolver(identifier);
      if (!torrent) {
        console.log(`❌ [SUBTITLE] Torrent not found: ${identifier}`);
        return res.status(404).send('Torrent not found');
      }

      const file = torrent.files[parseInt(fileIdx, 10)];
      if (!file) {
        console.log(`❌ [SUBTITLE] File not found: ${fileIdx}`);
        return res.status(404).send('File not found');
      }

      fileName = file.name;
      stream = file.createReadStream();

      // If it's already vtt, pipe it directly and exit
      if (fileName.endsWith('.vtt')) {
        return stream.pipe(res);
      }
    }

    // 3. Convert SRT to VTT on the fly for BOTH local and torrent streams
    res.write('WEBVTT\n\n');

    let remainder = '';
    stream.on('data', (chunk) => {
      let text = remainder + chunk.toString('utf8');

      const lastNewline = text.lastIndexOf('\n');
      if (lastNewline !== -1) {
        remainder = text.substring(lastNewline + 1);
        text = text.substring(0, lastNewline + 1);
      } else {
        remainder = text;
        text = '';
      }

      // Convert time format 00:00:00,000 to 00:00:00.000
      text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      res.write(text);
    });

    stream.on('end', () => {
      if (remainder) {
        res.write(remainder.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
      }
      res.end();
    });

    stream.on('error', (err) => {
      console.error(`❌ [SUBTITLE] Streaming error:`, err.message);
      if (!res.headersSent) res.status(500).send('Error streaming subtitle');
    });

  } catch (error) {
    console.error(`❌ [SUBTITLE] Failed:`, error.message);
    res.status(500).send('Server error');
  }
};

// 1. SEARCH ENDPOINT
const searchSubtitles = async (req, res) => {
  const { query } = req.query;

  if (!query) return res.status(400).json({ error: 'Search query required' });

  try {
    // We search for English by default, but you can pass languages as a parameter
    const response = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?query=${encodeURIComponent(query)}&languages=en`, {
      headers: {
        'Api-Key': process.env.OPENSUBTITLES_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    if (!data.data) return res.json([]);

    // Map the complex API response into a clean, simple array for your React frontend
    const results = data.data.map(sub => ({
      fileId: sub.attributes.files[0].file_id,
      filename: sub.attributes.files[0].file_name,
      language: sub.attributes.language,
      languageCode: sub.attributes.language,
      source: 'OpenSubtitles'
    }));

    res.json(results);
  } catch (error) {
    console.error('Subtitle search error:', error);
    res.status(500).json({ error: 'Failed to search subtitles' });
  }
};

// 2. DOWNLOAD ENDPOINT

// OpenSubtitles requires a POST request to get a download link, then we fetch the actual file.
const downloadSubtitle = async (req, res) => {
  // Destructure torrentHash from the request
  const { fileId, torrentHash, filename } = req.query;

  if (!fileId) return res.status(400).send('fileId is required');
  if (!torrentHash) return res.status(400).send('torrentHash is required');

  try {
    // Step A: Request the secure download link from OpenSubtitles
    const linkResponse = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST',
      headers: {
        'Api-Key': process.env.OPENSUBTITLES_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'seedbox-lite v1.0'
      },
      body: JSON.stringify({ file_id: parseInt(fileId, 10) })
    });

    const linkData = await linkResponse.json();

    if (!linkData.link) {
      return res.status(404).send('Download link not generated');
    }

    // Step B: Fetch the actual subtitle file content
    const fileResponse = await fetch(linkData.link);
    const subtitleText = await fileResponse.text();

    // Step C: Save the subtitle to the file system
    const subDir = path.join(__dirname, 'subtitles', torrentHash);
    await fs.mkdir(subDir, { recursive: true });

    const safeFileName = `${filename}.srt` || `subtitle_${fileId}.srt`;
    const filePath = path.join(subDir, safeFileName);

    // Write the file to disk
    await fs.writeFile(filePath, subtitleText, 'utf8');

    // Send the raw text back to your React frontend
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(subtitleText);

  } catch (error) {
    console.error('Subtitle download error:', error);
    res.status(500).send('Failed to download subtitle file');
  }
};

// ============================================================================
// STREAM FILE ENDPOINT
// ============================================================================

/**
 * Stream video files with HTTP range support and Deep Freeze protocol
 * 
 * Features:
 * - Deep Freeze: Pauses background torrents for priority streaming
 * - Smart Chunking: Prevents RAM exhaustion with 4-8MB chunks
 * - Debounced Thaw: Prevents chunk thrashing with 10s delay
 * - Piece Prioritization: Prioritizes needed pieces for smooth playback
 */
// ============================================================================
// REMUX HELPER — FFmpeg copy mode (no re-encode, container swap only)
// ============================================================================

// File extensions that browsers cannot play natively.
// These get remuxed to fragmented MP4 on-the-fly by FFmpeg.
const REMUX_EXTENSIONS = ['mkv', 'avi', 'mov', 'wmv', 'flv'];

/**
 * Remux MKV/AVI/etc → fragmented MP4 via FFmpeg copy mode.
 *
 * How it works:
 *   Torrent stream → FFmpeg stdin (-c:v copy -c:a copy) → FFmpeg stdout → Browser
 *
 * - No re-encoding: video/audio tracks are copied as-is. CPU usage ~2-5%.
 * - frag_keyframe+empty_moov: writes moov atom first so piped output is
 *   playable immediately without seeking the input stream.
 * - No Accept-Ranges: browser plays progressively; seeking within buffered
 *   portion works, jumping ahead waits for buffer (normal torrent behavior).
 *
 * Fixes Firefox: Firefox refuses video/x-matroska but plays video/mp4 fMP4.
 */
const remuxViaCopy = (file, req, res, debugLevel) => {
  const fileSize = file.length;
  const rangeHeader = req.headers.range;

  // ── Parse Range Header ─────────────────────────────────────────────────────
  // The browser sends Range: bytes=N- when the user seeks to a new position.
  // We start the torrent read at byte N so FFmpeg gets data from near there.
  // For MKV, FFmpeg auto-resyncs to the next cluster keyframe — approximate
  // but good-enough seeking without full re-encode.
  let startByte = 0;
  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    startByte = parseInt(parts[0], 10) || 0;
  }

  // ── Response Headers ─────────────────────────────────────────────────────
  // Accept-Ranges: bytes → tells browser it CAN seek (critical fix!)
  // Content-Length       → lets video.buffered track download progress correctly
  //                        (fixes the incorrect solid blue bar)
  const responseHeaders = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
  };

  if (startByte > 0) {
    // Seek request → 206 Partial Content
    // Content-Length is approximate: fMP4 output ≈ same size as input for copy mode
    responseHeaders['Content-Range'] = `bytes ${startByte}-${fileSize - 1}/${fileSize}`;
    responseHeaders['Content-Length'] = fileSize - startByte;
    res.writeHead(206, responseHeaders);
    if (debugLevel) {
      console.log(`🔍 [REMUX] Seek: byte ${startByte} / ${fileSize} (${((startByte / fileSize) * 100).toFixed(1)}%)`);
    }
  } else {
    // Initial load → 200 OK
    responseHeaders['Content-Length'] = fileSize;
    res.writeHead(200, responseHeaders);
    if (debugLevel) {
      console.log(`🎬 [REMUX] Start: ${file.name} (${(fileSize / 1024 / 1024 / 1024).toFixed(2)} GB)`);
    }
  }

  // ── Torrent Stream ─────────────────────────────────────────────────────
  // Start reading from the requested byte offset.
  // For MKV files, FFmpeg scans forward from startByte to the next cluster
  // sync element and begins output from there — giving approximate seeking.
  const torrentStream = file.createReadStream({ start: startByte });

  // ── FFmpeg ──────────────────────────────────────────────────────────────
  const ffmpegArgs = [
    '-i', 'pipe:0',          // read from stdin (torrent byte stream)
    '-c:v', 'copy',          // copy video — NO re-encode
    '-c:a', 'copy',          // copy audio — NO re-encode
    '-movflags', 'frag_keyframe+empty_moov+faststart',
    '-f', 'mp4',             // fragmented MP4 output
    'pipe:1'                 // write to stdout → HTTP response
  ];

  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  torrentStream.pipe(ffmpegProcess.stdin);
  ffmpegProcess.stdout.pipe(res);

  // Always drain stderr — if not consumed, FFmpeg’s internal buffer fills up
  // and the stdout pipe stalls, causing the video to freeze
  if (debugLevel) {
    ffmpegProcess.stderr.on('data', (data) =>
      console.log(`[FFmpeg] ${data.toString().trim()}`)
    );
  } else {
    ffmpegProcess.stderr.resume();
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  // Kill FFmpeg on client disconnect (seeking triggers a new request, closing the old one)
  // Then debounced-thaw so background torrents resume after idle
  req.on('close', () => {
    if (debugLevel) console.log(`🛑 [REMUX] Client closed — killing FFmpeg`);
    torrentStream.destroy();
    try { ffmpegProcess.stdin.destroy(); } catch (_) {}
    ffmpegProcess.kill('SIGKILL');

    // Resume background torrents after 10s of inactivity (same as range path)
    streamThawTimeout = setTimeout(() => {
      client.torrents.forEach(t => {
        if (t.paused && t.progress < 1) t.resume();
      });
      if (debugLevel) console.log('🔓 [REMUX] Thaw: background torrents resumed');
    }, 10000);
  });

  ffmpegProcess.on('error', (err) => {
    console.error(`❌ [REMUX] FFmpeg process error: ${err.message}`);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });

  torrentStream.on('error', (err) => {
    console.error(`❌ [REMUX] Torrent stream error: ${err.message}`);
    ffmpegProcess.kill('SIGKILL');
  });

  if (debugLevel) {
    ffmpegProcess.on('close', (code) =>
      console.log(`[FFmpeg] Process exited with code ${code}`)
    );
  }
};

let streamThawTimeout = null;

const streamFile = async (req, res) => {
  const { identifier, fileIdx } = req.params;
  const debugLevel = process.env.DEBUG === 'true';
  const streamRequestId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  if (debugLevel) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🎬 [STREAM] Request: ${identifier}/${fileIdx}`);
    console.log(`   - Request ID: ${streamRequestId}`);
    console.log(`   - IP: ${req.ip}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  // 1. CANCEL ANY PENDING THAW
  // A new chunk request just came in, so the user is still watching.
  // This prevents the debounce from waking up torrents while user is actively watching
  if (streamThawTimeout) {
    clearTimeout(streamThawTimeout);
    streamThawTimeout = null;
    if (debugLevel) {
      console.log(`🔄 [STREAM] New chunk requested. Background torrents remaining frozen.`);
    }
  }

  // Set a timeout strictly for the SETUP phase (finding metadata)
  const setupTimeout = setTimeout(() => {
    console.log(`⏱️ [STREAM] Setup timeout for request ${streamRequestId}`);
    if (!res.headersSent) {
      res.status(504).json({ error: 'Streaming request timeout' });
    }
  }, 30000); // 30 seconds is plenty for setup

  try {
    const torrent = await universalTorrentResolver(identifier);

    if (!torrent) {
      clearTimeout(setupTimeout);
      console.log(`❌ [STREAM] Torrent not found: ${identifier}`);
      return res.status(404).json({ error: 'Torrent not found for streaming' });
    }

    const file = torrent.files[parseInt(fileIdx, 10)];
    if (!file) {
      clearTimeout(setupTimeout);
      console.log(`❌ [STREAM] File not found: ${fileIdx}`);
      return res.status(404).json({ error: 'File not found' });
    }

    // 2. THE DEEP FREEZE (Pause everything else)
    let pausedCount = 0;
    client.torrents.forEach(t => {
      if (t.infoHash !== torrent.infoHash && !t.paused) {
        if (process.env.DEBUG === 'true') {
          console.log(`⏸️ [STREAM] Deep-freezing: ${t.name}`);
        }
        t.pause(); // Soft pause the swarm
        pausedCount++;
      }
    });

    if (debugLevel && pausedCount > 0) {
      console.log(`⏸️ [STREAM] Paused ${pausedCount} background torrents`);
    }

    // Now, safely resume ONLY the one we want to watch
    if (torrent.paused) {
      torrent.resume();
    }
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

    // ── REMUX PATH ─────────────────────────────────────────────────────────────
    // MKV, AVI, MOV, WMV, FLV cannot be played natively in Firefox.
    // Remux to fragmented MP4 via FFmpeg copy mode (no re-encode, ~0 CPU cost).
    // MP4 and WebM files skip this entirely and use the range-based path below.
    if (REMUX_EXTENSIONS.includes(ext)) {
      if (debugLevel) {
        console.log(`🎬 [STREAM] ${file.name} → remux path (FFmpeg copy)`);
      }
      return remuxViaCopy(file, req, res, debugLevel);
    }
    // ── END REMUX PATH ─────────────────────────────────────────────────────────

    if (debugLevel) {
      console.log(`🎬 [STREAM] Streaming: ${file.name}`);
      console.log(`   - Size: ${(file.length / 1024 / 1024 / 1024).toFixed(2)} GB`);
      console.log(`   - Content-Type: ${contentType}`);
      console.log(`   - Range: ${range || 'full file'}`);
    }

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);

      // Safari often sends "bytes=0-1" to test range support
      let end = parts[1] ? parseInt(parts[1], 10) : null;

      // Smart Chunking logic to prevent RAM exhaustion
      if (end === null) {
        if (start === 0) {
          end = Math.min(start + (4 * 1024 * 1024), file.length - 1); // 4MB initial
        } else {
          end = Math.min(start + (8 * 1024 * 1024), file.length - 1); // 8MB seeking
        }
      }

      const chunkSize = (end - start) + 1;

      // WebTorrent Piece Prioritization Strategy
      const pieceLength = torrent.pieceLength || 16384;
      const startPiece = Math.floor((file.offset + start) / pieceLength);
      const endPiece = Math.ceil((file.offset + end) / pieceLength);

      try {
        torrent.select(startPiece, endPiece, 1);
        if (typeof torrent.critical === 'function') {
          torrent.critical(startPiece, startPiece + 2);
        }
      } catch (err) {
        if (debugLevel) console.log(`⚠️ [STREAM] Prioritization ignored:`, err.message);
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

      // 3. THE DEBOUNCED THAW ON CLOSE (Fixes chunk thrashing)
      req.on('close', () => {
        stream.destroy(); // Kill the video stream for this chunk

        // Wait 10 seconds before resuming background downloads.
        // If the player asks for the next chunk, this gets cancelled at the top!
        streamThawTimeout = setTimeout(() => {
          if (process.env.DEBUG === 'true') {
            console.log('🛑 [STREAM] Stream closed (10s). Waking up background torrents...');
          }

          client.torrents.forEach(t => {
            if (t.paused && t.progress < 1) {
              t.resume();
            }
          });
        }, 10000);
      });

      stream.on('error', (err) => {
        if (debugLevel) console.error(`❌ [STREAM] Stream error [${streamRequestId}]:`, err.message);
        stream.destroy();
        if (!res.headersSent) res.status(500).end();
      });

      stream.pipe(res);

    } else {
      // Handle full file request (direct downloads)
      res.writeHead(200, {
        'Content-Length': file.length,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = file.createReadStream();

      // Apply the same debounce thaw to non-range requests just in case they drop out
      req.on('close', () => {
        stream.destroy();
        streamThawTimeout = setTimeout(() => {
          client.torrents.forEach(t => {
            if (t.paused && t.progress < 1) {
              t.resume();
            }
          });
        }, 10000);
      });

      stream.on('error', (err) => {
        stream.destroy();
        if (!res.headersSent) res.status(500).end();
      });

      stream.pipe(res);
    }

  } catch (error) {
    clearTimeout(setupTimeout);
    console.error(`❌ [STREAM] Failed:`, error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Streaming failed: ' + error.message });
    }
  }
};

// ============================================================================
// DOWNLOAD FILE ENDPOINT
// ============================================================================

/**
 * Download files with proper headers and pause/resume support
 * 
 * Features:
 * - HTTP range support for pause/resume
 * - Safe filename encoding to prevent header injection
 * - Stream cleanup on cancellation
 * - Memory protection with error handling
 */
const downloadFile = async (req, res) => {
  const { identifier, fileIdx } = req.params;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📥 [DOWNLOAD] Request: ${identifier}/${fileIdx}`);
  console.log(`   - IP: ${req.ip}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const torrent = await universalTorrentResolver(identifier);

    if (!torrent) {
      console.log(`❌ [DOWNLOAD] Torrent not found: ${identifier}`);
      return res.status(404).json({ error: 'Torrent not found for download' });
    }

    const file = torrent.files[fileIdx];
    if (!file) {
      console.log(`❌ [DOWNLOAD] File not found: ${fileIdx}`);
      return res.status(404).json({ error: 'File not found' });
    }

    // 1. Wake up the torrent if it was deep-frozen
    if (torrent.paused) {
      torrent.resume();
      console.log(`▶️ [DOWNLOAD] Resumed paused torrent`);
    }

    // 2. Explicitly prioritize this file to the swarm
    file.select();

    console.log(`📥 [DOWNLOAD] Starting: ${file.name}`);
    console.log(`   - Size: ${(file.length / 1024 / 1024).toFixed(1)} MB`);

    // 3. Clean up the filename and encode it safely to prevent HTTP Header Injection attacks
    const safeFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const encodedFilename = encodeURIComponent(safeFilename);

    // 4. Calculate Ranges for IDM (Internet Download Manager) and pause/resume support
    const range = req.headers.range;
    let start = 0;
    let end = file.length - 1;
    let statusCode = 200;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
      statusCode = 206; // Partial Content

      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.length}`);
      console.log(`📥 [DOWNLOAD] Range request: ${start}-${end}/${file.length}`);
    }

    const chunkSize = (end - start) + 1;

    // 5. Write headers once, cleanly
    res.writeHead(statusCode, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': chunkSize,
      'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
      'Accept-Ranges': 'bytes'
    });

    // 6. Create the optimized stream
    const stream = file.createReadStream({ start, end });

    // 🛡️ CRITICAL STABILITY & MEMORY FIXE
    // Catch mid-download cancellations so they don't crash the Node server
    stream.on('error', (err) => {
      if (err.code === 'ERR_STREAM_PREMATURE_CLOSE' || err.message.includes('prematurely')) {
        if (process.env.DEBUG === 'true') {
          console.log(`🛑 [DOWNLOAD] Cancelled by user: ${file.name}`);
        }
      } else {
        console.error(`❌ [DOWNLOAD] Stream error for ${file.name}:`, err.message);
      }
    });

    // If the user closes the browser or cancels the download, instantly destroy the stream
    // This frees up the server's RAM and network sockets immediately!
    req.on('close', () => {
      if (!stream.destroyed) {
        stream.destroy();
        if (process.env.DEBUG === 'true') {
          console.log(`🛑 [DOWNLOAD] Stream destroyed on close`);
        }
      }
    });

    // 7. Blast the data to the browser
    stream.pipe(res);

  } catch (error) {
    console.error(`❌ [DOWNLOAD] Failed:`, error.message);

    // Safety check: Only send a 500 error if we haven't already started sending the file
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed: ' + error.message });
    }
  }
};

const downloadPlaylist = (req, res) => {
  const { identifier, fileIdx } = req.params;

  // Build the full absolute stream URL so VLC knows where to connect
  const host = req.get('host');
  const protocol = req.protocol;
  const streamUrl = `${protocol}://${host}/api/torrents/${identifier}/files/${fileIdx}`;

  // Standard M3U playlist content
  const m3uContent = `#EXTM3U\n#EXTINF:-1,Seedbox Stream\n${streamUrl}\n`;

  // Use video/x-mpegurl (NOT audio/x-mpegurl) so the OS opens it with
  // a VIDEO player (VLC) rather than a music player (Windows Media Player etc.)
  res.setHeader('Content-Type', 'video/x-mpegurl');
  res.setHeader('Content-Disposition', `attachment; filename="stream_${identifier}.m3u"`);

  res.send(m3uContent);
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  downloadPlaylist,
  getTorrentFiles,
  getSubtitle,
  searchSubtitles,
  downloadSubtitle,
  streamFile,
  downloadFile
};
