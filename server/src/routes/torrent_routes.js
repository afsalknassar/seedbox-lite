const express = require('express');
const router = express.Router();

// Import controllers
const authController = require('../controller/auth_controller');
const torrentController = require('../controller/torrent_controller');
const fileController = require('../controller/file_controller');
const metadataController = require('../controller/metadata_controller');
const systemController = require('../controller/system_controller');

// Health check
router.get('/health', authController.getHealth);

// Authentication
router.post('/auth/login', authController.login);

// Torrent management
router.post('/torrents', torrentController.addTorrent);
router.post('/torrents/upload', ...torrentController.uploadTorrent);
router.get('/torrents', torrentController.getTorrents);
router.get('/torrents/:identifier', torrentController.getTorrentDetails);
router.delete('/torrents/:identifier', torrentController.removeTorrent);
router.delete('/torrents', torrentController.clearAllTorrents);

// Torrent files
router.get('/torrents/:identifier/files', fileController.getTorrentFiles);
router.get('/torrents/:identifier/files/:fileIdx/stream', fileController.streamFile);
router.get('/torrents/:identifier/files/:fileIdx/download', fileController.downloadFile);
router.get('/torrents/:identifier/files/:fileIdx/subtitle', fileController.getSubtitle);
router.get('/subtitles/search', fileController.searchSubtitles);
router.get('/subtitles/download', fileController.downloadSubtitle);
router.get('/torrents/:identifier/files/:fileIdx/playlist', fileController.downloadPlaylist);

// Torrent metadata
router.get('/torrents/:identifier/stats', metadataController.getTorrentStats);
router.get('/torrents/:identifier/imdb', metadataController.getIMDBData);

// System endpoints
router.get('/cache/stats', systemController.getCacheStats);
router.get('/system/disk', systemController.getDiskUsage);
router.get('/system/health', systemController.getSystemHealth);

module.exports = router;