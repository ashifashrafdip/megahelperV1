const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const fs = require('fs');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Import API Handlers
const scamalyticsHandler = require('./api/scamalytics');
const verifyHandler = require('./api/verify');
const geminiHandler = require('./api/gemini');
const profilesHandler = require('./api/profiles');
const authHandler = require('./api/auth');

// Helper to mock Vercel req/res for standard Node http
function adaptHandler(handler) {
  return async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    req.query = parsedUrl.query;

    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return res;
    };

    // Parse body for POST / DELETE
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          req.body = body ? JSON.parse(body) : {};
        } catch (e) {
          req.body = body;
        }
        await handler(req, res);
      });
    } else {
      await handler(req, res);
    }
  };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;

  // 1. API Endpoints
  if (pathname === '/api/auth') {
    return adaptHandler(authHandler)(req, res);
  }
  if (pathname === '/api/scamalytics') {
    return adaptHandler(scamalyticsHandler)(req, res);
  }
  if (pathname === '/api/verify') {
    return adaptHandler(verifyHandler)(req, res);
  }
  if (pathname === '/api/gemini') {
    return adaptHandler(geminiHandler)(req, res);
  }
  if (pathname === '/api/profiles') {
    return adaptHandler(profilesHandler)(req, res);
  }


  // 2. Serve Static Files (only whitelisted public assets; never .env, api source, data, etc.)
  const PUBLIC_FILES = ['index.html', 'icon.svg', 'manifest.json', 'sw.js', 'app_icon.ico'];
  const requested = decodeURIComponent(pathname || '/').replace(/^\/+/, '');
  let filePath = path.join(__dirname, PUBLIC_FILES.includes(requested) ? requested : 'index.html');

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading ' + filePath);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content, 'utf-8');
  });
});

server.listen(PORT, () => {
  console.log('='.repeat(65));
  console.log(`📱 USA Phone Validator Web App running at:`);
  console.log(`👉 Local:     http://localhost:${PORT}`);
  console.log(`⚡ Database:  ${process.env.MYSQL_DATABASE ? 'cPanel MariaDB/MySQL (' + process.env.MYSQL_DATABASE + ')' : (process.env.DATABASE_URL ? 'Neon Postgres' : 'Local File Fallback')}`);
  console.log('='.repeat(65));
});
