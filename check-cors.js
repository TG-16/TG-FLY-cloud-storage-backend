require('dotenv').config({ path: 'e:/Work/TG-FLY/backend/.env' });
const { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  endpoint: process.env.TELECLOUD_ENDPOINT,
  region: process.env.TELECLOUD_REGION,
  credentials: {
    accessKeyId: process.env.TELECLOUD_ACCESS_KEY,
    secretAccessKey: process.env.TELECLOUD_SECRET_KEY,
  },
  forcePathStyle: true,
});

async function checkCors() {
  try {
    const cors = await s3Client.send(new GetBucketCorsCommand({
      Bucket: process.env.TELECLOUD_BUCKET
    }));
    console.log('✅ Current CORS Policy:', JSON.stringify(cors.CORSRules, null, 2));
  } catch (err) {
    if (err.name === 'NoSuchCORSConfiguration' || err.name === 'NoSuchCORSConfigurationException' || (err.message && err.message.includes('CORS'))) {
      console.log('❌ No CORS configuration found. Let\'s create one!');
      await setCors();
    } else {
      console.error('❌ Error checking CORS:', err);
    }
  }
}

async function setCors() {
  try {
    await s3Client.send(new PutBucketCorsCommand({
      Bucket: process.env.TELECLOUD_BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            AllowedOrigins: ["*"], // For development
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3000
          }
        ]
      }
    }));
    console.log('✅ CORS Policy successfully set!');
  } catch (err) {
    console.error('❌ Failed to set CORS:', err);
  }
}

checkCors();
