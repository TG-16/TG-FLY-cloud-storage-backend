const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { auth, generateToken, generateRefreshToken, JWT_SECRET } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { logEvent } = require('../services/logService');
const jwt = require('jsonwebtoken');

// POST /api/auth/signup
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Check duplicate
    const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (name, email, password_hash, plan_id) VALUES (?, ?, ?, 1)',
      [name, email, passwordHash]
    );

    const userId = result.insertId;
    const token = generateToken(userId);
    const refreshToken = generateRefreshToken(userId);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await logEvent(userId, 'signup', null, null, req.ip);

    const users = await query('SELECT id, email, name, avatar_url, role, plan_id, storage_used_mb, custom_storage_mb, is_active, created_at FROM users WHERE id = ?', [userId]);

    res.status(201).json({ token, user: users[0] });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Signup failed' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const users = await query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = users[0];

    if (!user.password_hash) {
      return res.status(401).json({ message: 'This account uses Google Sign-In' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.is_active) {
      return res.status(403).json({ message: 'Account has been suspended' });
    }

    const token = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await logEvent(user.id, 'login', null, null, req.ip);

    const { password_hash, google_id, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// GET /api/auth/google — redirect to Google OAuth
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL;
  const scope = encodeURIComponent('openid email profile');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
  res.redirect(url);
});

// GET /api/auth/google/callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }

    // Get user info
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userInfoRes.json();

    // Find or create user
    let users = await query('SELECT * FROM users WHERE google_id = ? OR email = ?', [userInfo.id, userInfo.email]);
    let userId;

    if (users.length === 0) {
      // Create new user
      const result = await query(
        'INSERT INTO users (name, email, avatar_url, google_id, plan_id) VALUES (?, ?, ?, ?, 1)',
        [userInfo.name, userInfo.email, userInfo.picture, userInfo.id]
      );
      userId = result.insertId;
      await logEvent(userId, 'signup', null, null, req.ip, { method: 'google' });
    } else {
      userId = users[0].id;
      // Update google_id if missing
      if (!users[0].google_id) {
        await query('UPDATE users SET google_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?',
          [userInfo.id, userInfo.picture, userId]);
      }
      await logEvent(userId, 'login', null, null, req.ip, { method: 'google' });
    }

    const token = generateToken(userId);
    const refreshToken = generateRefreshToken(userId);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?token=${token}`);
  } catch (err) {
    console.error('Google auth error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ message: 'No refresh token' });
    }

    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ message: 'Invalid token type' });
    }

    const token = generateToken(decoded.userId);
    res.json({ token });
  } catch {
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  const { password_hash, google_id, ...safeUser } = req.user;
  res.json({ user: safeUser });
});

// POST /api/auth/logout
router.post('/logout', auth, (req, res) => {
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
});

// POST /api/auth/change-password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!req.user.password_hash) {
      return res.status(400).json({ message: 'Google accounts cannot change password here' });
    }

    const valid = await bcrypt.compare(oldPassword, req.user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);

    await logEvent(req.user.id, 'password-change', null, null, req.ip);

    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

module.exports = router;
