const { createClient } = require('@supabase/supabase-js');
const settings = require('../config/settings.json');

// Initialize Supabase client with WebSocket support for Node.js 20
const supabaseUrl = settings.database.supabaseUrl;
const supabaseKey = settings.database.supabaseKey;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase credentials not configured in settings.json');
}

// Properly pass WebSocket constructor to Supabase
const WebSocket = require('ws');
const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    transport: WebSocket
  }
});

/**
 * Database schema initialization
 * Creates required tables if they don't exist
 */
async function initializeDatabase() {
  try {
    // Note: Table creation requires admin privileges
    // This function documents the expected schema
    
    console.log('[DB] Expected schema:');
    console.log(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_login TIMESTAMP WITH TIME ZONE,
        is_admin BOOLEAN DEFAULT FALSE,
        is_banned BOOLEAN DEFAULT FALSE
      );

      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        ip_address INET,
        user_agent TEXT
      );

      -- MOTD table
      CREATE TABLE IF NOT EXISTS motd (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        message TEXT NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Server events log
      CREATE TABLE IF NOT EXISTS server_events (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        event_type TEXT NOT NULL,
        message TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Rate limiting / spam protection
      CREATE TABLE IF NOT EXISTS rate_limits (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        identifier TEXT NOT NULL,
        action_type TEXT NOT NULL,
        count INTEGER DEFAULT 1,
        last_attempt TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(identifier, action_type)
      );
    `);
    
    return true;
  } catch (error) {
    console.error('[DB] Initialization error:', error.message);
    return false;
  }
}

/**
 * User authentication functions
 */
async function createUser(username, email, passwordHash) {
  try {
    const { data, error } = await supabase
      .from('users')
      .insert([{ username, email, password_hash: passwordHash }])
      .select()
      .single();
    
    if (error) throw error;
    return { success: true, user: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getUserByUsername(username) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('[DB] Get user error:', error.message);
    return null;
  }
}

async function getUserByEmail(email) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('[DB] Get user by email error:', error.message);
    return null;
  }
}

async function updateUserLastLogin(userId) {
  try {
    const { error } = await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', userId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Update last login error:', error.message);
    return false;
  }
}

/**
 * Session management
 */
async function createSession(userId, token, expiresAt, ipAddress, userAgent) {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .insert([{
        user_id: userId,
        token,
        expires_at: expiresAt,
        ip_address: ipAddress,
        user_agent: userAgent
      }])
      .select()
      .single();
    
    if (error) throw error;
    return { success: true, session: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getSessionByToken(token) {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*, users(username, is_admin, is_banned)')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('[DB] Get session error:', error.message);
    return null;
  }
}

async function deleteSession(token) {
  try {
    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('token', token);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Delete session error:', error.message);
    return false;
  }
}

async function deleteAllUserSessions(userId) {
  try {
    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('user_id', userId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Delete all sessions error:', error.message);
    return false;
  }
}

/**
 * MOTD Management
 */
async function getMotd() {
  try {
    const { data, error } = await supabase
      .from('motd')
      .select('*')
      .eq('enabled', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('[DB] Get MOTD error:', error.message);
    return null;
  }
}

async function setMotd(message, createdBy, enabled = true) {
  try {
    // First disable all existing MOTDs
    await supabase.from('motd').update({ enabled: false }).eq('enabled', true);
    
    const { data, error } = await supabase
      .from('motd')
      .insert([{ message, created_by: createdBy, enabled }])
      .select()
      .single();
    
    if (error) throw error;
    return { success: true, motd: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Server Events Logging
 */
async function logServerEvent(eventType, message, createdBy = null) {
  try {
    const { data, error } = await supabase
      .from('server_events')
      .insert([{ event_type: eventType, message, created_by: createdBy }])
      .select()
      .single();
    
    if (error) throw error;
    return { success: true, event: data };
  } catch (error) {
    console.error('[DB] Log event error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Rate Limiting / Anti-Spam
 */
async function checkRateLimit(identifier, actionType, maxAttempts, windowMs) {
  try {
    const windowStart = new Date(Date.now() - windowMs).toISOString();
    
    const { data, error } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('identifier', identifier)
      .eq('action_type', actionType)
      .gte('last_attempt', windowStart)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    if (!data) {
      // No record found, create one
      const { error: insertError } = await supabase
        .from('rate_limits')
        .insert([{ identifier, action_type: actionType, count: 1 }]);
      
      if (insertError) throw insertError;
      return { allowed: true, remaining: maxAttempts - 1 };
    }
    
    if (data.count >= maxAttempts) {
      return { allowed: false, remaining: 0, resetAt: data.last_attempt };
    }
    
    // Increment counter
    const { error: updateError } = await supabase
      .from('rate_limits')
      .update({ count: data.count + 1, last_attempt: new Date().toISOString() })
      .eq('id', data.id);
    
    if (updateError) throw updateError;
    
    return { allowed: true, remaining: maxAttempts - data.count - 1 };
  } catch (error) {
    console.error('[DB] Rate limit check error:', error.message);
    return { allowed: true, remaining: maxAttempts }; // Fail open
  }
}

async function resetRateLimit(identifier, actionType) {
  try {
    const { error } = await supabase
      .from('rate_limits')
      .delete()
      .eq('identifier', identifier)
      .eq('action_type', actionType);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Reset rate limit error:', error.message);
    return false;
  }
}

module.exports = {
  supabase,
  initializeDatabase,
  createUser,
  getUserByUsername,
  getUserByEmail,
  updateUserLastLogin,
  createSession,
  getSessionByToken,
  deleteSession,
  deleteAllUserSessions,
  getMotd,
  setMotd,
  logServerEvent,
  checkRateLimit,
  resetRateLimit
};
