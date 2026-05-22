const express = require('express');
const router = express.Router();

// Import the logic from our controller
const torrentController = require('../controller/torrent_controller');

// Health check
router.get('/health', torrentController.getHealth);

// Authentication
router.post('/auth/login', torrentController.login);

// Torrent management
router.post('/torrents', torrentController.addTorrent);
router.post('/torrents/upload', ...torrentController.uploadTorrent);
router.get('/torrents', torrentController.getTorrents);
router.get('/torrents/:identifier', torrentController.getTorrentDetails);
router.delete('/torrents/:identifier', torrentController.removeTorrent);
router.delete('/torrents', torrentController.clearAllTorrents);

// Torrent files
router.get('/torrents/:identifier/files', torrentController.getTorrentFiles);
router.get('/torrents/:identifier/files/:fileIdx/stream', torrentController.streamFile);
router.get('/torrents/:identifier/files/:fileIdx/download', torrentController.downloadFile);
router.get('/torrents/:identifier/files/:fileIdx/subtitle', torrentController.getSubtitle);

// Torrent metadata
router.get('/torrents/:identifier/stats', torrentController.getTorrentStats);
router.get('/torrents/:identifier/imdb', torrentController.getIMDBData);

// System endpoints
router.get('/cache/stats', torrentController.getCacheStats);
router.get('/system/disk', torrentController.getDiskUsage);
router.get('/system/health', torrentController.getSystemHealth);

module.exports = router;