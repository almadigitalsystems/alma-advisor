/**
 * In-memory store for snapshots, alert history, and pending payment events.
 * Keeps last SNAPSHOT_HISTORY entries (default 1440 = 24h at 60s intervals).
 */

const MAX_SNAPSHOTS = parseInt(process.env.SNAPSHOT_HISTORY || '1440', 10);
const MAX_ALERTS = 200;

const snapshots = [];
const alertHistory = [];
let latestAnalysis = null;
const pendingPayments = [];

function addSnapshot(snapshot) {
  snapshots.push(snapshot);
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
}

function addAlerts(alerts, analysis) {
  latestAnalysis = analysis;
  for (const alert of alerts) {
    alertHistory.unshift({ ...alert, firedAt: new Date().toISOString() });
  }
  if (alertHistory.length > MAX_ALERTS) alertHistory.length = MAX_ALERTS;
}

function getLatestSnapshot() {
  return snapshots[snapshots.length - 1] || null;
}

function getSnapshots(count = 60) {
  return snapshots.slice(-count);
}

function getAlertHistory(limit = 50) {
  return alertHistory.slice(0, limit);
}

function getLatestAnalysis() {
  return latestAnalysis;
}

function addPendingPayment(payment) {
  pendingPayments.push(payment);
  console.log('[store] Queued pending payment for:', payment.customerName);
}

function popPendingPayments() {
  return pendingPayments.splice(0);
}

module.exports = {
  addSnapshot,
  addAlerts,
  getLatestSnapshot,
  getSnapshots,
  getAlertHistory,
  getLatestAnalysis,
  addPendingPayment,
  popPendingPayments,
};
