const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const reviewUploadDir = path.join(__dirname, '..', 'public', 'uploads', 'reviews');

fs.mkdirSync(reviewUploadDir, { recursive: true });

function sanitizeExtension(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
}

const storage = multer.diskStorage({
    destination: reviewUploadDir,
    filename: (req, file, callback) => {
        const extension = sanitizeExtension(path.extname(file.originalname || '')) || '';
        const randomId = crypto.randomBytes(10).toString('hex');
        callback(null, `review-${Date.now()}-${randomId}${extension}`);
    }
});

function fileFilter(req, file, callback) {
    const isImageField = file.fieldname === 'reviewImage';
    const isVideoField = file.fieldname === 'reviewVideo';
    const mime = String(file.mimetype || '').toLowerCase();

    if (isImageField && mime.startsWith('image/')) {
        callback(null, true);
        return;
    }

    if (isVideoField && mime.startsWith('video/')) {
        callback(null, true);
        return;
    }

    callback(new Error('Review uploads must be an image for the photo field or a video for the video field.'));
}

const uploadReviewMedia = multer({
    storage,
    fileFilter,
    limits: {
        files: 2,
        fileSize: 25 * 1024 * 1024
    }
}).fields([
    { name: 'reviewImage', maxCount: 1 },
    { name: 'reviewVideo', maxCount: 1 }
]);

module.exports = {
    uploadReviewMedia
};
