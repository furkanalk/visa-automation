/**
 * Mock Portal Server
 * 
 * Serves mock visa portal pages that match real portal HTML structures
 * for testing the automation worker against simulated environments.
 * 
 * Usage:
 *   npm run dev       - Start development server on port 3004
 *   npm run build     - Compile TypeScript
 *   npm run start     - Start production server
 * 
 * Admin API:
 *   GET  /api/config              - Get all portal configs
 *   GET  /api/config/:portalId    - Get specific portal config
 *   POST /api/config/:portalId    - Update portal config
 *   POST /api/reset               - Reset all state
 *   GET  /api/stats               - Get server stats
 * 
 * Mock Portals:
 *   /as-visa          - AS Visa mock portal (page 1 - form)
 *   /as-visa/submit   - Form submission endpoint
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { mockState } from './state.js';
import { renderPage1 } from './templates/as-visa/page1-form.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
const PORT = process.env.PORT || 3004;

// multer: memory storage for multipart/form-data (used by /tr/ankara-bireysel-basvuru)
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mimic AS-Visa asset paths (JS/CSS) so automation and same HTML structure work
app.use('/WebSite', express.static(path.join(publicDir, 'WebSite')));
app.use('/PageJs', express.static(path.join(publicDir, 'PageJs')));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ============================================
// Admin API Routes
// ============================================

// Get all configs
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: mockState.getAllConfigs(),
  });
});

// Get specific portal config
app.get('/api/config/:portalId', (req, res) => {
  const config = mockState.getConfig(req.params.portalId);
  if (!config) {
    return res.status(404).json({
      success: false,
      error: 'Portal not found',
    });
  }
  res.json({ success: true, data: config });
});

// Update portal config
app.post('/api/config/:portalId', (req, res) => {
  const config = mockState.setConfig(req.params.portalId, req.body);
  res.json({ success: true, data: config });
});

// Apply config preset
app.post('/api/presets/:portalId/:presetId', (req, res) => {
  const portalId = req.params.portalId;
  const presetId = req.params.presetId;
  if (presetId !== 'strict-real-mode' && presetId !== 'fast-mock') {
    return res.status(400).json({
      success: false,
      error: 'Unknown preset. Use strict-real-mode or fast-mock.',
    });
  }
  const config = mockState.applyPreset(portalId, presetId);
  return res.json({ success: true, data: config, preset: presetId });
});

// Reset all state
app.post('/api/reset', (req, res) => {
  mockState.reset();
  res.json({ success: true, message: 'All state reset' });
});

// Get stats
app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    data: mockState.getStats(),
  });
});

// ============================================
// AS-Visa Mock Portal Routes
// ============================================

// TarihGetir: same as real site — returns OPEN dates (dateDisabled real semantics)
// dateDisabled = list of OPEN days. Empty = no open days = no slots.
app.post('/AnBir/Macaristan/TarihGetir', (req, res) => {
  const { openDates } = mockState.getAvailableSlots('as-visa');
  res.type('json').json(openDates);
});

// SaatGetir: returns available times for selected date, same format as real site [{value, text}]
app.post('/AnBir/Macaristan/SaatGetir', (req, res) => {
  const { times } = mockState.getAvailableSlots('as-visa');
  const result = times.map((t) => ({ value: t, text: t }));
  res.type('json').json(result);
});

// Main form page
app.get('/as-visa', async (req, res) => {
  const config = mockState.getConfig('as-visa');
  
  if (!config || !config.enabled) {
    return res.status(503).send(`
      <html>
        <body style="font-family: sans-serif; padding: 50px; text-align: center;">
          <h1>🔧 System under maintenance</h1>
          <p>This portal is currently disabled. Please try again later.</p>
          <p style="color: #999;"><a href="/">← Back to Mock Portal</a></p>
        </body>
      </html>
    `);
  }

  if (config.behavior.maintenanceMode) {
    return res.status(503).send(`
      <html>
        <body style="font-family: sans-serif; padding: 50px; text-align: center;">
          <h1>🔧 System under maintenance</h1>
          <p>Planned maintenance in progress.</p>
          <p style="color: #999;"><a href="/">← Back to Mock Portal</a></p>
        </body>
      </html>
    `);
  }

  // Apply configured delay
  await mockState.applyDelay('as-visa', 'pageLoad');

  // Check for random error
  if (mockState.shouldError('as-visa')) {
    return res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; padding: 50px; text-align: center;">
          <h1>❌ Server error</h1>
          <p>An unexpected error occurred. Please try again.</p>
          <p style="color: #999;"><a href="/">← Back to Mock Portal</a></p>
        </body>
      </html>
    `);
  }

  // Get available slots (openDates = real AS-VISA semantics: list of open days)
  const { openDates, times } = mockState.getAvailableSlots('as-visa');

  // Get security code
  const securityCode = config.security.code === 'random'
    ? String(Math.floor(100000 + Math.random() * 900000))
    : config.security.code;

  // Render page — pass openDates as blockedDates param (template uses this as dateDisabled JS var)
  // showSecurityCode: her zaman true — mock'un amacı bu kodu her zaman göstermek.
  const strictRealMode = config.presets?.strictRealMode === true;
  const html = renderPage1({
    blockedDates: openDates,
    availableTimes: times,
    showCaptcha: config.captcha.enabled,
    captchaAutoSolve: config.captcha.autoSolveDelayMs > 0,
    captchaAutoSolveDelayMs: config.captcha.autoSolveDelayMs,
    showSecurityCode: true, // Mock'ta her zaman göster (auto-solve da olsa HITL de olsa)
    securityCode,
    // Strict preset emulates real site constraints.
    skipInfoPopup: !strictRealMode,
    skipBotDetection: !strictRealMode,
    mouseSimulationMode: strictRealMode ? 'disabled' : config.mouseSimulation.mode,
    mouseSimulationIntervalMs: config.mouseSimulation.intervalMs,
  });

  res.type('html').send(html);
});

// ============================================
// Shared helpers
// ============================================

function renderConfirmationPage(opts: {
  confirmationNumber: string;
  sessionId: string;
  nationality?: string;
  appointment?: string;
  appointmentDate?: string;
  appointmentTime?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Randevu Onayı – Mock Portal</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1d2657 0%, #3a4a8a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding-top: 50px;
      box-sizing: border-box;
    }
    .mock-banner {
      background: #ff5722;
      color: white;
      padding: 10px;
      text-align: center;
      font-weight: 600;
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 9999;
      font-family: Arial, sans-serif;
    }
    .card {
      background: white;
      padding: 40px;
      border-radius: 12px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      max-width: 520px;
      width: 100%;
      margin: 20px;
    }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #1d2657; margin: 0 0 8px; font-size: 26px; }
    .subtitle { color: #666; margin-bottom: 24px; font-size: 15px; }
    .confirmation-box {
      background: #e8f5e9;
      border: 2px solid #4caf50;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .confirmation-label { font-size: 13px; color: #555; margin-bottom: 4px; }
    #confirmationNumber {
      font-family: monospace;
      font-size: 20px;
      font-weight: 700;
      color: #1d2657;
      letter-spacing: 1px;
    }
    .meta-box {
      background: #f9f9f9;
      border-radius: 8px;
      padding: 16px;
      text-align: left;
      font-size: 14px;
      margin-bottom: 20px;
    }
    .meta-box dt { font-weight: 600; color: #333; margin-top: 8px; }
    .meta-box dd { color: #555; margin: 2px 0 0 0; }
    .session-box {
      background: #f0f0f0;
      border-radius: 6px;
      padding: 10px;
      font-family: monospace;
      font-size: 11px;
      word-break: break-all;
      color: #888;
      margin-bottom: 20px;
    }
    .btn-back {
      display: inline-block;
      padding: 12px 28px;
      background: #1d2657;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 15px;
      cursor: pointer;
      text-decoration: none;
    }
    .btn-back:hover { background: #2a3680; }
    /* Script tag for automation to detect page loaded */
  </style>
</head>
<body>
  <div class="mock-banner">⚠️ MOCK PORTAL – Test environment</div>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Randevu Onaylandı</h1>
    <p class="subtitle">Başvurunuz başarıyla alındı. Onay numaranızı saklayınız.</p>

    <div class="confirmation-box">
      <div class="confirmation-label">Onay Numarası / Confirmation Number</div>
      <div id="confirmationNumber" data-confirmation="${opts.confirmationNumber}">${opts.confirmationNumber}</div>
    </div>

    <div class="meta-box">
      <dl>
        <dt>Uyruk / Nationality</dt>
        <dd>${opts.nationality || '-'}</dd>
        <dt>Randevu Tipi / Appointment Type</dt>
        <dd>${opts.appointment || '-'}</dd>
        <dt>Randevu Tarihi / Appointment Date</dt>
        <dd>${opts.appointmentDate || '-'} @ ${opts.appointmentTime || '-'}</dd>
      </dl>
    </div>

    <div class="session-box">Session: ${opts.sessionId}</div>

    <a href="/as-visa" class="btn-back">← Yeni Başvuru / New Form</a>
  </div>

  <script>
    console.log('[Mock] Confirmation page loaded. Confirmation:', '${opts.confirmationNumber}');
  </script>
</body>
</html>`;
}

// ============================================
// Form submission — real-site-like flow
// ============================================

/**
 * Validates form body, creates session, returns { session, confirmationNumber } or sends error.
 * Used by both /tr/ankara-bireysel-basvuru (AJAX) and /as-visa/submit (legacy).
 */
async function processSubmit(
  req: express.Request,
  res: express.Response,
  responseMode: 'json' | 'html',
): Promise<void> {
  const config = mockState.getConfig('as-visa');

  if (!config || !config.enabled) {
    if (responseMode === 'json') {
      res.status(503).json({ error: 'Portal disabled' });
    } else {
      res.status(503).send('<html><body><h1>Portal disabled</h1></body></html>');
    }
    return;
  }

  await mockState.applyDelay('as-visa', 'formSubmit');

  if (config.captcha.enabled) {
    const cfToken = req.body.cfToken as string | undefined;
    if (!cfToken || !cfToken.startsWith('mock-cf-token-')) {
      if (responseMode === 'json') {
        res.status(400).json({ error: 'CAPTCHA verification failed' });
      } else {
        res.status(400).send('<html><body><h1>CAPTCHA verification failed</h1><a href="/as-visa">← Back</a></body></html>');
      }
      return;
    }
    if (Math.random() < config.captcha.failRate) {
      if (responseMode === 'json') {
        res.status(400).json({ error: 'CAPTCHA expired' });
      } else {
        res.status(400).send('<html><body><h1>CAPTCHA expired</h1><a href="/as-visa">← Back</a></body></html>');
      }
      return;
    }
  }

  if (config.validation.requireAllFields) {
    const required = ['Nationality', 'Appointment', 'TravelSubject', 'TravelDate', 'AppointmentDate', 'AppointmentTime'];
    const missing = required.filter((f) => !req.body[f]);
    if (missing.length > 0) {
      if (responseMode === 'json') {
        res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      } else {
        res.status(400).send(`<html><body><h1>Missing: ${missing.join(', ')}</h1><a href="/as-visa">← Back</a></body></html>`);
      }
      return;
    }
  }

  const session = mockState.createSession('as-visa');
  const confirmationNumber = `MOCK-${new Date().getFullYear()}-${session.id.slice(0, 8).toUpperCase()}`;
  mockState.updateSession(session.id, {
    formData: req.body,
    currentStep: 'slots',
    confirmationNumber,
  });

  const confirmationUrl = `/tr/ankara-basvuru-onay?sid=${session.id}`;

  if (responseMode === 'json') {
    // Mimic real site: return { url: "..." } for JS to do window.location.href
    res.json({ url: confirmationUrl, confirmationNumber });
  } else {
    // Legacy direct HTML response (backward compat for old tests)
    res.redirect(302, confirmationUrl);
  }
}

// Main booking endpoint — mirrors real site: POST /tr/ankara-bireysel-basvuru → JSON { url }
// Accepts both multipart/form-data (real site / birebir mock) and urlencoded (legacy tests).
// upload.none() parses multipart fields into req.body without accepting file uploads.
app.post('/tr/ankara-bireysel-basvuru', upload.none(), async (req, res) => {
  await processSubmit(req, res, 'json');
});

// Confirmation page — mirrors real site's dynamic redirect target
app.get('/tr/ankara-basvuru-onay', (req, res) => {
  const sid = req.query.sid as string | undefined;
  if (!sid) {
    return res.status(400).send('<html><body><h1>Missing session id</h1></body></html>');
  }

  const session = mockState.getSession(sid);
  const confirmationNumber = session?.confirmationNumber ?? `MOCK-UNKNOWN-${sid.slice(0, 8).toUpperCase()}`;
  const formData = (session?.formData ?? {}) as Record<string, string>;

  res.type('html').send(renderConfirmationPage({
    confirmationNumber,
    sessionId: sid,
    nationality: formData['Nationality'],
    appointment: formData['Appointment'],
    appointmentDate: formData['AppointmentDate'],
    appointmentTime: formData['AppointmentTime'],
  }));
});

// Legacy endpoint — kept for backward compatibility; now redirects to the confirmation page
app.post('/as-visa/submit', async (req, res) => {
  await processSubmit(req, res, 'html');
});

// ============================================
// Root & Health
// ============================================

app.get('/', (req, res) => {
  const configs = mockState.getAllConfigs();
  const stats = mockState.getStats();

  res.send(`
    <html>
      <head>
        <title>Mock Portal - Visa Automation Testing</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            padding: 40px;
            margin: 0;
          }
          .container { max-width: 900px; margin: 0 auto; }
          h1 { color: #667eea; margin-bottom: 10px; }
          .subtitle { color: #888; margin-bottom: 30px; }
          .card {
            background: #16213e;
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 20px;
          }
          .card h2 { color: #667eea; margin-top: 0; font-size: 18px; }
          .portal-list { list-style: none; padding: 0; }
          .portal-list li {
            padding: 15px;
            background: #0f3460;
            border-radius: 8px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .portal-list a {
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
          }
          .portal-list a:hover { text-decoration: underline; }
          .badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
          }
          .badge-enabled { background: #4caf50; color: white; }
          .badge-disabled { background: #f44336; color: white; }
          .portal-toggle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            min-width: 72px;
            padding: 6px 14px;
            border: none;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s, color 0.2s;
          }
          .portal-toggle.enabled { background: #4caf50; color: white; }
          .portal-toggle.enabled:hover { background: #43a047; }
          .portal-toggle.disabled { background: #555; color: #ccc; }
          .portal-toggle.disabled:hover { background: #666; }
          .portal-toggle:disabled { opacity: 0.7; cursor: wait; }
          .preset-actions {
            display: flex;
            gap: 10px;
            margin: 10px 0 0;
          }
          .preset-btn {
            border: 1px solid #667eea;
            background: transparent;
            color: #c7d2fe;
            padding: 6px 10px;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
          }
          .preset-btn:hover { background: rgba(102,126,234,0.15); }
          .preset-btn.active {
            background: #667eea;
            color: white;
            border-color: #667eea;
          }
          .preset-btn:disabled { opacity: 0.7; cursor: wait; }
          .stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
          }
          .stat {
            background: #0f3460;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
          }
          .stat-value { font-size: 32px; font-weight: bold; color: #667eea; }
          .stat-label { color: #888; font-size: 14px; }
          .api-section { margin-top: 30px; }
          code {
            background: #0f3460;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 14px;
          }
          pre {
            background: #0f3460;
            padding: 15px;
            border-radius: 8px;
            overflow-x: auto;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎭 Mock Portal Server</h1>
          <p class="subtitle">Visa Automation Test Environment</p>
          
          <div class="card">
            <h2>📊 Server Stats</h2>
            <div class="stats">
              <div class="stat">
                <div class="stat-value">${stats.portals}</div>
                <div class="stat-label">Portals</div>
              </div>
              <div class="stat">
                <div class="stat-value">${stats.activeSessions}</div>
                <div class="stat-label">Active Sessions</div>
              </div>
              <div class="stat">
                <div class="stat-value">${configs.filter((c) => c.enabled).length}</div>
                <div class="stat-label">Enabled</div>
              </div>
            </div>
          </div>
          
          <div class="card">
            <h2>🌐 Available Mock Portals</h2>
            <p style="color: #888; font-size: 14px; margin-bottom: 15px;">Enable or disable each portal individually.</p>
            <ul class="portal-list">
              ${configs
                .map(
                  (c) => `
                <li data-portal-id="${c.portalId}">
                  <div>
                    <a href="/${c.portalId}">${c.portalId}</a>
                    <br><small style="color: #666;">Mock ${c.portalId} appointment portal</small>
                    <br><small style="color: #8aa0ff;">Preset: ${(c as any).presets?.strictRealMode ? 'strict-real-mode' : 'fast-mock'}</small>
                    <div class="preset-actions">
                      <button
                        type="button"
                        class="preset-btn ${(c as any).presets?.strictRealMode ? 'active' : ''}"
                        data-portal-id="${c.portalId}"
                        data-preset-id="strict-real-mode"
                      >Strict Real Mode</button>
                      <button
                        type="button"
                        class="preset-btn ${(c as any).presets?.strictRealMode ? '' : 'active'}"
                        data-portal-id="${c.portalId}"
                        data-preset-id="fast-mock"
                      >Fast Mock</button>
                    </div>
                  </div>
                  <button type="button" class="portal-toggle ${c.enabled ? 'enabled' : 'disabled'}" data-portal-id="${c.portalId}" data-enabled="${c.enabled}">
                    ${c.enabled ? '✓ On' : 'Off'}
                  </button>
                </li>
              `
                )
                .join('')}
            </ul>
          </div>
          <script>
            document.querySelectorAll('.portal-toggle').forEach(function(btn) {
              btn.addEventListener('click', function() {
                var portalId = this.getAttribute('data-portal-id');
                var currentlyEnabled = this.getAttribute('data-enabled') === 'true';
                var newEnabled = !currentlyEnabled;
                btn.disabled = true;
                fetch('/api/config/' + encodeURIComponent(portalId), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enabled: newEnabled })
                })
                  .then(function(r) { return r.json(); })
                  .then(function() { window.location.reload(); })
                  .catch(function() { btn.disabled = false; });
              });
            });
            document.querySelectorAll('.preset-btn').forEach(function(btn) {
              btn.addEventListener('click', function() {
                var portalId = this.getAttribute('data-portal-id');
                var presetId = this.getAttribute('data-preset-id');
                if (!portalId || !presetId) return;
                btn.disabled = true;
                fetch('/api/presets/' + encodeURIComponent(portalId) + '/' + encodeURIComponent(presetId), {
                  method: 'POST'
                })
                  .then(function(r) { return r.json(); })
                  .then(function() { window.location.reload(); })
                  .catch(function() { btn.disabled = false; });
              });
            });
          </script>
          
          <div class="card api-section">
            <h2>🔧 Admin API</h2>
            <pre>
GET  /api/config              - Get all portal configs
GET  /api/config/:portalId    - Get specific portal config
POST /api/config/:portalId    - Update portal config
POST /api/presets/:portalId/:presetId - Apply preset (strict-real-mode | fast-mock)
POST /api/reset               - Reset all state
GET  /api/stats               - Get server stats
            </pre>
            
            <h3 style="margin-top: 20px; color: #888; font-size: 14px;">Example: Update Config</h3>
            <pre>
curl -X POST http://localhost:${PORT}/api/config/as-visa \\
  -H "Content-Type: application/json" \\
  -d '{"behavior": {"errorRate": 0.1}, "slots": {"availableDates": ["2024-03-01"]}}'
            </pre>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🎭 Mock Portal Server                                    ║
║                                                            ║
║   Port: ${PORT}                                             ║
║   URL:  http://localhost:${PORT}                            ║
║                                                            ║
║   Available Portals:                                       ║
║   • /as-visa - AS Visa Mock Portal                         ║
║                                                            ║
║   Admin API:                                               ║
║   • GET  /api/config - View configurations                 ║
║   • POST /api/config/:id - Update configuration            ║
║   • POST /api/reset - Reset all state                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});
