/**
 * Paperclip API client — collects full company state snapshot.
 */
const axios = require('axios');

const BASE = process.env.PAPERCLIP_API_URL || 'http://127.0.0.1:3100';
const COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID;
const API_KEY = process.env.PAPERCLIP_API_KEY;

const http = axios.create({
  baseURL: BASE,
  headers: { Authorization: `Bearer ${API_KEY}` },
  timeout: 10000,
});

async function safeGet(path, fallback = null) {
  try {
    const { data } = await http.get(path);
    return data;
  } catch (err) {
    console.warn(`[paperclip] GET ${path} failed: ${err.message}`);
    return fallback;
  }
}

async function collectSnapshot() {
  const [dashboard, issues, agents] = await Promise.all([
    safeGet(`/api/companies/${COMPANY_ID}/dashboard`, {}),
    safeGet(`/api/companies/${COMPANY_ID}/issues?status=todo,in_progress,blocked&limit=100`, []),
    safeGet(`/api/companies/${COMPANY_ID}/agents`, []),
  ]);

  // Categorize tasks
  const tasks = Array.isArray(issues) ? issues : (issues.issues || []);
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const todoTasks = tasks.filter(t => t.status === 'todo');

  // Compute agent status summary
  const agentList = Array.isArray(agents) ? agents : (agents.agents || []);
  const agentSummary = agentList.map(a => ({
    id: a.id,
    name: a.name,
    role: a.role,
    monthlyBudget: a.monthlyBudget,
    monthlySpend: a.monthlySpend,
    budgetPct: a.monthlyBudget > 0 ? Math.round((a.monthlySpend / a.monthlyBudget) * 100) : 0,
    paused: a.paused || false,
  }));

  const overBudgetAgents = agentSummary.filter(a => a.budgetPct >= 80);
  const boardBlockers = blockedTasks.filter(t => !t.assigneeAgentId);

  return {
    collectedAt: new Date().toISOString(),
    summary: {
      totalActiveTasks: inProgressTasks.length,
      blockedTasks: blockedTasks.length,
      todoTasks: todoTasks.length,
      totalAgents: agentList.length,
      overBudgetAgents: overBudgetAgents.length,
      boardBlockers: boardBlockers.length,
    },
    dashboard: dashboard || {},
    tasks: {
      blocked: blockedTasks,
      inProgress: inProgressTasks,
      todo: todoTasks,
    },
    agents: agentSummary,
    overBudgetAgents,
    boardBlockers,
  };
}

module.exports = { collectSnapshot };
