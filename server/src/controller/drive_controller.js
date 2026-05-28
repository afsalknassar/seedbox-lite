const { google } = require('googleapis');
const { universalTorrentResolver } = require('../utils/torrent_utils');

// Keep track of active uploads for SSE progress
const activeUploads = new Map();

/**
 * Handle file upload to Google Drive
 */
const uploadToDrive = async (req, res) => {
  const { accessToken, infoHash, fileIdx } = req.body;

  if (!accessToken || !infoHash || fileIdx === undefined) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const torrent = await universalTorrentResolver(infoHash);
    if (!torrent) {
      return res.status(404).json({ error: 'Torrent not found' });
    }

    const file = torrent.files[fileIdx];
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Generate unique upload ID
    const uploadId = `${infoHash}-${fileIdx}`;
    
    // Initialize progress tracking
    activeUploads.set(uploadId, {
      progress: 0,
      status: 'starting',
      fileSize: file.length,
      bytesUploaded: 0,
      error: null
    });

    // Send the upload ID to the client immediately so they can subscribe to SSE
    res.json({ success: true, uploadId, fileName: file.name });

    // Start background upload
    startBackgroundUpload(drive, file, uploadId, torrent);

  } catch (error) {
    console.error('❌ [DRIVE UPLOAD] Initialization failed:', error.message);
    res.status(500).json({ error: 'Failed to initialize upload' });
  }
};

const startBackgroundUpload = async (drive, file, uploadId, torrent) => {
  const uploadState = activeUploads.get(uploadId);
  try {
    if (torrent.paused) {
      torrent.resume();
    }
    file.select();

    const stream = file.createReadStream();
    
    // Explicitly handle local file read errors to prevent crashing/hanging
    stream.on('error', (err) => {
      console.error(`❌ [STREAM ERROR] for ${uploadId}:`, err);
      if (uploadState) {
        uploadState.status = 'failed';
        uploadState.error = 'Server encountered a file read error.';
      }
    });

    const fileMetadata = {
      name: file.name
    };

    // Very basic mime type detection based on extension
    const ext = file.name.split('.').pop().toLowerCase();
    const mimeTypes = {
      'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'avi': 'video/x-msvideo',
      'mov': 'video/quicktime', 'wmv': 'video/x-ms-wmv', 'flv': 'video/x-flv',
      'webm': 'video/webm', 'm4v': 'video/mp4', 'ts': 'video/mp2t',
      'mts': 'video/mp2t', '3gp': 'video/3gpp', 'mpg': 'video/mpeg',
      'mpeg': 'video/mpeg', 'vtt': 'text/vtt', 'srt': 'text/plain',
      'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'flac': 'audio/flac',
      'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
      'pdf': 'application/pdf', 'zip': 'application/zip', 'rar': 'application/x-rar-compressed'
    };
    
    const media = {
      mimeType: mimeTypes[ext] || 'application/octet-stream',
      body: stream
    };

    uploadState.status = 'uploading';

    const driveRes = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink'
    }, {
      onUploadProgress: evt => {
        if (uploadState && uploadState.status !== 'failed') {
          uploadState.bytesUploaded = evt.bytesRead;
          uploadState.progress = Math.round((evt.bytesRead / file.length) * 100);
        }
      }
    });

    // Only mark completed if a stream error didn't preemptively fail it
    if (uploadState.status !== 'failed') {
      uploadState.status = 'completed';
      uploadState.progress = 100;
      uploadState.result = driveRes.data;
    }

  } catch (error) {
    console.error(`❌ [DRIVE UPLOAD] Failed for ${uploadId}:`, error.message);
    uploadState.status = 'failed';
    uploadState.error = error.message;
  } finally {
    // Prevent memory leaks: clean up state regardless of how the upload finishes.
    // Give the frontend 5 minutes to fetch the final 'completed' or 'failed' state via SSE.
    setTimeout(() => {
      activeUploads.delete(uploadId);
    }, 5 * 60 * 1000); 
  }
};

const uploadProgressSSE = (req, res) => {
  const { uploadId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const uploadState = activeUploads.get(uploadId);

  if (!uploadState) {
    res.write(`data: ${JSON.stringify({ status: 'not_found' })}\n\n`);
    res.end();
    return;
  }

  // Send initial state
  res.write(`data: ${JSON.stringify(uploadState)}\n\n`);

  // Poll state and send updates
  const intervalId = setInterval(() => {
    const state = activeUploads.get(uploadId);
    
    if (!state) {
      res.write(`data: ${JSON.stringify({ status: 'not_found' })}\n\n`);
      clearInterval(intervalId);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify(state)}\n\n`);

    if (state.status === 'completed' || state.status === 'failed') {
      clearInterval(intervalId);
      res.end();
    }
  }, 1000);

  req.on('close', () => {
    clearInterval(intervalId);
  });
};

const getActiveUploads = (req, res) => {
  const result = {};
  for (const [id, state] of activeUploads.entries()) {
    result[id] = {
      status: state.status,
      progress: state.progress,
      link: state.result?.webViewLink,
      error: state.error
    };
  }
  res.json(result);
};

const cancelUpload = (req, res) => {
  const { uploadId } = req.params;
  const state = activeUploads.get(uploadId);
  if (state) {
    state.status = 'failed';
    state.error = 'Cancelled by user';
    // We can also remove it entirely after a small delay
    setTimeout(() => activeUploads.delete(uploadId), 5000);
    res.json({ success: true, message: 'Upload cancelled' });
  } else {
    res.status(404).json({ error: 'Upload not found or already completed' });
  }
};

module.exports = {
  uploadToDrive,
  uploadProgressSSE,
  getActiveUploads,
  cancelUpload
};