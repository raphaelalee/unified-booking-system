const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const supportUploadDir = path.join(__dirname, '..', 'public', 'uploads', 'support');

fs.mkdirSync(supportUploadDir, { recursive: true });

function sanitizeExtension(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
}

const storage = multer.diskStorage({
    destination: supportUploadDir,
    filename: (req, file, callback) => {
        const extension = sanitizeExtension(path.extname(file.originalname || '')) || '';
        const randomId = crypto.randomBytes(10).toString('hex');
        callback(null, `support-${Date.now()}-${randomId}${extension}`);
    }
});

function fileFilter(req, file, callback) {
    const mime = String(file.mimetype || '').toLowerCase();

    if (file.fieldname === 'screenshot' && mime.startsWith('image/')) {
        callback(null, true);
        return;
    }

    callback(new Error('Support screenshots must be image files.'));
}

const uploadSupportScreenshot = multer({
    storage,
    fileFilter,
    limits: {
        files: 1,
        fileSize: 8 * 1024 * 1024
    }
}).single('screenshot');

module.exports = {
    uploadSupportScreenshot
};
