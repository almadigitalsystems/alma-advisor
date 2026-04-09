/**
 * Monitor -- local Node.js service that polls Paperclip every 60s,
 * sends data to Claude for analysis, and dispatches alerts.
 *
 * Runs locally (same machine as Paperclip at 127.0.0.1:3100).
 * Starts automatically via Windows Task Scheduler on boot.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { collectSnapshot } = require('../shared/paperclip');
const { analyze } = require('../shared/claude');
const { dispatchAlerts } = require('../shared/alerts');
const { addSnapshot, addAlerts } = require('../shared/store');
const http = require('http');
const axios = require('axios');

const INTERVAL = parseInt(process.env.MONITOR_INTERVAL || '60000', 10);
const SENSITIVITY = process.env.ALERT_SENSITIVITY || 'important';

// Optional: push state to the Railway server via HTTP POST
const RELAY_URL = process.env.RELAY_URL; // e.g. https://advisor.almadigitaldesigns.com/api/relay
const RELAY_SECRET = process.env.RELAY_SECRET;

const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'http://127.0.0.1:3100';
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID;
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY;
const MILA_AGENT_ID = '4c048967-aae9-4f50-8d77-6c83322d10f1';

let isRunning = false;
let consecutiveErrors = 0;

async function createMilaTask(payment) {
  if (!PAPERCLIP_API_KEY || !PAPERCLIP_COMPANY_ID) {
    console.warn('[monitor] PAPERCLIP_API_KEY or PAPERCLIP_COMPANY_ID not set -- cannot create Mila task');
    return;
  }

  try {
    const response = await axios.post(
      `${PAPERCLIP_API_URL}/api/companies/${PAPERCLIP_COMPANY_ID}/issues`,
      {
        title: `Onboard new client: ${payment.customerName}`,
        description: [
          '## New Payment Confirmed',
          '',
          `- **Client:** ${payment.customerName}`,
          `- **Email:** ${payment.customerEmail}`,
          `- **Amount:** $${(payment.amountCents / 100).toFixed(2)}`,
          `- **Session ID:** ${payment.sessionId}`,
          `- **Payment Status:** ${payment.paymentStatus}`,
          `- **Received at:** ${payment.receivedAt}`,
          '',
          'Begin client onboarding immediately.',
        ].join('\n'),
        status: 'todo',
        priority: 'high',
        assigneeAgentId: MILA_AGENT_ID,
      },
      { headers: { Authorization: `Bearer ${PAPERCLIP_API_KEY}` } }
    );
    console.log(`[monitor] Created Mila onboarding task: ${response.data.identifier} for ${payment.customerName}`);
  } catch (err) {
    console.error(`[monitor] Failed to create Mila task for ${payment.customerName}:`, err.message);
  }
}

async function runCycle() {
  if (isRunning) {
    console.log('[monitor] Previous cycle still running -- skipping this tick');
    return;
  }

  isRunning = true;
  const cycleStart = Date.now();

  try {
    console.log(`[monitor] Collecting snapshot at ${new Date().toISOString()}`);
    const snapshot = await collectSnapshot();
    addSnapshot(snapshot);

    console.log('[monitor] Analyzing with Claude...');
    const analysis = await analyze(snapshot);

    if (analysis.shouldAlert && analysis.alerts?.length > 0) {
      console.log(`[monitor] ${analysis.alerts.length} alert(s) to dispatch`);
      addAlerts(analysis.alerts, analysis);
      await dispatchAlerts(analysis.alerts, SENSITIVITY);
    } else {
      console.log(`[monitor] Status: ${analysis.statusSummary}`);
    }

    // Relay snapshot + analysis to Railway server (if configured)
    if (RELAY_URL) {
      await relayToServer({ snapshot, analysis }).catch(err =>
        console.warn('[monitor] Relay failed:', err.message)
      );
    }

    consecutiveErrors = 0;
  } catch (err) {
    consecutiveErrors++;
    console.error(`[monitor] Cycle error (${consecutiveErrors} consecutive):`, err.message);

    if (consecutiveErrors >= 5) {
      console.error('[monitor] Too many consecutive errors -- pausing 5 minutes');
      await sleep(5 * 60 * 1000);
      consecutiveErrors = 0;
    }
  } finally {
    isRunning = false;
    const elapsed = Date.now() - cycleStart;
    console.log(`[monitor] Cycle complete in ${elapsed}ms`);
  }
}

async function relayToServer(data) {
  const body = JSON.stringify(data);
  const url = new URL(RELAY_URL);

  return new Promise((resolve, reject) => {
    const req = require(url.protocol === 'https:' ? 'https' : 'http').request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Relay-Secret': RELAY_SECRET || '',
        },
      },
      res => {
        let responseBody = '';
        res.on('data', chunk => { responseBody += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseBody);
            if (parsed.pendingPayments && parsed.pendingPayments.length > 0) {
              console.log(`[monitor] ${parsed.pendingPayments.length} pending payment(s) -- creating Mila tasks`);
              for (const payment of parsed.pendingPayments) {
                createMilaTask(payment).catch(err =>
                  console.error('[monitor] createMilaTask error:', err.message)
                );
              }
            }
          } catch (_) {}
          resolve(res.statusCode);
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Health check endpoint
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), consecutiveErrors }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
healthServer.listen(process.env.MONITOR_PORT || 3099, '127.0.0.1', () => {
  console.log('[monitor] Health check listening on 127.0.0.1:3099');
});

// Run immediately on start, then on interval
console.log(`[monitor] Starting -- interval: ${INTERVAL}ms, sensitivity: ${SENSITIVITY}`);
runCycle();
setInterval(runCycle, INTERVAL);

// Graceful shutdown
process.on('SIGINT', () => { console.log('[monitor] Shutting down'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[monitor] Shutting down'); process.exit(0); });
