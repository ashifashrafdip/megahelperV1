const path = require('path');
const fs = require('fs');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (e) {}

let mysql = null;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  // mysql2 optional if not installed in an environment
}

let neonModule = null;
try {
  neonModule = require('@neondatabase/serverless').neon;
} catch (e) {
  // neon optional
}

// 1. MySQL / MariaDB Config (Primary for cPanel hosting)
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'ashifash_mega',
  password: process.env.MYSQL_PASSWORD || 'MegaApp2026SecurePass',
  database: process.env.MYSQL_DATABASE || 'ashifash_mega',
  port: Number(process.env.MYSQL_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 5000
};

let mysqlPool = null;
let isMysqlTableInit = false;

function getMysqlPool() {
  if (!mysql) return null;
  if (!mysqlPool) {
    try {
      mysqlPool = mysql.createPool(MYSQL_CONFIG);
    } catch (e) {
      console.warn('MySQL pool create error:', e.message);
      mysqlPool = null;
    }
  }
  return mysqlPool;
}

async function initMysqlTable(pool) {
  if (isMysqlTableInit) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_profiles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      profile_name VARCHAR(150),
      phone_number VARCHAR(50) NOT NULL,
      phone_formatted VARCHAR(50),
      carrier VARCHAR(100),
      line_type VARCHAR(50),
      region VARCHAR(100),
      local_format VARCHAR(50),
      timezone VARCHAR(100),
      country VARCHAR(100),
      ip_address VARCHAR(100),
      location VARCHAR(150),
      fraud_score INT,
      trust_score INT,
      connection_type VARCHAR(100),
      threat_flags VARCHAR(200),
      dob VARCHAR(50),
      age INT,
      headline TEXT,
      post_bio TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  isMysqlTableInit = true;
}

// 2. Neon PostgreSQL Config
const getDbUrl = () => {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || '';
};

let isNeonTableInit = false;
async function initNeonTable(sql) {
  if (isNeonTableInit) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS saved_profiles (
        id SERIAL PRIMARY KEY,
        profile_name VARCHAR(150),
        phone_number VARCHAR(50) NOT NULL,
        phone_formatted VARCHAR(50),
        carrier VARCHAR(100),
        line_type VARCHAR(50),
        region VARCHAR(100),
        local_format VARCHAR(50),
        timezone VARCHAR(100),
        country VARCHAR(100),
        ip_address VARCHAR(100),
        location VARCHAR(150),
        fraud_score INT,
        trust_score INT,
        connection_type VARCHAR(100),
        threat_flags VARCHAR(200),
        dob VARCHAR(50),
        age INT,
        headline TEXT,
        post_bio TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    isNeonTableInit = true;
  } catch (err) {
    console.error('Error creating Neon table:', err.message);
  }
}

function getNeonSql() {
  const url = getDbUrl();
  if (url && neonModule) {
    try {
      return neonModule(url);
    } catch (e) {
      console.warn('Neon connection error:', e.message);
    }
  }
  return null;
}

// 3. Local JSON fallback
const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'data');
const LOCAL_STORAGE_FILE = path.join(LOCAL_STORAGE_DIR, 'saved_profiles.json');

const ensureLocalStorage = () => {
  try {
    if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
      fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOCAL_STORAGE_FILE)) {
      fs.writeFileSync(LOCAL_STORAGE_FILE, JSON.stringify([], null, 2), 'utf-8');
    }
  } catch (e) {
    console.error('Local storage init error:', e.message);
  }
};

// --- CRUD Operations ---

// 1. Fetch All Profiles
async function getAllProfiles() {
  // A. Try MySQL first (cPanel best database)
  const pool = getMysqlPool();
  if (pool) {
    try {
      await initMysqlTable(pool);
      const [rows] = await pool.query('SELECT * FROM saved_profiles ORDER BY id DESC');
      return { source: 'mysql', profiles: rows };
    } catch (err) {
      console.warn('MySQL getAllProfiles error, falling back to Neon/Local:', err.message);
    }
  }

  // B. Try Neon PostgreSQL
  const neonSql = getNeonSql();
  if (neonSql) {
    try {
      await initNeonTable(neonSql);
      const rows = await neonSql`SELECT * FROM saved_profiles ORDER BY created_at DESC;`;
      return { source: 'neon', profiles: rows };
    } catch (err) {
      console.warn('Neon query error, falling back to local:', err.message);
    }
  }

  // C. Fallback to Local JSON
  ensureLocalStorage();
  try {
    const data = fs.readFileSync(LOCAL_STORAGE_FILE, 'utf-8');
    const profiles = JSON.parse(data || '[]');
    return { source: 'local', profiles };
  } catch (e) {
    return { source: 'local', profiles: [] };
  }
}

// 2. Save a Profile
async function saveProfile(profile) {
  const profileName = (profile.profile_name || 'Verified Persona').trim();

  // A. Try MySQL
  const pool = getMysqlPool();
  if (pool) {
    try {
      await initMysqlTable(pool);
      const [result] = await pool.query(`
        INSERT INTO saved_profiles (
          profile_name, phone_number, phone_formatted, carrier, line_type, region,
          local_format, timezone, country, ip_address, location,
          fraud_score, trust_score, connection_type, threat_flags,
          dob, age, headline, post_bio
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        profileName,
        profile.phone_number || '',
        profile.phone_formatted || '',
        profile.carrier || 'Unknown',
        profile.line_type || 'MOBILE',
        profile.region || '',
        profile.local_format || '',
        profile.timezone || '',
        profile.country || 'United States',
        profile.ip_address || '',
        profile.location || '',
        parseInt(profile.fraud_score, 10) || 0,
        parseInt(profile.trust_score, 10) || 100,
        profile.connection_type || 'Standard',
        profile.threat_flags || '',
        profile.dob || '',
        parseInt(profile.age, 10) || 0,
        profile.headline || '',
        profile.post_bio || ''
      ]);

      const [newRow] = await pool.query('SELECT * FROM saved_profiles WHERE id = ?', [result.insertId]);
      return { success: true, source: 'mysql', profile: newRow[0] || { id: result.insertId, ...profile } };
    } catch (err) {
      console.warn('MySQL insert error, falling back:', err.message);
    }
  }

  // B. Try Neon PostgreSQL
  const neonSql = getNeonSql();
  if (neonSql) {
    try {
      await initNeonTable(neonSql);
      const rows = await neonSql`
        INSERT INTO saved_profiles (
          profile_name, phone_number, phone_formatted, carrier, line_type, region,
          local_format, timezone, country, ip_address, location,
          fraud_score, trust_score, connection_type, threat_flags,
          dob, age, headline, post_bio
        ) VALUES (
          ${profileName},
          ${profile.phone_number || ''},
          ${profile.phone_formatted || ''},
          ${profile.carrier || 'Unknown'},
          ${profile.line_type || 'MOBILE'},
          ${profile.region || ''},
          ${profile.local_format || ''},
          ${profile.timezone || ''},
          ${profile.country || 'United States'},
          ${profile.ip_address || ''},
          ${profile.location || ''},
          ${parseInt(profile.fraud_score, 10) || 0},
          ${parseInt(profile.trust_score, 10) || 100},
          ${profile.connection_type || 'Standard'},
          ${profile.threat_flags || ''},
          ${profile.dob || ''},
          ${parseInt(profile.age, 10) || 0},
          ${profile.headline || ''},
          ${profile.post_bio || ''}
        )
        RETURNING *;
      `;
      return { success: true, source: 'neon', profile: rows[0] };
    } catch (err) {
      console.warn('Neon insert error, using local fallback:', err.message);
    }
  }

  // C. Fallback Local JSON
  ensureLocalStorage();
  try {
    const data = fs.readFileSync(LOCAL_STORAGE_FILE, 'utf-8');
    const list = JSON.parse(data || '[]');
    const newRecord = {
      id: Date.now(),
      profile_name: profileName,
      ...profile,
      created_at: new Date().toISOString()
    };
    list.unshift(newRecord);
    fs.writeFileSync(LOCAL_STORAGE_FILE, JSON.stringify(list, null, 2), 'utf-8');
    return { success: true, source: 'local', profile: newRecord };
  } catch (err) {
    throw new Error('Failed to save locally: ' + err.message);
  }
}

// 3. Delete Profile
async function deleteProfile(id) {
  const pool = getMysqlPool();
  if (pool) {
    try {
      await initMysqlTable(pool);
      await pool.query('DELETE FROM saved_profiles WHERE id = ?', [parseInt(id, 10)]);
      return { success: true, source: 'mysql' };
    } catch (err) {
      console.warn('MySQL delete error:', err.message);
    }
  }

  const neonSql = getNeonSql();
  if (neonSql) {
    try {
      await initNeonTable(neonSql);
      await neonSql`DELETE FROM saved_profiles WHERE id = ${parseInt(id, 10)};`;
      return { success: true, source: 'neon' };
    } catch (err) {
      console.warn('Neon delete error:', err.message);
    }
  }

  ensureLocalStorage();
  try {
    const data = fs.readFileSync(LOCAL_STORAGE_FILE, 'utf-8');
    let list = JSON.parse(data || '[]');
    list = list.filter(item => String(item.id) !== String(id));
    fs.writeFileSync(LOCAL_STORAGE_FILE, JSON.stringify(list, null, 2), 'utf-8');
    return { success: true, source: 'local' };
  } catch (err) {
    throw new Error('Failed to delete locally: ' + err.message);
  }
}

module.exports = {
  getDbUrl,
  getAllProfiles,
  saveProfile,
  deleteProfile
};
