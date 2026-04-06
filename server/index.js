/**
 * Board Interface server — deployed to Railway.
 * Serves the advisor.almadigitaldesigns.com web interface.
 * Receives relayed snapshots from the local Monitor.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const { createServer } = require('http');
const { Server: SocketIO } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { chat } = require('../shared/claude');
const store = require('../shared/store');

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const RELAY_SECRET = process.env.RELAY_SECRET;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Relay endpoint — receives data from local Monitor ──────────────────────
app.post('/api/relay', (req, res) => {
  const secret = req.headers['x-relay-secret'];
  if (RELAY_SECRET && secret !== RELAY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { snapshot, analysis } = req.body;
  if (!snapshot) return res.status(400).json({ error: 'Missing snapshot' });

  store.addSnapshot(snapshot);
  if (analysis?.shouldAlert && analysis.alerts?.length > 0) {
    store.addAlerts(analysis.alerts, analysis);
    // Broadcast new alerts to all connected board clients
    io.emit('alerts', analysis.alerts);
  }

  // Always push the latest state to connected clients
  io.emit('snapshot', snapshot);
  if (analysis) io.emit('analysis', analysis);

  res.json({ ok: true });
});

// ── REST API ───────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json({
    snapshot: store.getLatestSnapshot(),
    analysis: store.getLatestAnalysis(),
    alerts: store.getAlertHistory(20),
  });
});

app.get('/api/history', (req, res) => {
  const count = Math.min(parseInt(req.query.count || '60', 10), 1440);
  res.json(store.getSnapshots(count));
});

app.get('/api/alerts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  res.json(store.getAlertHistory(limit));
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== 'string' || question.length > 2000) {
    return res.status(400).json({ error: 'Invalid question' });
  }

  const snapshot = store.getLatestSnapshot();
  if (!snapshot) {
    return res.json({ answer: 'No company data available yet — the monitor may still be starting up.' });
  }

  try {
    const answer = await chat(snapshot, question);
    res.json({ answer, id: uuidv4() });
  } catch (err) {
    console.error('[server] Chat error:', err.message);
    res.status(500).json({ error: 'Failed to get Claude response' });
  }
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSocket ───────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('[server] Board client connected:', socket.id);

  // Send current state immediately on connect
  const snapshot = store.getLatestSnapshot();
  const analysis = store.getLatestAnalysis();
  if (snapshot) socket.emit('snapshot', snapshot);
  if (analysis) socket.emit('analysis', analysis);
  socket.emit('alerts', store.getAlertHistory(20));

  socket.on('disconnect', () => {
    console.log('[server] Board client disconnected:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Alma Advisor listening on port ${PORT}`);
});
