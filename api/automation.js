const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { requireAccess } = require('./access');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'automation_state.json');
const TASK_FILE = path.join(DATA_DIR, 'automation_task.json');
const CAPTCHA_FILE = path.join(DATA_DIR, 'captcha_solution.json');

let activeWorkerProcess = null;

function readJsonSafe(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
  }
  return fallback;
}

function writeJsonSafe(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`Error writing ${filePath}:`, e.message);
  }
}

module.exports = async function handler(req, res) {
  if (!requireAccess(req, res)) return;

  const urlPath = req.url || '';
  const action = req.query?.action || (urlPath.includes('/start') ? 'start' : (urlPath.includes('/stop') ? 'stop' : (urlPath.includes('/captcha') ? 'captcha' : (urlPath.includes('/profile') ? 'profile' : 'status'))));

  // 1. GET / POST Profile (Allows reading or saving the profile anytime)
  if (action === 'profile') {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
      }
      const existing = readJsonSafe(TASK_FILE, {});
      const merged = { ...existing, ...(body || {}) };
      writeJsonSafe(TASK_FILE, merged);
      return res.status(200).json({ success: true, message: 'Profile updated', profile: merged });
    }

    const task = readJsonSafe(TASK_FILE, {
      phone: '2142513525',
      city: 'Dallas',
      age: 26,
      headline: "Coffee first, then let's see where the night goes.",
      body: "Looking for someone with great banter, positive energy, and zero drama. If you're ready to skip the endless small talk and make an actual plan, say hi.",
      email: 'legendrobinsongews@outlook.com',
      cdp_port: 51793
    });
    return res.status(200).json({ success: true, profile: task });
  }

  // 2. POST Captcha Solution
  if (action === 'captcha' && req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }
    const code = String(body?.code || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ success: false, message: 'Captcha code is required' });
    }
    writeJsonSafe(CAPTCHA_FILE, { code, timestamp: Date.now() });
    return res.status(200).json({ success: true, message: `Captcha solution submitted: ${code}` });
  }

  // 3. POST Start Automation
  if (action === 'start' && req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    // Save task configuration
    const taskCfg = {
      phone: body?.phone || '2142513525',
      city: body?.city || 'Dallas',
      age: Number(body?.age) || 26,
      headline: body?.headline || "Coffee first, then let's see where the night goes.",
      body: body?.body || "Always up for an adventurous road trip. Let's make a real plan.",
      email: body?.email || 'legendrobinsongews@outlook.com',
      password: body?.password || 'Xbwbivcgya52300@',
      cdp_port: Number(body?.cdp_port) || 51793,
      image_path: body?.image_path || path.join(DATA_DIR, 'default_post_image.jpg'),
      reg_captcha: body?.reg_captcha || '',
      post_captcha: body?.post_captcha || '',
      updated_at: Date.now()
    };
    writeJsonSafe(TASK_FILE, taskCfg);

    // Reset state
    const initialState = {
      running: true,
      completed: false,
      step: 'starting',
      progress_percent: 5,
      browser_connected: false,
      current_url: '',
      agesmart_url: '',
      logs: [`[${new Date().toLocaleTimeString()}] Spawning MegaPersonals autonomous worker...`],
      last_log: 'Worker spawned',
      captcha_needed: false,
      error: null,
      started_at: Date.now(),
      last_updated: Date.now()
    };
    writeJsonSafe(STATE_FILE, initialState);

    // Kill existing process if running
    if (activeWorkerProcess) {
      try { activeWorkerProcess.kill(); } catch (_) {}
      activeWorkerProcess = null;
    }

    // Spawn Python worker
    const workerScript = path.join(__dirname, '..', 'automation_worker.py');
    try {
      activeWorkerProcess = spawn('python', [workerScript], {
        cwd: path.join(__dirname, '..'),
        detached: false,
        stdio: 'ignore'
      });

      activeWorkerProcess.on('exit', (code) => {
        const current = readJsonSafe(STATE_FILE, {});
        current.running = false;
        if (code !== 0 && !current.completed && !current.error) {
          current.error = `Worker process exited with code ${code}`;
        }
        writeJsonSafe(STATE_FILE, current);
        activeWorkerProcess = null;
      });

      return res.status(200).json({
        success: true,
        message: 'Automation worker spawned successfully',
        pid: activeWorkerProcess.pid,
        task: taskCfg
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        message: `Failed to spawn worker: ${err.message}`
      });
    }
  }

  // 4. POST Stop Automation
  if (action === 'stop' && req.method === 'POST') {
    if (activeWorkerProcess) {
      try {
        activeWorkerProcess.kill();
      } catch (_) {}
      activeWorkerProcess = null;
    }
    const current = readJsonSafe(STATE_FILE, {});
    current.running = false;
    current.step = 'stopped';
    current.logs = current.logs || [];
    current.logs.push(`[${new Date().toLocaleTimeString()}] Automation stopped by user`);
    writeJsonSafe(STATE_FILE, current);

    return res.status(200).json({ success: true, message: 'Automation stopped' });
  }

  // 5. GET Status
  const state = readJsonSafe(STATE_FILE, {
    running: false,
    completed: false,
    step: 'idle',
    progress_percent: 0,
    browser_connected: false,
    logs: ['Ready to launch.'],
    last_log: 'Ready to launch.',
    agesmart_url: '',
    error: null
  });

  return res.status(200).json({
    success: true,
    state,
    timestamp: Date.now()
  });
};
