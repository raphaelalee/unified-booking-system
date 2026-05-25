const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const productUploadDir = path.join(__dirname, '..', 'public', 'uploads', 'products');
const publicProductUploadPath = '/uploads/products';

fs.mkdirSync(productUploadDir, { recursive: true });

function sanitizeExtension(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
}

const storage = multer.diskStorage({
    destination: productUploadDir,
    filename: (req, file, callback) => {
        const extension = sanitizeExtension(path.extname(file.originalname || '')) || '.jpg';
        const randomId = crypto.randomBytes(10).toString('hex');
        callback(null, `product-${Date.now()}-${randomId}${extension}`);
    }
});

function fileFilter(req, file, callback) {
    const mime = String(file.mimetype || '').toLowerCase();

    if (file.fieldname === 'productImage' && mime.startsWith('image/')) {
        callback(null, true);
        return;
    }

    callback(new Error('Product photo must be an image file.'));
}

const uploadProductImage = multer({
    storage,
    fileFilter,
    limits: {
        files: 1,
        fileSize: 8 * 1024 * 1024
    }
}).single('productImage');

function getProductImagePath(file) {
    return file ? `${publicProductUploadPath}/${file.filename}` : '';
}

function deleteProductImageFile(imagePath) {
    if (!String(imagePath || '').startsWith(`${publicProductUploadPath}/`)) {
        return;
    }

    const filename = path.basename(imagePath);
    const fullPath = path.join(productUploadDir, filename);

    fs.unlink(fullPath, (error) => {
        if (error && error.code !== 'ENOENT') return;
    });
}

module.exports = {
    uploadProductImage,
    getProductImagePath,
    deleteProductImageFile
};
