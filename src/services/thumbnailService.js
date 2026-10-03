const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, BUCKET } = require('../config/s3');
const { query } = require('../config/db');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegStatic);

async function generateThumbnail(fileId, s3Key, mimeType) {
  try {
    const isImage = mimeType.startsWith('image/');
    const isVideo = mimeType.startsWith('video/');

    if (!isImage && !isVideo) return; // Only process images and videos

    console.log(`[Thumbnail] Generating thumbnail for file ${fileId} (${mimeType})`);

    const thumbKey = `thumbnails/${fileId}_thumb.jpg`;
    let thumbBuffer;

    if (isImage) {
      // Stream from S3
      const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
      const { Body } = await s3Client.send(getCommand);
      
      const chunks = [];
      for await (const chunk of Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      
      thumbBuffer = await sharp(buffer)
        .resize(320, 320, { fit: 'cover' })
        .blur(10)
        .jpeg({ quality: 60 })
        .toBuffer();
    } else if (isVideo) {
      // Presigned URL for ffmpeg to read directly
      const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
      const url = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
      
      const tempPath = path.join(os.tmpdir(), `${fileId}_thumb.jpg`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(url)
          .seekInput(1) // Seek to 1 second
          .frames(1)
          .size('320x320')
          .output(tempPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      
      // Read the generated frame and blur it
      const frameBuffer = fs.readFileSync(tempPath);
      thumbBuffer = await sharp(frameBuffer)
        .blur(10)
        .jpeg({ quality: 60 })
        .toBuffer();
        
      fs.unlinkSync(tempPath);
    }

    if (thumbBuffer) {
      // Upload thumbnail to S3
      await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: thumbKey,
        Body: thumbBuffer,
        ContentType: 'image/jpeg',
      }));

      // Update DB
      await query('UPDATE files SET thumbnail_key = ? WHERE id = ?', [thumbKey, fileId]);
      console.log(`[Thumbnail] Successfully generated for file ${fileId}`);
    }
  } catch (err) {
    console.error(`[Thumbnail] Error generating thumbnail for file ${fileId}:`, err.message);
  }
}

module.exports = { generateThumbnail };
