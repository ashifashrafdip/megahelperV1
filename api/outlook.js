const fs = require('fs');
const path = require('path');
const https = require('https');
const { requireAccess } = require('./access');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'outlook_config.json');

// In-memory token cache
let tokenCache = {
  access_token: '',
  expires_at: 0
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return data;
    }
  } catch (e) {
    console.error('Error reading outlook_config.json:', e);
  }
  return {
    client_id: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
    refresh_token: '',
    email: 'legendrobinsongews@outlook.com',
    password: ''
  };
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving outlook_config.json:', e);
  }
}

function parseRawCredentials(raw) {
  const parts = String(raw || '').split('|').map(s => s.trim()).filter(Boolean);
  let email = '';
  let password = '';
  let refresh_token = '';
  let client_id = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';

  if (parts.length >= 4) {
    email = parts[0];
    password = parts[1];
    refresh_token = parts[2];
    client_id = parts[3];
  } else if (parts.length === 3) {
    email = parts[0];
    password = parts[1];
    refresh_token = parts[2];
  } else if (parts.length === 2) {
    if (parts[0].length === 36 && parts[0].includes('-')) {
      client_id = parts[0];
      refresh_token = parts[1];
    } else {
      refresh_token = parts[0];
      client_id = parts[1];
    }
  } else if (parts.length === 1) {
    refresh_token = parts[0];
  }

  return { email, password, refresh_token, client_id };
}

function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function getAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.access_token && now < tokenCache.expires_at) {
    return tokenCache.access_token;
  }

  if (!config.refresh_token) {
    throw new Error('No refresh_token configured for Outlook OAuth.');
  }

  const postBody = new URLSearchParams({
    client_id: config.client_id || '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
    grant_type: 'refresh_token',
    refresh_token: config.refresh_token
  }).toString();

  const res = await httpsRequest({
    hostname: 'login.microsoftonline.com',
    path: '/common/oauth2/v2.0/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postBody)
    }
  }, postBody);

  if (res.status !== 200 || !res.data?.access_token) {
    const errMsg = res.data?.error_description || res.data?.error || `HTTP ${res.status}`;
    throw new Error(`Microsoft token exchange failed: ${errMsg}`);
  }

  const accessToken = res.data.access_token;
  tokenCache.access_token = accessToken;
  tokenCache.expires_at = now + (Number(res.data.expires_in) || 3600) - 60;

  if (res.data.refresh_token && res.data.refresh_token !== config.refresh_token) {
    config.refresh_token = res.data.refresh_token;
    saveConfig(config);
  }

  return accessToken;
}

function extractOtp(text) {
  if (!text) return null;
  // 1. Specific MegaPersonals pattern: PIN CODE: 1234
  const m1 = text.match(/PIN\s*CODE[:\s]*(\d{4,6})/i);
  if (m1) return m1[1];

  // 2. Any line with verify/pin/code/otp and 4-6 digits
  if (/verif|code|pin|otp|activation|confirm/i.test(text)) {
    const m2 = text.match(/\b(\d{4,6})\b/);
    if (m2) return m2[1];
  }
  return null;
}

function extractLinks(htmlContent, textContent = '') {
  const combined = `${htmlContent || ''} ${textContent || ''}`;
  const rawUrls = [];

  // Match href links
  const hrefRegex = /href=["'](https?:\/\/[^"'>\s]+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(combined)) !== null) {
    rawUrls.push(match[1]);
  }

  // Match plaintext URLs
  const plainRegex = /(https?:\/\/[^\s<>"'\)]+)/gi;
  while ((match = plainRegex.exec(combined)) !== null) {
    const cleaned = match[1].replace(/[.,;:!?'"]+$/, '');
    if (!rawUrls.includes(cleaned)) rawUrls.push(cleaned);
  }

  const ignoredKeywords = [
    'schema.org', 'w3.org', 'microsoft.com', 'office.com', 'google.com',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.css', '.js', 'unsubscribe',
    'privacy', 'terms', 'help', 'support.microsoft'
  ];

  const filtered = [];
  for (const u of rawUrls) {
    const low = u.toLowerCase();
    if (ignoredKeywords.some(ign => low.includes(ign))) continue;
    if (!filtered.includes(u)) filtered.push(u);
  }

  // Score verification links higher
  filtered.sort((a, b) => {
    const score = urlStr => {
      const low = urlStr.toLowerCase();
      let s = 0;
      for (const kw of ['activate', 'confirm', 'verify', 'verification', 'token', 'agesmart', 'megapersonals', 'pstmrk.it']) {
        if (low.includes(kw)) s += 10;
      }
      return s;
    };
    return score(b) - score(a);
  });

  return filtered;
}

module.exports = async function handler(req, res) {
  if (!requireAccess(req, res)) return;

  const config = loadConfig();

  // POST: Update configuration
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    if (body?.raw) {
      const parsed = parseRawCredentials(body.raw);
      if (parsed.refresh_token) config.refresh_token = parsed.refresh_token;
      if (parsed.email) config.email = parsed.email;
      if (parsed.password) config.password = parsed.password;
      if (parsed.client_id) config.client_id = parsed.client_id;
    } else {
      if (body?.refresh_token) config.refresh_token = body.refresh_token.trim();
      if (body?.email) config.email = body.email.trim();
      if (body?.password) config.password = body.password.trim();
      if (body?.client_id) config.client_id = body.client_id.trim();
    }

    saveConfig(config);
    return res.status(200).json({
      success: true,
      message: 'Outlook credentials updated successfully',
      email: config.email,
      has_refresh_token: !!config.refresh_token
    });
  }

  // GET: Fetch messages & extract OTP & Links
  try {
    const token = await getAccessToken(config);

    const query = '$top=10&$select=id,subject,sender,receivedDateTime,bodyPreview,body';

    const graphRes = await httpsRequest({
      hostname: 'graph.microsoft.com',
      path: `/v1.0/me/messages?${query}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (graphRes.status !== 200 || !graphRes.data?.value) {
      return res.status(graphRes.status || 500).json({
        success: false,
        message: graphRes.data?.error?.message || 'Failed to fetch Outlook messages'
      });
    }

    const messages = graphRes.data.value;
    let latestOtp = '';
    let latestLink = '';
    let allLinks = [];
    const processedMessages = [];

    for (const msg of messages) {
      const subject = msg.subject || 'No Subject';
      const sender = msg.sender?.emailAddress?.address || 'Unknown';
      const senderName = msg.sender?.emailAddress?.name || sender;
      const preview = msg.bodyPreview || '';
      const htmlBody = msg.body?.content || '';
      const receivedAt = msg.receivedDateTime || '';

      const fullText = `${subject} ${preview}`;
      const otp = extractOtp(fullText);
      const links = extractLinks(htmlBody, preview);

      if (!latestOtp && otp) latestOtp = otp;
      if (!latestLink && links.length > 0) latestLink = links[0];
      allLinks.push(...links);

      processedMessages.push({
        id: msg.id,
        subject,
        sender,
        senderName,
        receivedAt,
        preview,
        otp,
        links: links.slice(0, 5)
      });
    }

    allLinks = Array.from(new Set(allLinks));

    return res.status(200).json({
      success: true,
      email: config.email,
      latest_otp: latestOtp,
      latest_link: latestLink,
      all_links: allLinks,
      messages: processedMessages,
      timestamp: Date.now()
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
      email: config.email
    });
  }
};
