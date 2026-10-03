require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { globalLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const downloadRoutes = require('./routes/download');
const fileRoutes = require('./routes/files');
const folderRoutes = require('./routes/folders');
const planRoutes = require('./routes/plans');
const dashboardRoutes = require('./routes/dashboard');
const adminUserRoutes = require('./routes/admin/users');
const adminPaymentRoutes = require('./routes/admin/payments');
const adminLogRoutes = require('./routes/admin/logs');
const adminDashboardRoutes = require('./routes/admin/dashboard');
const { initDb } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use(globalLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/payments', adminPaymentRoutes);
app.use('/api/admin/logs', adminLogRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'TG-Fly API', version: '1.0.0' });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
  });
});

// Start
async function start() {
  try {
    await initDb();
    console.log('✅ Database initialized');

    app.listen(PORT, () => {
      console.log(`✈️  TG-Fly API running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

start();
