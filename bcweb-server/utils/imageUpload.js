/*
=======================================================================================================================================
Module: utils/imageUpload.js
=======================================================================================================================================
Purpose: The multer config shared by the product image upload routes (product-image = the main image, product-images-add = gallery), so
         the accepted formats and size cap can't drift apart. In-memory (the buffer goes straight to sharp — nothing hits disk).

         25MB cap (15MB until 2026-10-13): images are now stored up to 2048 px, so full-size camera / supplier originals are expected.
         runUpload(req, res, field, maxCount) runs multer ourselves so its errors become our JSON envelope (never a raw 4xx) — it resolves
         to a { return_code, message } error object, or null when the upload parsed cleanly.
=======================================================================================================================================
*/

const multer = require('multer');

const MAX_MB = 25;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    const e = new Error('Unsupported image type — use JPEG, PNG, WebP or AVIF');
    e.code = 'UNSUPPORTED_TYPE';
    cb(e);
  }
});

// maxCount 1 -> req.file (single); > 1 -> req.files (array).
function runUpload(req, res, field, maxCount = 1) {
  const handler = maxCount === 1 ? upload.single(field) : upload.array(field, maxCount);
  return new Promise((resolve) => {
    handler(req, res, (err) => {
      if (!err) return resolve(null);
      if (err.code === 'LIMIT_FILE_SIZE') return resolve({ return_code: 'IMAGE_TOO_LARGE', message: `Image exceeds the ${MAX_MB}MB limit` });
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return resolve({ return_code: 'TOO_MANY_FILES', message: `Up to ${maxCount} images at a time` });
      return resolve({ return_code: 'INVALID_IMAGE', message: err.message || 'Invalid image upload' });
    });
  });
}

module.exports = { runUpload, MAX_MB };
