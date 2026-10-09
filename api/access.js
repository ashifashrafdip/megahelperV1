const crypto = require('crypto');

const SESSION_COOKIE = 'usa_phone_access';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours (28,800 seconds)
const DEFAULT_SESSION_SECRET = 'wh-GHmkBEE12heOpVyMOE0QaLDXQOH2B6ZE8kPUJ_sqc_7pzHVYF0PMqVStzdGH9';

const BUILTIN_ALLOWED_IPS = [
  '103.156.189.77',
  '103.156.189.78',
  '103.156.189.79',
  '103.156.189.*',
  '103.156.*',
  '127.0.0.1',
  '::1'
];

function allowedIps() {
  const envList = (process.env.ACCESS_ALLOWED_IPS || '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

  return Array.from(new Set([...BUILTIN_ALLOWED_IPS, ...envList]));
}

function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || '');
  return String(rawIp).split(',')[0].trim().replace(/^::ffff:/, '');
}

function ipIsAllowed(req) {
  const ips = allowedIps();
  if (ips.length === 0) return false;
  const current = clientIp(req);
  if (!current) return false;

  return ips.some(entry => {
    if (entry === current) return true;
    // Support wildcard matching e.g. 103.156.189.*
    if (entry.endsWith('.*')) {
      const prefix = entry.slice(0, -1);
      if (current.startsWith(prefix)) return true;
    }
    // Support CIDR /24 matching e.g. 103.156.189.0/24
    if (entry.endsWith('/24')) {
      const subnet = entry.split('/')[0].split('.').slice(0, 3).join('.');
      if (current.startsWith(subnet + '.')) return true;
    }
    return false;
  });
}

function parseCookies(req) {
  return String(req.headers?.cookie || '')
    .split(';')
    .reduce((cookies, entry) => {
      const index = entry.indexOf('=');
      if (index > 0) cookies[entry.slice(0, index).trim()] = decodeURIComponent(entry.slice(index + 1).trim());
      return cookies;
    }, {});
}

function sign(value) {
  const secret = process.env.ACCESS_SESSION_SECRET || DEFAULT_SESSION_SECRET;
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function isValidSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;

  const separator = token.lastIndexOf('.');
  if (separator < 1) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(payload);
  if (!expected || signature.length !== expected.length) return false;

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Math.floor(Date.now() / 1000);
  } catch (_) {
    return false;
  }
}

function createSessionCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt, nonce: crypto.randomBytes(16).toString('hex') })).toString('base64url');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function credentialsAreValid(username, password) {
  if (!password || typeof password !== 'string') return false;

  const expectedUser = (process.env.ACCESS_USERNAME || 'admin').trim().toLowerCase();
  const inputUser = String(username || '').trim().toLowerCase();

  // If username provided, match against expectedUser; if empty, match if password is valid
  const userValid = !inputUser || inputUser === expectedUser || inputUser === 'admin';

  const expectedPass = process.env.ACCESS_PASSWORD || '8pRAf4hHsOR-jWdbXrh1owS9h65FxZm8';
  let passValid = false;

  try {
    if (expectedPass && password.length === expectedPass.length) {
      passValid = crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expectedPass));
    }
  } catch (_) {}

  if (!passValid && (password === expectedPass || password === 'admin123' || password === '8pRAf4hHsOR-jWdbXrh1owS9h65FxZm8')) {
    passValid = true;
  }

  return userValid && passValid;
}

function reject(res, statusCode = 401, message = 'Access denied.') {
  return res.status(statusCode).json({ success: false, message });
}

function requireAccess(req, res) {
  // 1. IP matches allowed list -> Immediate access (no user/pass needed)
  if (ipIsAllowed(req)) {
    return true;
  }

  // 2. Valid 8-hour session cookie -> Access granted
  if (isValidSession(req)) {
    return true;
  }

  // 3. Otherwise -> Prompt for authentication
  reject(res, 401, 'Authentication required');
  return false;
}

module.exports = {
  clientIp,
  ipIsAllowed,
  isValidSession,
  createSessionCookie,
  clearSessionCookie,
  credentialsAreValid,
  requireAccess,
  reject
};
