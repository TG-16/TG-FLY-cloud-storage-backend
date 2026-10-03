const rateLimit = require('express-rate-limit');

// Global: 100 requests per 15 minutes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limit for upload chunk endpoints (they have their own)
    return req.path.startsWith('/api/upload/presign');
  },
});

// Upload chunks: 2000 requests per 15 minutes
const uploadChunkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { message: 'Upload rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth: 10 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { globalLimiter, uploadChunkLimiter, authLimiter };
