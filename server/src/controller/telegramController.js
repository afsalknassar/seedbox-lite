const { Api, TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const { universalTorrentResolver } = require('../utils/torrent_utils');

// Keep track of active Telegram uploads for SSE progress
const activeTgUploads = new Map();

// Initialize GramJS Client lazily with a Promise to prevent race conditions
let clientPromise = null;

const getClient = async () => {
  if (!clientPromise) {
    clientPromise = (async () => {
      const apiId = parseInt(process.env.TELEGRAM_API_ID);
      const apiHash = process.env.TELEGRAM_API_HASH;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      
      if (isNaN(apiId) || !apiHash || !botToken) {
        throw new Error('Telegram credentials missing in environment variables');
      }

      const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 5,
        useWSS: true, // Websockets are more stable for large payloads
      });
      
      await client.start({ botAuthToken: botToken });
      return client;
    })();
  }
  return clientPromise;
};

const MAX_TG_SIZE = 1.95 * 1024 * 1024 * 1024; // Safe margin under 2GB

/**
 * Split a file sequentially on disk safely handling backpressure and disk writes
 */
const splitFileOnDisk = async (filePath, chunkSize) => {
  const fileStats = await fs.promises.stat(filePath);
  if (fileStats.size <= chunkSize) return [filePath];

  const parts = [];
  let partNum = 1;
  let currentSize = 0;
  let currentWriteStream = null;

  const createNextPart = async () => {
    if (currentWriteStream) {
      currentWriteStream.end();
      // Wait for the stream to fully flush to disk before proceeding
      await new Promise(resolve => currentWriteStream.once('finish', resolve));
    }
    const partPath = `${filePath}.part${partNum.toString().padStart(3, '0')}`;
    parts.push(partPath);
    currentWriteStream = fs.createWriteStream(partPath);
    partNum++;
    currentSize = 0;
  };

  await createNextPart();

  const readStream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 }); // 256KB chunks

  // Using async iteration natively handles read/write backpressure to prevent RAM bloating
  for await (const chunk of readStream) {
    if (currentSize + chunk.length > chunkSize) {
      const spaceLeft = chunkSize - currentSize;
      const chunkForCurrent = chunk.slice(0, spaceLeft);
      const chunkForNext = chunk.slice(spaceLeft);

      if (!currentWriteStream.write(chunkForCurrent)) {
        await new Promise(resolve => currentWriteStream.once('drain', resolve));
      }
      
      await createNextPart();
      
      if (!currentWriteStream.write(chunkForNext)) {
        await new Promise(resolve => currentWriteStream.once('drain', resolve));
      }
      currentSize += chunkForNext.length;
    } else {
      if (!currentWriteStream.write(chunk)) {
        await new Promise(resolve => currentWriteStream.once('drain', resolve));
      }
      currentSize += chunk.length;
    }
  }

  if (currentWriteStream) {
    currentWriteStream.end();
    await new Promise(resolve => currentWriteStream.once('finish', resolve));
  }

  return parts;
};

/**
 * Safely delete a file without crashing the process if it doesn't exist
 */
const safeDelete = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`⚠️ Failed to clean up file ${filePath}:`, error.message);
  }
};

/**
 * Handle initial upload request
 */
const uploadToTelegram = async (req, res) => {
  const { infoHash, fileIdx } = req.body;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!infoHash || fileIdx === undefined || !chatId) {
    return res.status(400).json({ error: 'Missing required parameters or Chat ID' });
  }

  try {
    const torrent = await universalTorrentResolver(infoHash);
    if (!torrent) return res.status(404).json({ error: 'Torrent not found' });

    const file = torrent.files[fileIdx];
    if (!file) return res.status(404).json({ error: 'File not found' });

    const uploadId = `tg-${infoHash}-${fileIdx}`;
    
    // Prevent duplicate triggers for the same file
    if (activeTgUploads.has(uploadId) && !['failed', 'completed'].includes(activeTgUploads.get(uploadId).status)) {
      return res.json({ success: true, uploadId, fileName: file.name, message: 'Already uploading' });
    }
    
    activeTgUploads.set(uploadId, {
      progress: 0,
      status: 'starting',
      fileSize: file.length,
      currentPart: 1,
      totalParts: Math.ceil(file.length / MAX_TG_SIZE),
      error: null
    });

    res.json({ success: true, uploadId, fileName: file.name });
    
    // Fire and forget background process
    processTelegramUpload(file, uploadId, chatId);

  } catch (error) {
    console.error('❌ [TG UPLOAD] Init failed:', error.message);
    res.status(500).json({ error: 'Failed to initialize upload' });
  }
};

/**
 * Background Upload Process
 */
const processTelegramUpload = async (file, uploadId, chatId) => {
  const uploadState = activeTgUploads.get(uploadId);
  let partsCreated = [];

  try {
    uploadState.status = 'initializing';
    // This now waits safely even if multiple uploads trigger at the exact same time
    const tgClient = await getClient(); 

    uploadState.status = 'splitting';
    
    const actualFilePath = path.join(__dirname, '../../downloads', file.path);
    
    if (!fs.existsSync(actualFilePath)) {
      throw new Error("File not found on disk. Ensure torrent is 100% downloaded.");
    }

    partsCreated = await splitFileOnDisk(actualFilePath, MAX_TG_SIZE);
    uploadState.totalParts = partsCreated.length;

    uploadState.status = 'uploading';

    for (let i = 0; i < partsCreated.length; i++) {
      const partPath = partsCreated[i];
      const partName = partsCreated.length > 1 ? `${file.name}.part${(i + 1).toString().padStart(3, '0')}` : file.name;
      uploadState.currentPart = i + 1;

      await tgClient.sendFile(chatId, {
        file: partPath,
        forceDocument: true, // Bypass video compression to retain original quality
        workers: 4, 
        attributes: [
          new Api.DocumentAttributeFilename({ fileName: partName })
        ],
        progressCallback: (progressFloat) => {
          if (uploadState && uploadState.status !== 'failed') {
            const baseProgress = (i / partsCreated.length) * 100;
            const currentPartProgress = (progressFloat * 100) / partsCreated.length;
            uploadState.progress = Math.round(baseProgress + currentPartProgress);
          }
        }
      });

      // Cleanup chunk immediately after successful upload to free up SSD space
      if (partsCreated.length > 1) {
        safeDelete(partPath);
      }
    }

    uploadState.status = 'completed';
    uploadState.progress = 100;
    uploadState.link = `https://web.telegram.org/`;

  } catch (error) {
    console.error(`❌ [TG UPLOAD] Failed for ${uploadId}:`, error);
    uploadState.status = 'failed';
    uploadState.error = error.message;
    
    // Cleanup any orphaned chunks if the upload crashed mid-way
    partsCreated.forEach(part => {
      if (partsCreated.length > 1) safeDelete(part);
    });
  } finally {
    // Keep state available for frontend to poll final status, then delete
    setTimeout(() => activeTgUploads.delete(uploadId), 5 * 60 * 1000); 
  }
};

/**
 * SSE Progress Stream
 */
const telegramProgressSSE = (req, res) => {
  const { uploadId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendUpdate = () => {
    const state = activeTgUploads.get(uploadId);
    if (!state) {
      res.write(`data: ${JSON.stringify({ status: 'not_found' })}\n\n`);
      return false; // Tells the interval to stop
    }
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    return state.status === 'completed' || state.status === 'failed'; // Tells the interval to stop
  };

  // If the upload is already finished before we even start polling
  if (sendUpdate()) {
    res.end(); // CRITICAL: Close the HTTP connection so it doesn't hang forever
    return;
  }

  const intervalId = setInterval(() => {
    if (sendUpdate()) {
      clearInterval(intervalId);
      res.end(); // Close the connection when done
    }
  }, 1000);

  req.on('close', () => {
    clearInterval(intervalId);
    res.end();
  });
};

const getActiveTelegramUploads = (req, res) => {
  const active = {};
  for (const [uploadId, state] of activeTgUploads.entries()) {
    active[uploadId] = {
      status: state.status,
      progress: state.progress,
      link: state.link,
      error: state.error,
      currentPart: state.currentPart,
      totalParts: state.totalParts
    };
  }
  res.json(active);
};

const cancelUpload = (req, res) => {
  const { uploadId } = req.params;
  const state = activeTgUploads.get(uploadId);
  if (state) {
    state.status = 'failed';
    state.error = 'Cancelled by user';
    // We can also remove it entirely after a small delay
    setTimeout(() => activeTgUploads.delete(uploadId), 5000);
    res.json({ success: true, message: 'Upload cancelled' });
  } else {
    res.status(404).json({ error: 'Upload not found or already completed' });
  }
};

module.exports = {
  uploadToTelegram,
  telegramProgressSSE,
  getActiveTelegramUploads,
  cancelUpload
};