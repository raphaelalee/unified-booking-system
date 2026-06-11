const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const profileUploadDir = path.join(__dirname, '..', 'public', 'uploads', 'profiles');
const publicProfileUploadPath = '/uploads/profiles';

fs.mkdirSync(profileUploadDir, { recursive: true });

const allowedImageExtensions = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
};

const storage = multer.diskStorage({
    destination: profileUploadDir,
    filename: (req, file, callback) => {
        const extension = allowedImageExtensions[String(file.mimetype || '').toLowerCase()] || '.jpg';
        const randomId = crypto.randomBytes(10).toString('hex');
        callback(null, `profile-${Date.now()}-${randomId}${extension}`);
    }
});

function fileFilter(req, file, callback) {
    const mime = String(file.mimetype || '').toLowerCase();

    if (file.fieldname === 'profileImage' && allowedImageExtensions[mime]) {
        callback(null, true);
        return;
    }

    callback(new Error('Profile photo must be a JPG, PNG, WEBP, or GIF image.'));
}

const uploadProfileImage = multer({
    storage,
    fileFilter,
    limits: {
        files: 1,
        fileSize: 5 * 1024 * 1024
    }
}).single('profileImage');

function getProfileImagePath(file) {
    return file ? `${publicProfileUploadPath}/${file.filename}` : '';
}

function deleteProfileImageFile(imagePath) {
    if (!String(imagePath || '').startsWith(`${publicProfileUploadPath}/`)) {
        return;
    }

    const filename = path.basename(imagePath);
    const fullPath = path.join(profileUploadDir, filename);

    fs.unlink(fullPath, (error) => {
        if (error && error.code !== 'ENOENT') return;
    });
}

module.exports = {
    uploadProfileImage,
    getProfileImagePath,
    deleteProfileImageFile
};
