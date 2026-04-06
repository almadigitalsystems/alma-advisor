/**
 * Alert system — sends notifications via WhatsApp (Twilio) and email (Gmail OAuth2).
 */
const twilio = require('twilio');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// Twilio client (lazy init)
let twilioClient = null;
function getTwilio() {
  if (!twilioClient) {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return twilioClient;
}

// Gmail OAuth2 transport (lazy init)
let gmailTransport = null;
async function getGmailTransport() {
  if (gmailTransport) return gmailTransport;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );

  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const { token: accessToken } = await oauth2Client.getAccessToken();

  gmailTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.BOARD_EMAIL,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      accessToken,
    },
  });

  return gmailTransport;
}

const PRIORITY_EMOJI = {
  CRITICAL: '🚨',
  HIGH: '⚠️',
  MEDIUM: 'ℹ️',
  POSITIVE: '🎉',
};

async function sendWhatsApp(alert) {
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  const to = process.env.BOARD_WHATSAPP_NUMBER;

  if (!from || !to) {
    console.warn('[alerts] WhatsApp not configured — skipping');
    return;
  }

  const emoji = PRIORITY_EMOJI[alert.priority] || '📢';
  const body = `${emoji} *ALMA ALERT — ${alert.priority}*\n${alert.title}\n\n${alert.summary}${alert.issueIdentifier ? `\n\nIssue: ${alert.issueIdentifier}` : ''}`;

  await getTwilio().messages.create({ from, to, body });
  console.log(`[alerts] WhatsApp sent: ${alert.priority} — ${alert.title}`);
}

async function sendEmail(alert) {
  const to = process.env.BOARD_EMAIL;
  if (!to || !process.env.GMAIL_CLIENT_ID) {
    console.warn('[alerts] Email not configured — skipping');
    return;
  }

  const emoji = PRIORITY_EMOJI[alert.priority] || '📢';
  const subject = `ALMA ALERT — ${alert.priority} — ${alert.title}`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${priorityColor(alert.priority)}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">${emoji} ${alert.priority} ALERT</h2>
        <h3 style="margin: 8px 0 0;">${alert.title}</h3>
      </div>
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px; color: #374151;">${alert.summary}</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <div style="color: #374151; line-height: 1.6;">${markdownToHtml(alert.detail)}</div>
        ${alert.issueIdentifier ? `<p style="margin-top: 20px;"><strong>Related issue:</strong> ${alert.issueIdentifier}</p>` : ''}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #9ca3af; font-size: 12px;">Alma Digital Designs — AI Advisor</p>
      </div>
    </div>
  `;

  const transport = await getGmailTransport();
  await transport.sendMail({ from: to, to, subject, html });
  console.log(`[alerts] Email sent: ${subject}`);
}

function priorityColor(p) {
  switch (p) {
    case 'CRITICAL': return '#dc2626';
    case 'HIGH': return '#ea580c';
    case 'MEDIUM': return '#2563eb';
    case 'POSITIVE': return '#16a34a';
    default: return '#6b7280';
  }
}

function markdownToHtml(text = '') {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hlu])(.+)/gm, '$1');
}

async function dispatchAlerts(alerts, sensitivity = 'important') {
  const sensitivityMap = { all: 0, important: 1, critical: 2 };
  const priorityRank = { POSITIVE: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  const minRank = sensitivityMap[sensitivity] ?? 1;

  for (const alert of alerts) {
    const rank = priorityRank[alert.priority] ?? 1;
    if (rank < minRank) {
      console.log(`[alerts] Skipping ${alert.priority} (below sensitivity threshold)`);
      continue;
    }

    await Promise.allSettled([sendWhatsApp(alert), sendEmail(alert)]);
  }
}

module.exports = { dispatchAlerts, sendWhatsApp, sendEmail };
