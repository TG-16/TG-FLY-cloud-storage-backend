require('dotenv').config();
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  endpoint: process.env.TELECLOUD_ENDPOINT,
  region: process.env.TELECLOUD_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.TELECLOUD_ACCESS_KEY,
    secretAccessKey: process.env.TELECLOUD_SECRET_KEY,
  },
  forcePathStyle: true,
});

async function test() {
  try {
    console.log("Testing connection...");
    const res = await s3Client.send(new ListObjectsV2Command({ Bucket: process.env.TELECLOUD_BUCKET }));
    console.log("Success! Found objects:", res.Contents ? res.Contents.length : 0);
  } catch (err) {
    console.error("Connection Error:", err);
  }
}

test();
