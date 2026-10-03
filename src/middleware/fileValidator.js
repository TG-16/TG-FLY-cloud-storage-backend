const path = require('path');

// Allowed file extensions
const ALLOWED_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff',
  // Videos
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv',
  // Audio
  '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a', '.wma',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.rtf', '.odt', '.ods', '.odp',
  // Archives
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
  // Code
  '.json', '.xml', '.html', '.css', '.js', '.py', '.java', '.c', '.cpp',
  // Other
  '.apk', '.iso',
]);

// Blocked MIME types (dangerous)
const BLOCKED_MIMES = new Set([
  'application/x-executable',
  'application/x-msdos-program',
  'application/x-msdownload',
  'application/x-sh',
  'application/x-shellscript',
]);

function validateFile(fileName, mimeType, fileSize, maxSizeMb) {
  const errors = [];

  // Check extension
  const ext = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    errors.push(`File type "${ext}" is not allowed`);
  }

  // Check MIME
  if (BLOCKED_MIMES.has(mimeType)) {
    errors.push('This file type is blocked for security');
  }

  // Check size
  const fileSizeMb = fileSize / (1024 * 1024);
  if (fileSizeMb > maxSizeMb) {
    errors.push(`File exceeds your storage limit (${maxSizeMb} MB remaining)`);
  }

  // Sanitize filename (prevent path traversal)
  const sanitized = fileName
    .replace(/[^a-zA-Z0-9._\-\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 200);

  return {
    valid: errors.length === 0,
    errors,
    sanitizedName: sanitized || `file${ext}`,
  };
}

module.exports = { validateFile, ALLOWED_EXTENSIONS };
