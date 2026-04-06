# Alma Advisor — Fully Autonomous Real-Time Claude AI Advisor

## Architecture

```
[Local Windows Machine]                    [Railway]
  monitor/index.js  ──── POST /api/relay ──▶  server/index.js
  (polls Paperclip)                           (board interface)
  (runs Claude)                               advisor.almadigitaldesigns.com
  (sends alerts)
```

## Quick Start

### 1. Install dependencies
```bash
cd C:\Users\r_pan\alma-advisor
npm install
```

### 2. Configure environment
```bash
copy .env.example .env
# Edit .env with your credentials
```

Required env vars:
- `PAPERCLIP_API_KEY` — your Paperclip API key
- `PAPERCLIP_COMPANY_ID` — your company ID
- `ANTHROPIC_API_KEY` — your Anthropic API key
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `BOARD_WHATSAPP_NUMBER`
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `BOARD_EMAIL`
- `RELAY_URL` — your Railway server URL + `/api/relay` (e.g. `https://advisor.almadigitaldesigns.com/api/relay`)
- `RELAY_SECRET` — random secret shared between monitor and server

### 3. Deploy to Railway

1. Push this repo to GitHub
2. Create a new Railway project from the repo
3. Set all env vars in Railway (everything except `PAPERCLIP_API_URL` which is only needed locally)
4. Set `PORT=3000` (Railway sets this automatically)
5. Railway will auto-deploy using `railway.json`
6. Set DNS: `advisor.almadigitaldesigns.com` → Railway domain

### 4. Install local monitor (Windows)

Run PowerShell as Administrator:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\setup-windows.ps1
```

This registers a Windows Task Scheduler task that:
- Starts automatically at logon
- Restarts if it crashes (3 retries, 5 min interval)
- Runs with elevated privileges

### 5. Test

Check monitor health:
```
http://127.0.0.1:3099/health
```

Check board interface:
```
https://advisor.almadigitaldesigns.com
```

Trigger a test alert by asking Claude directly:
```bash
curl -X POST https://advisor.almadigitaldesigns.com/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the top 3 things I should focus on today?"}'
```

## Gmail OAuth2 Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project and enable Gmail API
3. Create OAuth 2.0 credentials (Desktop app type)
4. Use [OAuth Playground](https://developers.google.com/oauthplayground) to get refresh token:
   - Authorize `https://mail.google.com/`
   - Exchange auth code for tokens
   - Copy the refresh token to your `.env`

## Twilio WhatsApp Setup

1. Sign up at twilio.com
2. Activate WhatsApp Sandbox or a production number
3. Set `TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886` (sandbox) or your number
4. Set `BOARD_WHATSAPP_NUMBER=whatsapp:+44...` (your phone)
5. For sandbox: send "join [sandbox-code]" to the Twilio number from your phone first

## Alert Sensitivity

| Setting | What you get |
|---------|-------------|
| `all` | Every alert including MEDIUM and POSITIVE |
| `important` | HIGH and CRITICAL only |
| `critical` | CRITICAL only |

Set via the board interface or `ALERT_SENSITIVITY` env var.
