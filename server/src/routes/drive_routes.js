const express = require('express');
const router = express.Router();
const driveController = require('../controller/drive_controller');

router.post('/upload', driveController.uploadToDrive);
router.get('/active', driveController.getActiveUploads);
router.get('/progress/:uploadId', driveController.uploadProgressSSE);

module.exports = router;
