const { S3Client } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  endpoint: process.env.TELECLOUD_ENDPOINT,
  region: process.env.TELECLOUD_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.TELECLOUD_ACCESS_KEY,
    secretAccessKey: process.env.TELECLOUD_SECRET_KEY,
  },
  forcePathStyle: true, // Required for S3-compatible services
});

const BUCKET = process.env.TELECLOUD_BUCKET || 'tg-fly-prod';

module.exports = { s3Client, BUCKET };
