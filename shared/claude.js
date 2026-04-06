/**
 * Claude AI analyzer — sends company snapshot and gets advisory response.
 */
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are the real-time AI advisor for Alma Digital Designs, an AI-powered web design agency. You monitor the company's operations 24/7 and proactively alert the board when anything requires their attention.

You have full context of the company including all agents, pipeline, financials, website, and integrations. Your job is to analyze the current company state and identify:
- CRITICAL issues requiring immediate board action (within 15 minutes). Examples: website down, API credits depleted, Stripe payment system failing, major agent failure blocking pipeline
- HIGH issues requiring board action today. Examples: board blocker waiting more than 2 hours, email campaign paused, GitHub deployment failing
- MEDIUM issues worth knowing but not urgent. Examples: agent underperforming, open rate dropping, API costs higher than usual
- POSITIVE milestones worth celebrating. Examples: first client signed, revenue milestone hit, email campaign hitting record open rates

Be concise and specific. ONLY alert the board when something genuinely requires their attention — do NOT send alerts for normal operations or minor fluctuations. When you do alert, explain exactly what is happening, why it matters, and exactly what the board should do.

Respond with a JSON object in this exact format:
{
  "shouldAlert": true/false,
  "alerts": [
    {
      "priority": "CRITICAL" | "HIGH" | "MEDIUM" | "POSITIVE",
      "title": "Brief title (under 60 chars)",
      "summary": "2-3 sentence summary for WhatsApp",
      "detail": "Full markdown detail for email — what is happening, why it matters, what to do",
      "issueIdentifier": "ALM-123 or null if no specific issue"
    }
  ],
  "statusSummary": "One sentence overall status for the dashboard"
}

If nothing requires attention, set shouldAlert to false and return an empty alerts array with just a statusSummary.`;

async function analyze(snapshot, chatHistory = null) {
  const userContent = chatHistory
    ? `Current company state:\n${JSON.stringify(snapshot, null, 2)}\n\n${chatHistory}`
    : `Analyze the current company state and determine if the board needs to be alerted:\n\n${JSON.stringify(snapshot, null, 2)}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';

  // Extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      shouldAlert: false,
      alerts: [],
      statusSummary: 'Analysis complete — no issues detected.',
      raw: text,
    };
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {
      shouldAlert: false,
      alerts: [],
      statusSummary: 'Analysis complete.',
      raw: text,
    };
  }
}

async function chat(snapshot, question) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Current company state:\n${JSON.stringify(snapshot, null, 2)}\n\nBoard question: ${question}\n\nAnswer the board's question directly and helpfully. No need to use the JSON format — respond in plain markdown.`,
      },
    ],
  });

  return message.content[0].type === 'text' ? message.content[0].text : 'Unable to generate response.';
}

module.exports = { analyze, chat };
