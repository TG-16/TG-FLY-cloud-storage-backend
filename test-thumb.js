require('dotenv').config({ path: 'e:/Work/TG-FLY/backend/.env' });
const { query } = require('./src/config/db');
const { generateThumbnail } = require('./src/services/thumbnailService');

async function test() {
  try {
    // Get the most recent file uploaded
    const files = await query('SELECT * FROM files ORDER BY id DESC LIMIT 1');
    if (files.length === 0) {
      console.log('No files found to test thumbnail generation.');
      return;
    }
    
    const file = files[0];
    console.log(`Testing thumbnail for file ${file.id}: ${file.original_name} (${file.mime_type})`);
    
    await generateThumbnail(file.id, file.s3_key, file.mime_type);
    console.log('Test script finished.');
  } catch (err) {
    console.error('Test script error:', err);
  } finally {
    process.exit(0);
  }
}

test();
