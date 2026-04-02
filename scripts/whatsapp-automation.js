/**
 * WhatsApp Automation Script
 * Format and send stock ideas to WhatsApp groups/chats
 * 
 * Requirements:
 * - WhatsApp Business API or Twilio integration
 * - npm install twilio (if using Twilio)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const WHATSAPP_CONFIG = {
    // Using Twilio example - replace with your credentials
    accountSid: 'your_account_sid',
    authToken: 'your_auth_token',
    fromNumber: 'whatsapp:+1234567890', // Your WhatsApp Business Number
    toNumber: 'whatsapp:+1234567890'    // Recipient number
};

// Fetch stock data
function getStockIdeas() {
    try {
        const stocksFile = path.join(__dirname, '..', 'data', 'stocks.json');
        const data = fs.readFileSync(stocksFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading stock data:', error);
        return [];
    }
}

// Format stock idea for WhatsApp
function formatStockForWhatsApp(stock) {
    return `
📈 *${stock.ticker}* - ${stock.companyName}

🎯 *Action:* ${stock.action.toUpperCase()}
💰 *Entry Price:* $${parseFloat(stock.entryPrice).toFixed(2)}
🚀 *Target Price:* $${parseFloat(stock.targetPrice).toFixed(2)}
🛑 *Stop Loss:* $${parseFloat(stock.stopLoss).toFixed(2)}

📊 *Sector:* ${stock.sector}
⏱️ *Timeframe:* ${stock.timeframe}
📊 *Confidence:* ${stock.confidenceLevel}

💡 *Reasoning:*
${stock.reasoning}

⚠️ *Risk Analysis:*
${stock.riskAnalysis || 'Standard market risk'}

---
Status: ${stock.status.toUpperCase()} | Updated: ${new Date(stock.updatedAt).toLocaleDateString()}
    `.trim();
}

// Send to WhatsApp (Twilio example)
async function sendToWhatsApp(message) {
    try {
        // Using Twilio
        const AccountSid = WHATSAPP_CONFIG.accountSid;
        const AuthToken = WHATSAPP_CONFIG.authToken;

        const postData = new URLSearchParams({
            From: WHATSAPP_CONFIG.fromNumber,
            To: WHATSAPP_CONFIG.toNumber,
            Body: message
        });

        const options = {
            hostname: 'api.twilio.com',
            path: `/2010-04-01/Accounts/${AccountSid}/Messages.json`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.toString().length,
                'Authorization': 'Basic ' + Buffer.from(`${AccountSid}:${AuthToken}`).toString('base64')
            }
        };

        return new Promise((resolve, reject) => {
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 201) {
                        resolve({ success: true, data: JSON.parse(data) });
                    } else {
                        reject({ error: 'Failed to send message', status: res.statusCode });
                    }
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        throw error;
    }
}

// Main function
async function sendStockIdeasToWhatsApp(options = {}) {
    const stocks = getStockIdeas();
    
    if (stocks.length === 0) {
        console.log('No stock ideas to send');
        return;
    }

    const recentStocks = options.recentOnly 
        ? stocks.filter(s => {
            const createdDate = new Date(s.createdAt);
            const daysDiff = (new Date() - createdDate) / (1000 * 60 * 60 * 24);
            return daysDiff < 1; // Last 24 hours
        })
        : stocks;

    if (recentStocks.length === 0) {
        console.log('No new stock ideas to send');
        return;
    }

    console.log(`Sending ${recentStocks.length} stock idea(s) to WhatsApp...`);

    // Send each stock
    for (const stock of recentStocks) {
        const message = formatStockForWhatsApp(stock);
        
        try {
            const result = await sendToWhatsApp(message);
            console.log(`✅ Sent: ${stock.ticker} - ${result.data.sid}`);
        } catch (error) {
            console.error(`❌ Failed to send ${stock.ticker}:`, error);
        }

        // Rate limiting - avoid spam
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('WhatsApp broadcast complete!');
}

// Export for scheduling
module.exports = {
    getStockIdeas,
    formatStockForWhatsApp,
    sendToWhatsApp,
    sendStockIdeasToWhatsApp
};

// Run if executed directly
if (require.main === module) {
    sendStockIdeasToWhatsApp({ recentOnly: true });
}
