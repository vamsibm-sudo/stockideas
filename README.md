# Stock Ideas Platform

A complete web platform for posting, viewing, and automating stock investment ideas with Admin portal, User view portal, and WhatsApp/Discord automation.

## Features

✅ **Admin Portal**
- Secure login system
- Post new stock ideas
- Edit and delete stock ideas
- View activity logs
- Export data (JSON/CSV)

✅ **User View Portal**
- Browse all stock ideas
- Filter by status, timeframe, sector
- Search functionality
- View detailed stock information

✅ **Automation Scripts**
- WhatsApp integration for broadcasting
- Discord bot/webhook support
- JSON/CSV export for custom integrations

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: HTML/CSS/JavaScript
- **Database**: Local JSON files (no database required)
- **Automation**: Node.js scripts

## Installation

### Prerequisites
- Node.js v14+ installed
- npm package manager

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/bulls-and-bears.git
cd bulls-and-bears
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

The platform will be running at:
- **Admin Portal**: http://localhost:3000/admin.html
- **User View**: http://localhost:3000/index.html

## Default Admin Access

**Access Code:** `04022026`

⚠️ **Important**: Change the access code in production!

## Data Structure

### Stock Idea Object

```json
{
  "id": "unique_id",
  "ticker": "AAPL",
  "companyName": "Apple Inc.",
  "currentPrice": 150.25,
  "entryPrice": 145.00,
  "targetPrice": 180.00,
  "stopLoss": 135.00,
  "action": "buy",
  "confidenceLevel": "high",
  "sector": "technology",
  "timeframe": "medium-term",
  "reasoning": "Strong Q4 earnings, positive guidance...",
  "riskAnalysis": "Potential trade war impact...",
  "status": "active",
  "createdAt": "2026-04-01T00:00:00.000Z",
  "updatedAt": "2026-04-01T00:00:00.000Z"
}
```

## API Endpoints

### Authentication
- `POST /api/admin/login` - Admin login

### Stock Ideas (Public)
- `GET /api/stocks` - Get all stocks
- `GET /api/stocks/:id` - Get single stock

### Stock Management (Admin Only)
- `POST /api/admin/stocks` - Create new stock
- `PUT /api/admin/stocks/:id` - Update stock
- `DELETE /api/admin/stocks/:id` - Delete stock

### Export & Logs
- `GET /api/export/stocks` - Export all stocks
- `GET /api/admin/logs` - View activity logs

## Automation Scripts

### WhatsApp Integration

1. **Setup Twilio**:
   - Create a Twilio account (twilio.com)
   - Get your Account SID, Auth Token, and WhatsApp number
   - Update `scripts/whatsapp-automation.js` with your credentials

2. **Run Script**:
```bash
node scripts/whatsapp-automation.js
```

### Discord Integration

#### Option 1: Using Discord Bot

1. **Create Bot**:
   - Go to https://discord.com/developers/applications
   - Create new application
   - Create bot user
   - Copy bot token
   - Set permissions: Send Messages, Embed Links

2. **Install discord.js**:
```bash
npm install discord.js
```

3. **Update Configuration:**
   - Update `scripts/discord-automation.js` with your bot token and channel ID

4. **Run Script**:
```bash
node scripts/discord-automation.js
```

#### Option 2: Using Discord Webhook (Simpler)

1. **Create Webhook**:
   - In Discord server settings → Integrations → Webhooks
   - Create new webhook, copy URL

2. **Run Script**:
```bash
set DISCORD_WEBHOOK_URL=your_webhook_url
node scripts/discord-automation.js
```

Or on PowerShell:
```powershell
$env:DISCORD_WEBHOOK_URL="your_webhook_url"
node scripts/discord-automation.js
```

## File Structure

```
StockIdeas/
├── public/
│   ├── index.html          # User view portal
│   ├── admin.html          # Admin portal
│   ├── css/
│   │   └── style.css       # All styles
│   └── js/
│       ├── app.js          # User portal logic
│       └── admin.js        # Admin portal logic
├── data/
│   ├── stocks.json         # Stock ideas storage
│   ├── admin.json          # Admin credentials
│   └── logs.json           # Activity logs
├── scripts/
│   ├── whatsapp-automation.js
│   └── discord-automation.js
├── server.js               # Express server
├── package.json
└── README.md
```

## Stock Statuses

- **active** - Currently valid and being tracked
- **closed** - Trade completed, no longer active
- **updated** - Recently updated with new information

## Confidence Levels

- **High** (85-100%) - Strong technical & fundamental support
- **Medium** (60-85%) - Good but some risks present
- **Low** (40-60%) - Speculative idea with significant risks

## Timeframes

- **Short-term** (< 1 month) - Fast trades
- **Medium-term** (1-3 months) - Swing trades
- **Long-term** (> 3 months) - Position trades

## Sectors

Available sectors: Technology, Healthcare, Finance, Energy, Consumer, Industrial, Real Estate, Utilities, Materials, Communications

## Scheduling Automation

### Windows Task Scheduler

1. Open Task Scheduler
2. Create Basic Task
3. Add trigger (e.g., daily at 9:00 AM)
4. Action: Start a program
5. Program: `node`
6. Arguments: `scripts/discord-automation.js` (relative to project root)

### Cron (Linux/Mac)

```bash
# Daily at 9 AM
0 9 * * * cd /path/to/StockIdeas && node scripts/discord-automation.js

# Every 6 hours
0 */6 * * * cd /path/to/StockIdeas && node scripts/whatsapp-automation.js
```

## Security Notes

1. **Change Access Code**: Update the admin access code immediately
2. **Use Environment Variables**: Store API keys in `.env` file (not in code)
3. **HTTPS**: Use HTTPS in production
4. **Rate Limiting**: Add rate limiting for API endpoints
5. **Data Validation**: Validate all inputs on backend
6. **Backup Data**: Regularly backup the `data/` folder

## Troubleshooting

**Port 3000 already in use?**
```bash
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Can't connect to Discord/WhatsApp?**
- Check API credentials
- Verify bot permissions
- Check firewall/network settings

**Stocks not showing?**
- Check if `data/stocks.json` exists
- Check browser console for errors
- Clear browser cache

## Future Enhancements

- [ ] Email notifications
- [ ] Real-time price updates
- [ ] Telegram integration
- [ ] Advanced analytics & backtesting
- [ ] User accounts & watchlists
- [ ] Database (PostgreSQL/MongoDB)
- [ ] Mobile app
- [ ] 2FA authentication

## License

MIT License - Feel free to modify and use!

## Support

For issues or questions, check the logs in `data/logs.json` or browser console.

---

**Happy Trading!** 📈
