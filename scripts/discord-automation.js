/**
 * Discord Automation Script
 * Send stock ideas to Discord channels using Discord Bot
 * 
 * Requirements:
 * - npm install discord.js
 * - Discord Bot Token (create bot at https://discord.com/developers/applications)
 * - Bot must have permission to send messages in target channel
 */

const fs = require('fs');
const path = require('path');

// Discord Configuration
const DISCORD_CONFIG = {
    botToken: 'your_discord_bot_token',
    channelId: 'your_channel_id',
    guildId: 'your_guild_id' // Server ID
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

// Format stock idea for Discord embed
function formatStockForDiscord(stock) {
    const colorMap = {
        'buy': 0x10b981,      // Green
        'sell': 0xef4444,     // Red
        'hold': 0xf59e0b      // Yellow
    };

    const confidenceColors = {
        'high': 0x10b981,
        'medium': 0xf59e0b,
        'low': 0xef4444
    };

    return {
        title: `${stock.ticker} - ${stock.companyName}`,
        description: stock.reasoning,
        color: colorMap[stock.action.toLowerCase()] || 0x3b82f6,
        fields: [
            {
                name: '📊 Action',
                value: stock.action.toUpperCase(),
                inline: true
            },
            {
                name: '💰 Entry Price',
                value: `$${parseFloat(stock.entryPrice).toFixed(2)}`,
                inline: true
            },
            {
                name: '🚀 Target Price',
                value: `$${parseFloat(stock.targetPrice).toFixed(2)}`,
                inline: true
            },
            {
                name: '🛑 Stop Loss',
                value: `$${parseFloat(stock.stopLoss).toFixed(2)}`,
                inline: true
            },
            {
                name: '📈 Current Price',
                value: `$${parseFloat(stock.currentPrice).toFixed(2)}`,
                inline: true
            },
            {
                name: '🎯 Potential Gain',
                value: `${((parseFloat(stock.targetPrice) - parseFloat(stock.entryPrice)) / parseFloat(stock.entryPrice) * 100).toFixed(2)}%`,
                inline: true
            },
            {
                name: '📊 Sector',
                value: stock.sector,
                inline: true
            },
            {
                name: '⏱️ Timeframe',
                value: stock.timeframe,
                inline: true
            },
            {
                name: '📊 Confidence',
                value: stock.confidenceLevel.toUpperCase(),
                inline: true
            },
            {
                name: '⚠️ Risk Analysis',
                value: stock.riskAnalysis || 'Standard market risk',
                inline: false
            }
        ],
        footer: {
            text: `Status: ${stock.status.toUpperCase()} | Updated: ${new Date(stock.updatedAt).toLocaleDateString()}`
        },
        timestamp: new Date(stock.updatedAt).toISOString()
    };
}

// Send to Discord (using discord.js)
async function sendToDiscordWithLib() {
    try {
        const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
        const client = new Client({ intents: [GatewayIntentBits.Guilds] });

        client.once('ready', async () => {
            console.log(`✅ Logged in as ${client.user.tag}`);

            const channel = await client.channels.fetch(DISCORD_CONFIG.channelId);
            if (!channel) {
                console.error('Channel not found');
                client.destroy();
                return;
            }

            const stocks = getStockIdeas();
            
            for (const stock of stocks) {
                try {
                    const embedData = formatStockForDiscord(stock);
                    const embed = new EmbedBuilder()
                        .setTitle(embedData.title)
                        .setDescription(embedData.description)
                        .setColor(embedData.color)
                        .setFields(embedData.fields)
                        .setFooter(embedData.footer)
                        .setTimestamp(new Date(embedData.timestamp));

                    await channel.send({ embeds: [embed] });
                    console.log(`✅ Sent: ${stock.ticker}`);

                    // Rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`❌ Error sending ${stock.ticker}:`, error);
                }
            }

            client.destroy();
            console.log('Discord broadcast complete!');
        });

        client.login(DISCORD_CONFIG.botToken);
    } catch (error) {
        console.error('Discord integration error:', error);
        console.log('Make sure discord.js is installed: npm install discord.js');
    }
}

// Send to Discord using webhook (simpler alternative)
async function sendToDiscordWithWebhook(webhookUrl) {
    const stocks = getStockIdeas();

    for (const stock of stocks) {
        try {
            const embedData = formatStockForDiscord(stock);

            const payload = {
                username: '📈 Stock Ideas Bot',
                avatar_url: 'https://cdn-icons-png.flaticon.com/512/3050/3050159.png',
                embeds: [embedData]
            };

            const options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            };

            const response = await fetch(webhookUrl, options);
            if (response.ok) {
                console.log(`✅ Sent: ${stock.ticker}`);
            } else {
                console.error(`❌ Failed to send ${stock.ticker}`);
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`Error sending ${stock.ticker}:`, error);
        }
    }

    console.log('Discord webhook broadcast complete!');
}

// Main function
async function sendStockIdeasToDiscord(useWebhook = false, webhookUrl = null) {
    console.log('Starting Discord broadcast...');

    if (useWebhook && webhookUrl) {
        await sendToDiscordWithWebhook(webhookUrl);
    } else {
        await sendToDiscordWithLib();
    }
}

// Export for scheduling
module.exports = {
    getStockIdeas,
    formatStockForDiscord,
    sendToDiscordWithLib,
    sendToDiscordWithWebhook,
    sendStockIdeasToDiscord
};

// Run if executed directly
if (require.main === module) {
    // Use webhook method (simpler):
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (webhook) {
        sendStockIdeasToDiscord(true, webhook);
    } else {
        // Use bot method:
        sendStockIdeasToDiscord();
    }
}
