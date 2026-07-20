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

    if (['screenshot', 'screenshots', 'evidence'].includes(file.fieldname) && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) {
        callback(null, true);
        return;
    }

    callback(new Error('Support evidence must be JPG, PNG, WebP, or GIF images.'));
}

const uploadSupportScreenshot = multer({
    storage,
    fileFilter,
    limits: {
        files: 5,
        fileSize: 8 * 1024 * 1024
    }
}).fields([
    { name: 'screenshot', maxCount: 5 },
    { name: 'screenshots', maxCount: 5 },
    { name: 'evidence', maxCount: 5 }
]);

module.exports = {
    uploadSupportScreenshot
};
