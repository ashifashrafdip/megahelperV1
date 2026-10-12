// Scamalytics Official v3 API Endpoint with Automatic Fallback
const { requireAccess } = require('./access');

const SCAMALYTICS_USER = process.env.SCAMALYTICS_USER || 'bashundharaonlineshop';
const SCAMALYTICS_KEY = process.env.SCAMALYTICS_KEY || '1b7858bbcca4900c4e687c78e8d67c6dd78249a5f136aa21d349064850259a00';

module.exports = async function handler(req, res) {
  if (!requireAccess(req, res)) return;

  const ip = req.query?.ip || '104.28.194.5';

  try {
    let score = 0;
    let risk = 'Low Risk';
    let isp = 'N/A';
    let org = 'N/A';
    let asn = 'N/A';
    let country_name = 'United States';
    let country_code = 'US';
    let state = '';
    let city = '';
    let zip_code = '';
    let ip_timezone = '';
    let conn_type = 'Residential';
    let is_vpn = false;
    let is_tor = false;
    let is_proxy = false;
    let is_datacenter = false;
    let creditsRemaining = null;

    // 1. Primary: Official Scamalytics v3 API
    let apiSuccess = false;
    try {
      const apiUrl = `https://api11.scamalytics.com/v3/${encodeURIComponent(SCAMALYTICS_USER)}/?key=${encodeURIComponent(SCAMALYTICS_KEY)}&ip=${encodeURIComponent(ip)}`;
      const sResp = await fetch(apiUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });

      if (sResp.ok) {
        const data = await sResp.json();
        const scam = data?.scamalytics;
        const ext = data?.external_datasources;

        if (scam && scam.status === 'ok') {
          apiSuccess = true;
          score = Number(scam.scamalytics_score) || 0;
          const rawRisk = String(scam.scamalytics_risk || 'low').toLowerCase();
          risk = rawRisk.charAt(0).toUpperCase() + rawRisk.slice(1) + ' Risk';
          isp = scam.scamalytics_isp || isp;
          org = scam.scamalytics_org || org;

          const pInfo = scam.scamalytics_proxy || {};
          is_datacenter = !!pInfo.is_datacenter;
          is_vpn = !!pInfo.is_vpn;
          const isResProxy = !!pInfo.is_resproxy;

          // External sources details
          const dbip = ext?.dbip || {};
          const ipinfo = ext?.ipinfo || {};
          const maxmind = ext?.maxmind_geolite2 || {};
          const x4bnet = ext?.x4bnet || {};
          const firehol = ext?.firehol || {};
          const ip2proxy = ext?.ip2proxy || {};

          country_name = dbip.ip_country_name || maxmind.ip_country_name || country_name;
          country_code = dbip.ip_country_code || maxmind.ip_country_code || 'US';
          state = dbip.ip_state_name || maxmind.ip_state_name || '';
          city = dbip.ip_city || maxmind.ip_city || '';
          zip_code = dbip.ip_postcode || maxmind.ip_postcode || '';
          ip_timezone = maxmind.ip_time_zone || '';
          asn = ipinfo.asn || maxmind.asn || '';

          if (x4bnet.is_tor) is_tor = true;
          if (x4bnet.is_vpn) is_vpn = true;
          if (x4bnet.is_datacenter) is_datacenter = true;

          is_proxy = !!firehol.is_proxy || isResProxy || is_datacenter || is_vpn || is_tor || !!ip2proxy.proxy_type;

          if (is_datacenter) conn_type = 'Datacenter';
          else if (isResProxy) conn_type = 'Residential Proxy';
          else if (dbip.connection_type) conn_type = dbip.connection_type;
          else conn_type = 'Residential';

          if (scam.credits?.remaining !== undefined) {
            creditsRemaining = scam.credits.remaining;
          }
        }
      }
    } catch (err) {
      console.warn('Scamalytics API v3 call failed, falling back:', err.message);
    }

    // 2. Fallback if API was unavailable: HTML Scraping + IP-API
    if (!apiSuccess) {
      try {
        const scamUrl = `https://scamalytics.com/ip/${ip}`;
        const sResp = await fetch(scamUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          signal: AbortSignal.timeout(5000)
        });
        if (sResp.ok) {
          const html = await sResp.text();
          const scoreM = html.match(/Fraud Score:\s*(\d+)/i) || html.match(/score">(\d+)<\/span>/i);
          if (scoreM) score = parseInt(scoreM[1], 10);
          risk = score < 25 ? 'Low Risk' : (score < 75 ? 'Medium Risk' : 'High Risk');

          const getField = (label) => {
            const m = new RegExp(`<th>${label}<\/th>\\s*<td>(?:<a[^>]*>)?([^<]+)`, 'i').exec(html);
            return m ? m[1].trim() : '';
          };
          const getFlag = (label) => {
            const m = new RegExp(`<th>${label}<\/th>\\s*<td>\\s*<div class="risk[^"]*">([^<]*)<\/div>`, 'i').exec(html);
            return m ? m[1].trim().toLowerCase() === 'yes' : false;
          };

          isp = getField('ISP Name') || getField('Organization Name') || isp;
          country_name = getField('Country Name') || country_name;
          country_code = getField('Country Code') || country_code;
          state = getField('State / Province') || state;
          city = getField('City') || city;
          conn_type = getField('Connection type') || conn_type;

          is_vpn = getFlag('VPN');
          is_tor = getFlag('Tor Exit Node');
          is_datacenter = getFlag('Datacenter');
          is_proxy = getFlag('Public Proxy') || getFlag('Web Proxy') || is_datacenter;
        }
      } catch (e) {}

      // Backup IP-API geo details
      try {
        const geoResp = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,zip,timezone,isp,org,as`, {
          signal: AbortSignal.timeout(4000)
        });
        if (geoResp.ok) {
          const geo = await geoResp.json();
          if (geo.status === 'success') {
            if (!city) city = geo.city || '';
            if (!state) state = geo.regionName || '';
            if (!country_code) country_code = geo.countryCode || 'US';
            zip_code = geo.zip || '';
            ip_timezone = geo.timezone || '';
            asn = geo.as || '';
            org = geo.org || '';
            if (isp === 'N/A' || !isp) isp = geo.isp || 'N/A';
          }
        }
      } catch (e) {}
    }

    return res.status(200).json({
      success: true,
      ip,
      fraud_score: score,
      trust_score: Math.max(0, 100 - score),
      risk_level: risk,
      isp,
      org,
      asn,
      country: country_name,
      country_code,
      region: state,
      city,
      zip: zip_code,
      timezone: ip_timezone,
      connection_type: conn_type,
      proxy: is_proxy,
      vpn: is_vpn,
      tor: is_tor,
      datacenter: is_datacenter,
      credits_remaining: creditsRemaining
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
