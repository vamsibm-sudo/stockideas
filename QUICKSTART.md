# Quick Start Guide

## What's Included

Your Stock Ideas Platform includes everything you need:

### ✅ Complete Components

1. **Admin Portal** (`admin.html`)
   - Simple access code login (04022026)
   - Add/edit/delete stock ideas
   - View activity logs
   - Export data for automation

2. **User View Portal** (`index.html`)
   - Browse all stocks
   - Filter by status, sector, timeframe
   - Search functionality
   - Full stock details with analysis

3. **Database** (Local JSON Files)
   - `data/stocks.json` - All stock ideas
   - `data/admin.json` - Admin credentials
   - `data/logs.json` - Activity log

4. **Automation Scripts**
   - WhatsApp sender
   - Discord bot/webhook
   - JSON/CSV export

## Stock Data Fields

Every stock idea includes:

| Field | Type | Description |
|-------|------|-------------|
| ticker | string | Stock symbol (AAPL, TSLA, etc.) |
| companyName | string | Full company name |
| currentPrice | number | Current market price |
| entryPrice | number | Recommended entry point |
| targetPrice | number | Profit-taking target |
| stopLoss | number | Risk management level |
| action | string | BUY, SELL, or HOLD |
| confidenceLevel | string | High, Medium, Low |
| sector | string | Industry category |
| timeframe | string | Short/Medium/Long-term |
| reasoning | string | Why this opportunity exists |
| riskAnalysis | string | Potential risks |
| status | string | active, closed, updated |

## Installation Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/bulls-and-bears.git
   cd bulls-and-bears
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Access in browser**:
   - Admin: http://localhost:3000/admin.html
   - User: http://localhost:3000/index.html

## Admin Access

**Access Code:** `04022026`

Simply enter the code when prompted on the login page.

⚠️ Change this immediately in production!

## Adding Stock Ideas (Admin)

1. Login to admin portal
2. Click "New Stock Idea"
3. Fill in all required fields (marked with *)
4. Click "Save Stock Idea"
5. Ideas appear instantly on user portal

## Example Stock Data

```json
{
  "ticker": "TSLA",
  "companyName": "Tesla Inc.",
  "currentPrice": 250,
  "entryPrice": 245,
  "targetPrice": 280,
  "stopLoss": 230,
  "action": "buy",
  "confidenceLevel": "high",
  "sector": "technology",
  "timeframe": "medium-term",
  "reasoning": "Recent dip presents buying opportunity. Strong Q4 guidance, positive EV trends",
  "riskAnalysis": "Regulatory concerns, competition from legacy automakers",
  "status": "active"
}
```

## Setting Up Automation

### Discord (Easiest Method - Webhook)

1. Go to your Discord server settings
2. Integrations → Webhooks → New Webhook
3. Copy the webhook URL
4. Run:
   ```powershell
   $env:DISCORD_WEBHOOK_URL="your_webhook_url_here"
   node scripts/discord-automation.js
   ```

### Discord (Bot Method)

1. Create bot at https://discord.com/developers
2. Copy bot token
3. Edit `scripts/discord-automation.js` - add your token and channel ID
4. Run: `node scripts/discord-automation.js`

### WhatsApp (Using Twilio)

1. Sign up at https://twilio.com
2. Get Account SID, Auth Token, WhatsApp number
3. Edit `scripts/whatsapp-automation.js` with credentials
4. Run: `node scripts/whatsapp-automation.js`

## API Endpoints (For Integration)

```bash
# Get all stocks
GET http://localhost:3000/api/stocks

# Get single stock
GET http://localhost:3000/api/stocks/{id}

# Export for automation
GET http://localhost:3000/api/export/stocks

# Admin login
POST http://localhost:3000/api/admin/login
Body: {"code": "04022026"}
```

## File Locations

```
StockIdeas/
├── public/
│   ├── index.html          ← User portal
│   ├── admin.html          ← Admin portal
│   ├── js/
│   │   ├── app.js          ← User logic
│   │   └── admin.js        ← Admin logic
│   └── css/
│       └── style.css
├── data/
│   ├── stocks.json         ← All stocks
│   ├── admin.json          ← Admin credentials
│   └── logs.json           ← Activity log
├── scripts/
│   ├── discord-automation.js
│   └── whatsapp-automation.js
└── server.js               ← Main server
```

## Common Tasks

### View All Stocks (Raw Data)
- Go to http://localhost:3000/api/stocks
- Save as JSON for backup

### Export for Analysis
1. Login to admin
2. Scroll to "Export Data" tab
3. Download as JSON or CSV

### Check Activity Logs
1. Login to admin
2. Click "Activity Logs" tab
3. See all logins and changes

### Reset Password
Edit `data/admin.json` - replace password hash (requires restart)

## Troubleshooting

**"Port 3000 already in use"**
```powershell
# Kill process
netstat -ano | findstr :3000
taskkill /PID [number] /F
```

**"Module not found"**
```bash
npm install
```

**"Stocks not showing"**
- Check browser console (F12)
- Clear browser cache
- Restart server

**Discord/WhatsApp not working**
- Verify API credentials
- Check bot permissions
- Check firewall

## Next Steps

1. ✅ Start the server
2. ✅ Login with admin credentials
3. ✅ Add a few sample stock ideas
4. ✅ View on user portal
5. ✅ Set up Discord/WhatsApp automation
6. ✅ Schedule daily sends via Task Scheduler

## Advanced Features

- **Search**: Filter stocks by ticker or company name
- **Status Filter**: View active, closed, or updated ideas
- **CSV Export**: Download all stocks for Excel/analysis
- **Activity Logs**: Track all admin actions
- **Real-time Updates**: Changes appear immediately

## Production Ready?

Before going live:

1. ⚠️ Change admin credentials
2. ⚠️ Change password hash in `data/admin.json`
3. ⚠️ Set up HTTPS
4. ⚠️ Add rate limiting
5. ⚠️ Backup `data/` folder regularly
6. ⚠️ Use environment variables for secrets

---

**You're all set! Happy trading!** 📈
