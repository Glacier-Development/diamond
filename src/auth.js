const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const settings = require('../config/settings.json');
const db = require('./database');

const JWT_SECRET = settings.auth.jwtSecret;
const SESSION_TIMEOUT = settings.auth.sessionTimeout;
const ADMIN_USERNAME = settings.auth.adminUsername;

/**
 * Generate JWT token for user
 */
function generateToken(user) {
  return jwt.sign(
    { 
      userId: user.id, 
      username: user.username,
      isAdmin: user.is_admin || user.username === ADMIN_USERNAME
    },
    JWT_SECRET,
    { expiresIn: SESSION_TIMEOUT }
  );
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Hash password
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

/**
 * Compare password with hash
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Auth middleware - protects routes requiring authentication
 */
function authMiddleware(req, res, next) {
  // Check if auth is enabled
  if (!settings.auth.enabled) {
    req.user = { username: 'guest', isAdmin: false };
    return next();
  }

  // Get token from cookies or Authorization header
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Verify token
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Attach user to request
  req.user = decoded;
  next();
}

/**
 * Admin middleware - protects admin-only routes
 */
function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Register a new user
 */
async function registerUser(username, email, password, ipAddress) {
  // Validate input
  if (!username || username.length < 3 || username.length > 30) {
    return { success: false, error: 'Username must be 3-30 characters' };
  }

  if (!email || !email.includes('@')) {
    return { success: false, error: 'Invalid email address' };
  }

  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  // Check rate limit
  const rateLimit = await db.checkRateLimit(ipAddress, 'register', 5, 3600000);
  if (!rateLimit.allowed) {
    return { success: false, error: 'Too many registration attempts. Please try again later.' };
  }

  // Check if user exists
  const existingUser = await db.getUserByUsername(username);
  if (existingUser) {
    return { success: false, error: 'Username already taken' };
  }

  const existingEmail = await db.getUserByEmail(email);
  if (existingEmail) {
    return { success: false, error: 'Email already registered' };
  }

  // Hash password and create user
  const passwordHash = await hashPassword(password);
  const result = await db.createUser(username, email, passwordHash);

  if (!result.success) {
    return { success: false, error: 'Failed to create user' };
  }

  // Auto-login after registration
  const token = generateToken(result.user);
  const expiresAt = new Date(Date.now() + SESSION_TIMEOUT);
  await db.createSession(result.user.id, token, expiresAt.toISOString(), ipAddress, '');
  await db.updateUserLastLogin(result.user.id);

  return {
    success: true,
    user: {
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      isAdmin: result.user.is_admin || result.user.username === ADMIN_USERNAME
    },
    token
  };
}

/**
 * Login user
 */
async function loginUser(username, password, ipAddress, userAgent) {
  // Check rate limit
  const rateLimit = await db.checkRateLimit(ipAddress, 'login', 10, 900000);
  if (!rateLimit.allowed) {
    return { success: false, error: 'Too many login attempts. Please try again later.' };
  }

  // Find user
  const user = await db.getUserByUsername(username);
  if (!user) {
    return { success: false, error: 'Invalid credentials' };
  }

  // Check if banned
  if (user.is_banned) {
    return { success: false, error: 'This account has been banned' };
  }

  // Verify password
  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    return { success: false, error: 'Invalid credentials' };
  }

  // Generate token
  const token = generateToken(user);
  const expiresAt = new Date(Date.now() + SESSION_TIMEOUT);

  // Delete old sessions and create new one
  await db.deleteAllUserSessions(user.id);
  await db.createSession(user.id, token, expiresAt.toISOString(), ipAddress, userAgent);
  await db.updateUserLastLogin(user.id);

  // Reset rate limit on successful login
  await db.resetRateLimit(ipAddress, 'login');

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.is_admin || user.username === ADMIN_USERNAME
    },
    token
  };
}

/**
 * Logout user
 */
async function logoutUser(token) {
  if (token) {
    await db.deleteSession(token);
  }
  return { success: true };
}

/**
 * Get current user from token
 */
async function getCurrentUser(token) {
  if (!token) return null;

  const session = await db.getSessionByToken(token);
  if (!session) return null;

  return {
    id: session.user_id,
    username: session.users.username,
    isAdmin: session.users.is_admin || session.users.username === ADMIN_USERNAME,
    isBanned: session.users.is_banned
  };
}

module.exports = {
  authMiddleware,
  adminMiddleware,
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword,
  registerUser,
  loginUser,
  logoutUser,
  getCurrentUser,
  ADMIN_USERNAME
};
