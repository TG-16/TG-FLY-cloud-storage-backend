const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'tgfly_db',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function initDb() {
  const db = getPool();

  // Create tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS plans (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(50) NOT NULL,
      storage_mb INT NOT NULL,
      price_etb DECIMAL(10,2) NOT NULL DEFAULT 0,
      is_custom BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      avatar_url TEXT,
      google_id VARCHAR(255) UNIQUE,
      password_hash VARCHAR(255),
      plan_id INT DEFAULT 1,
      storage_used_mb DECIMAL(10,3) DEFAULT 0,
      custom_storage_mb INT,
      role ENUM('user','admin') DEFAULT 'user',
      is_active BOOLEAN DEFAULT TRUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS folders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      parent_id INT,
      name VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS files (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      folder_id INT,
      original_name VARCHAR(500) NOT NULL,
      s3_key VARCHAR(1000) NOT NULL,
      thumbnail_key VARCHAR(1000),
      mime_type VARCHAR(255),
      size_mb DECIMAL(10,3) NOT NULL,
      upload_status ENUM('pending','uploading','ready','failed') DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS upload_sessions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      file_id INT NOT NULL,
      s3_upload_id VARCHAR(500) NOT NULL,
      completed_parts JSON,
      total_parts INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      plan_id INT NOT NULL,
      custom_gb INT,
      amount_etb DECIMAL(10,2) NOT NULL,
      status ENUM('pending','confirmed','rejected') DEFAULT 'pending',
      bank_ref VARCHAR(255),
      confirmed_by INT,
      confirmed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS event_logs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT,
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(50),
      resource_id INT,
      ip_address VARCHAR(45),
      metadata JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS account_revocations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      reason TEXT,
      revoked_by INT NOT NULL,
      revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      restored_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (revoked_by) REFERENCES users(id)
    )
  `);

  // Seed default plans if empty
  const [plans] = await db.execute('SELECT COUNT(*) as count FROM plans');
  if (plans[0].count === 0) {
    await db.execute(`INSERT INTO plans (name, storage_mb, price_etb, is_custom) VALUES
      ('Free', 512, 0, FALSE),
      ('Starter', 5120, 25, FALSE),
      ('Basic', 10240, 45, FALSE),
      ('Standard', 20480, 80, FALSE),
      ('Pro', 51200, 175, FALSE),
      ('Custom', 0, 0, TRUE)
    `);
    console.log('📦 Default plans seeded');
  }
}

module.exports = { getPool, query, initDb };
