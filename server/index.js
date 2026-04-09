/**
 * Board Interface server -- deployed to Railway.
 * Serves the advisor.almadigitaldesigns.com web interface.
 * Receives relayed snapshots from the local Monitor.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const { createServer } = require('http');
const { Server: SocketIO } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { chat } = require('../shared/claude');
const store = require('../shared/store');

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const RELAY_SECRET = process.env.RELAY_SECRET;

app.use(cors());

// -- Stripe Webhook -- MUST be before express.json() --
// Uses Node.js built-in crypto for HMAC verification (no stripe SDK required).
// express.raw() preserves the raw body buffer Stripe needs for signature checks.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!sig) {
    console.error('[stripe-webhook] Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  // Manual Stripe v1 signature verification using crypto
  try {
    const rawBody = req.body.toString('utf8');
    const elements = sig.split(',');
    const tsEntry = elements.find(function(el) { return el.startsWith('t='); });
    const sigEntries = elements.filter(function(el) { return el.startsWith('v1='); });

    if (!tsEntry || sigEntries.length === 0) {
      return res.status(400).json({ error: 'Malformed stripe-signature header' });
    }

    const timestamp = tsEntry.slice(2);
    const payload = timestamp + '.' + rawBody;
    const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    const valid = sigEntries.some(function(entry) { return entry.slice(3) === expected; });

    if (!valid) {
      console.error('[stripe-webhook] Signature mismatch');
      return res.status(400).json({ error: 'Signature verification failed' });
    }

    const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
    if (age > 300) {
      return res.status(400).json({ error: 'Webhook timestamp too old' });
    }
  } catch (err) {
    console.error('[stripe-webhook] Signature check error:', err.message);
    return res.status(400).json({ error: 'Signature check error' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  console.log('[stripe-webhook] Received event: ' + event.type);

  if (event.type === 'checkout.session.completed') {
    const session = (event.data && event.data.object) ? event.data.object : {};
    const customerName = (session.customer_details && session.customer_details.name) || 'Unknown';
    const customerEmail = (session.customer_details && session.customer_details.email) || '';
    const amountCents = session.amount_total || 0;

    console.log('[stripe-webhook] Payment confirmed: ' + customerName + ' (' + customerEmail + ') -- $' + (amountCents / 100).toFixed(2));

    // Queue for local monitor to pick up on next relay cycle and create Paperclip task
    store.addPendingPayment({
      sessionId: session.id,
      customerName: customerName,
      customerEmail: customerEmail,
      amountCents: amountCents,
      paymentStatus: session.payment_status,
      receivedAt: new Date().toISOString(),
    });
  }

  res.json({ received: true });
});

// Global JSON parser (must be after webhook route)
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// -- Relay endpoint -- receives data from local Monitor --
app.post('/api/relay', function(req, res) {
  const secret = req.headers['x-relay-secret'];
  if (RELAY_SECRET && secret !== RELAY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const snapshot = req.body.snapshot;
  const analysis = req.body.analysis;
  if (!snapshot) return res.status(400).json({ error: 'Missing snapshot' });

  store.addSnapshot(snapshot);
  if (analysis && analysis.shouldAlert && analysis.alerts && analysis.alerts.length > 0) {
    store.addAlerts(analysis.alerts, analysis);
    io.emit('alerts', analysis.alerts);
  }

  io.emit('snapshot', snapshot);
  if (analysis) io.emit('analysis', analysis);

  // Return any pending payment events for the monitor to process into Paperclip tasks
  const pendingPayments = store.popPendingPayments();
  res.json({ ok: true, pendingPayments: pendingPayments });
});

// -- REST API --
app.get('/api/state', function(req, res) {
  res.json({
    snapshot: store.getLatestSnapshot(),
    analysis: store.getLatestAnalysis(),
    alerts: store.getAlertHistory(20),
  });
});

app.get('/api/history', function(req, res) {
  const count = Math.min(parseInt(req.query.count || '60', 10), 1440);
  res.json(store.getSnapshots(count));
});

app.get('/api/alerts', function(req, res) {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  res.json(store.getAlertHistory(limit));
});

// Chat endpoint
app.post('/api/chat', async function(req, res) {
  const question = req.body.question;
  if (!question || typeof question !== 'string' || question.length > 2000) {
    return res.status(400).json({ error: 'Invalid question' });
  }

  const snapshot = store.getLatestSnapshot();
  if (!snapshot) {
    return res.json({ answer: 'No company data available yet -- the monitor may still be starting up.' });
  }

  try {
    const answer = await chat(snapshot, question);
    res.json({ answer: answer, id: uuidv4() });
  } catch (err) {
    console.error('[server] Chat error:', err.message);
    res.status(500).json({ error: 'Failed to get Claude response' });
  }
});

// Health
app.get('/health', function(req, res) {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// SPA fallback
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -- WebSocket --
io.on('connection', function(socket) {
  console.log('[server] Board client connected:', socket.id);

  const snapshot = store.getLatestSnapshot();
  const analysis = store.getLatestAnalysis();
  if (snapshot) socket.emit('snapshot', snapshot);
  if (analysis) socket.emit('analysis', analysis);
  socket.emit('alerts', store.getAlertHistory(20));

  socket.on('disconnect', function() {
    console.log('[server] Board client disconnected:', socket.id);
  });
});

httpServer.listen(PORT, function() {
  console.log('[server] Alma Advisor listening on port ' + PORT);
});
