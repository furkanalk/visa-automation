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
import path from 'path';
import { fileURLToPath } from 'url';
import { mockState } from './state.js';
import { renderPage1 } from './templates/as-visa/page1-form.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
const PORT = process.env.PORT || 3004;

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
  const html = renderPage1({
    blockedDates: openDates,
    availableTimes: times,
    showCaptcha: config.captcha.enabled,
    captchaAutoSolve: config.captcha.autoSolveDelayMs > 0,
    captchaAutoSolveDelayMs: config.captcha.autoSolveDelayMs,
    showSecurityCode: false, // Scout only checks slots; no enteredCode input → no security_code abort
    securityCode,
    skipInfoPopup: true, // Skip for faster testing
    skipBotDetection: true, // Skip for automation
  });

  res.type('html').send(html);
});

// Form submission
app.post('/as-visa/submit', async (req, res) => {
  const config = mockState.getConfig('as-visa');
  
  if (!config || !config.enabled) {
    return res.status(503).json({ error: 'Portal disabled' });
  }

  // Apply submission delay
  await mockState.applyDelay('as-visa', 'formSubmit');

  // Validate CAPTCHA token if required
  if (config.captcha.enabled) {
    const cfToken = req.body.cfToken;
    if (!cfToken || !cfToken.startsWith('mock-cf-token-')) {
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>❌ CAPTCHA verification failed</h1>
            <p>Please verify you are not a robot.</p>
            <a href="/as-visa">← Back to form</a>
          </body>
        </html>
      `);
    }

    // Random captcha failure
    if (Math.random() < config.captcha.failRate) {
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>❌ CAPTCHA expired</h1>
            <p>CAPTCHA timed out. Please try again.</p>
            <a href="/as-visa">← Back to form</a>
          </body>
        </html>
      `);
    }
  }

  // Validate required fields (names match as-visa.html form field names)
  if (config.validation.requireAllFields) {
    const required = ['Nationality', 'Appointment', 'TravelSubject', 'TravelDate', 'AppointmentDate', 'AppointmentTime'];
    const missing = required.filter((f) => !req.body[f]);
    
    if (missing.length > 0) {
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>❌ Missing required fields</h1>
            <p>Please fill in all required fields: ${missing.join(', ')}</p>
            <a href="/as-visa">← Back to form</a>
          </body>
        </html>
      `);
    }
  }

  // Create session and store form data
  const session = mockState.createSession('as-visa');
  const confirmationNumber = `MOCK-${new Date().getFullYear()}-${session.id.slice(0, 8).toUpperCase()}`;
  mockState.updateSession(session.id, {
    formData: req.body,
    currentStep: 'slots',
    confirmationNumber,
  });

  // Success page with confirmation number (for agent to scrape)
  res.send(`
    <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .success-card {
            background: white;
            padding: 40px;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
          }
          .success-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 { color: #333; margin-bottom: 10px; }
          p { color: #666; margin-bottom: 20px; }
          .session-id {
            background: #f5f5f5;
            padding: 10px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
          }
          .data-preview {
            text-align: left;
            background: #f9f9f9;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
            font-size: 14px;
          }
          .data-preview dt { font-weight: 600; color: #333; }
          .data-preview dd { margin-bottom: 10px; color: #666; }
          .mock-banner {
            background: #ff5722;
            color: white;
            padding: 10px;
            text-align: center;
            font-weight: 600;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
          }
          .next-step {
            margin-top: 20px;
            padding: 12px 24px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <div class="mock-banner">⚠️ MOCK PORTAL – Test environment</div>
        <div class="success-card">
          <div class="success-icon">✅</div>
          <h1>Appointment booked</h1>
          <p>Form submitted successfully. Confirmation number below.</p>
          <div id="confirmationNumber" data-confirmation="${confirmationNumber}" class="session-id">
            Confirmation: ${confirmationNumber}
          </div>
          <div class="session-id">
            Session: ${session.id}
          </div>
          
          <div class="data-preview">
            <dl>
              <dt>Nationality:</dt>
              <dd>${req.body.Nationality || '-'}</dd>
              <dt>Appointment type:</dt>
              <dd>${req.body.Appointment || '-'}</dd>
              <dt>Appointment date:</dt>
              <dd>${req.body.AppointmentDate || '-'} @ ${req.body.AppointmentTime || '-'}</dd>
            </dl>
          </div>
          
          <a href="/as-visa"><button class="next-step">← New form</button></a>
        </div>
      </body>
    </html>
  `);
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
          </script>
          
          <div class="card api-section">
            <h2>🔧 Admin API</h2>
            <pre>
GET  /api/config              - Get all portal configs
GET  /api/config/:portalId    - Get specific portal config
POST /api/config/:portalId    - Update portal config
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
