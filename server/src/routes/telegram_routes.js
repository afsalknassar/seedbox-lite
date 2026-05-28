const express = require('express');
const router = express.Router();
const telegramController = require('../controller/telegramController');

// Start Telegram Upload
router.post('/upload', telegramController.uploadToTelegram);

// SSE Progress Event Stream
router.get('/progress/:uploadId', telegramController.telegramProgressSSE);

// Get active uploads
router.get('/active', telegramController.getActiveTelegramUploads);

// Cancel upload
router.post('/cancel/:uploadId', telegramController.cancelUpload);

module.exports = router;
