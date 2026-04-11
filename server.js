require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fetch = require('node-fetch');
const { Pool } = require('pg');
const pgSession = require('connect-pg-simple')(session);
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const app = express();
const PORT = process.env.PORT || 3000;

// ─── PostgreSQL pool ──────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ─── DB init: create tables if they don't exist ───────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trades (
      id               TEXT PRIMARY KEY,
      ticker           TEXT NOT NULL,
      company_name     TEXT,
      direction        TEXT,
      entry_price      NUMERIC,
      stop_loss        NUMERIC,
      remaining_percent NUMERIC DEFAULT 100,
      targets          JSONB DEFAULT '[]',
      sector           TEXT,
      confidence_level TEXT,
      timeframe        TEXT,
      reasoning        TEXT,
      risk_analysis    TEXT,
      status           TEXT DEFAULT 'open',
      actions          JSONB DEFAULT '[]',
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('DB ready');
}

// ─── DB helpers ───────────────────────────────────────────────
function rowToTrade(row) {
  return {
    id:               row.id,
    ticker:           row.ticker,
    companyName:      row.company_name,
    direction:        row.direction,
    entryPrice:       parseFloat(row.entry_price),
    stopLoss:         parseFloat(row.stop_loss),
    remainingPercent: parseFloat(row.remaining_percent),
    targets:          row.targets,
    sector:           row.sector,
    confidenceLevel:  row.confidence_level,
    timeframe:        row.timeframe,
    reasoning:        row.reasoning,
    riskAnalysis:     row.risk_analysis,
    status:           row.status,
    actions:          row.actions,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at
  };
}

async function getTrades() {
  const { rows } = await pool.query('SELECT * FROM trades ORDER BY created_at DESC');
  return rows.map(rowToTrade);
}

async function getTrade(id) {
  const { rows } = await pool.query('SELECT * FROM trades WHERE id = $1', [id]);
  return rows.length ? rowToTrade(rows[0]) : null;
}

async function createTrade(t) {
  const { rows } = await pool.query(
    `INSERT INTO trades
      (id, ticker, company_name, direction, entry_price, stop_loss, remaining_percent,
       targets, sector, confidence_level, timeframe, reasoning, risk_analysis,
       status, actions, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      t.id, t.ticker, t.companyName, t.direction,
      t.entryPrice, t.stopLoss, t.remainingPercent,
      JSON.stringify(t.targets),
      t.sector, t.confidenceLevel, t.timeframe, t.reasoning, t.riskAnalysis,
      t.status, JSON.stringify(t.actions),
      t.createdAt, t.updatedAt
    ]
  );
  return rowToTrade(rows[0]);
}

async function updateTrade(id, fields) {
  const { rows } = await pool.query(
    `UPDATE trades SET
      ticker           = $2,
      company_name     = $3,
      direction        = $4,
      entry_price      = $5,
      stop_loss        = $6,
      remaining_percent = $7,
      targets          = $8,
      sector           = $9,
      confidence_level = $10,
      timeframe        = $11,
      reasoning        = $12,
      risk_analysis    = $13,
      status           = $14,
      actions          = $15,
      updated_at       = $16
     WHERE id = $1
     RETURNING *`,
    [
      id,
      fields.ticker, fields.companyName, fields.direction,
      fields.entryPrice, fields.stopLoss, fields.remainingPercent,
      JSON.stringify(fields.targets),
      fields.sector, fields.confidenceLevel, fields.timeframe,
      fields.reasoning, fields.riskAnalysis,
      fields.status, JSON.stringify(fields.actions),
      new Date().toISOString()
    ]
  );
  return rows.length ? rowToTrade(rows[0]) : null;
}

async function deleteTrade(id) {
  await pool.query('DELETE FROM trades WHERE id = $1', [id]);
}

// ─── Discord channel notifications ───────────────────────────
const NOTIFY_CHANNEL = process.env.DISCORD_NOTIFY_CHANNEL;

const ACTION_COLORS = {
  open:          0x57F287, // green
  add_position:  0x5865F2, // blurple
  partial_close: 0xFEE75C, // yellow
  full_close:    0xED4245, // red
};

async function notifyDiscord(embed) {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('Discord notify: DISCORD_BOT_TOKEN not set');
    return;
  }
  if (!NOTIFY_CHANNEL) {
    console.error('Discord notify: DISCORD_NOTIFY_CHANNEL not set');
    return;
  }
  try {
    const r = await fetch(`https://discord.com/api/channels/${NOTIFY_CHANNEL}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ embeds: [embed] })
    });
    if (!r.ok) {
      const body = await r.text();
      console.error(`Discord notify failed: ${r.status} ${r.statusText} — ${body}`);
    }
  } catch (err) {
    console.error('Discord notify error:', err.message);
  }
}

function tradeEmbed(type, trade, action) {
  const dirEmoji = trade.direction === 'BUY' ? '🟢' : '🔴';
  const titles = {
    open:          `${dirEmoji} New Trade Opened — ${trade.ticker}`,
    add_position:  `📈 DCA Added — ${trade.ticker}`,
    partial_close: `✂️ Partial Close — ${trade.ticker}`,
    full_close:    `🏁 Trade Closed — ${trade.ticker}`,
  };

  const fields = [
    { name: 'Company',   value: trade.companyName || trade.ticker, inline: true },
    { name: 'Direction', value: trade.direction,                   inline: true },
    { name: 'Entry',     value: `$${trade.entryPrice}`,            inline: true },
  ];

  if (type === 'open') {
    if (trade.stopLoss)  fields.push({ name: 'Stop Loss', value: `$${trade.stopLoss}`, inline: true });
    if (trade.targets?.length) fields.push({ name: 'Targets', value: trade.targets.map(t => `$${t}`).join(' → '), inline: true });
    if (trade.confidenceLevel) fields.push({ name: 'Confidence', value: trade.confidenceLevel, inline: true });
    if (trade.timeframe)       fields.push({ name: 'Timeframe',  value: trade.timeframe,        inline: true });
    if (trade.sector)          fields.push({ name: 'Sector',     value: trade.sector,           inline: true });
    if (trade.reasoning)       fields.push({ name: 'Reasoning',  value: trade.reasoning,        inline: false });
  }

  if (type === 'add_position' && action) {
    fields.push({ name: 'Buy Price',  value: `$${action.price}`,        inline: true });
    fields.push({ name: 'Size Added', value: `${action.percentAdded}%`, inline: true });
    fields.push({ name: 'New Avg Entry', value: `$${trade.entryPrice}`, inline: true });
  }

  if ((type === 'partial_close' || type === 'full_close') && action) {
    fields.push({ name: 'Exit Price', value: `$${action.price}`,         inline: true });
    fields.push({ name: '% Closed',  value: `${action.percentClosed}%`, inline: true });
    const dir = trade.direction === 'BUY' ? 1 : -1;
    const pnl = (dir * (action.price - trade.entryPrice) / trade.entryPrice * 100).toFixed(2);
    fields.push({ name: 'P&L on close', value: `${pnl > 0 ? '+' : ''}${pnl}%`, inline: true });
  }

  if (action?.note) fields.push({ name: 'Note', value: action.note, inline: false });

  return {
    title: titles[type] || type,
    color: ACTION_COLORS[type] || 0x99AAB5,
    fields,
    footer: { text: 'Bulls & Bears' },
    timestamp: new Date().toISOString()
  };
}

// ─── Price cache (5 min TTL) ──────────────────────────────────
const priceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getCurrentPrice(ticker) {
  const cached = priceCache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.price;
  try {
    const quote = await yahooFinance.quote(ticker);
    const price = quote.regularMarketPrice ?? null;
    priceCache.set(ticker, { price, ts: Date.now() });
    return price;
  } catch {
    return null;
  }
}

// ─── P&L calculation ─────────────────────────────────────────
function calcPnL(trade, currentPrice) {
  const dir = trade.direction === 'BUY' ? 1 : -1;
  const entry = trade.entryPrice;

  const closeActions = trade.actions.filter(
    a => a.type === 'partial_close' || a.type === 'full_close'
  );

  let realizedPnL = null;
  let closedPercent = 0;

  if (closeActions.length > 0) {
    realizedPnL = 0;
    closeActions.forEach(a => {
      const actionPnL = dir * (a.price - entry) / entry * 100;
      realizedPnL += actionPnL * (a.percentClosed / 100);
      closedPercent += a.percentClosed;
    });
  }

  const remainingPercent = 100 - closedPercent;
  const openPnL =
    remainingPercent > 0 && currentPrice != null
      ? dir * (currentPrice - entry) / entry * 100
      : null;

  return { realizedPnL, openPnL, closedPercent, remainingPercent };
}

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static('public'));

// ─── Passport / Discord OAuth2 ────────────────────────────────
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
  scope: ['identify', 'guilds.members.read']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const res = await fetch(
      `https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) return done(null, false);

    const member = await res.json();
    const isMod    = member.roles.includes(process.env.DISCORD_MOD_ROLE_ID);
    const isMember = member.roles.includes(process.env.DISCORD_REQUIRED_ROLE_ID);

    if (!isMod && !isMember) return done(null, false);

    return done(null, { id: profile.id, username: profile.username, isMod });
  } catch (err) {
    return done(err);
  }
}));

// ─── Auth middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Authentication required' });
}

function requireMod(req, res, next) {
  if (req.isAuthenticated() && req.user.isMod) return next();
  res.status(403).json({ error: 'Moderator access required' });
}

// ─── Auth routes ──────────────────────────────────────────────
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/?auth_error=1' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(err => { if (err) console.error(err); res.redirect('/'); });
});

app.get('/api/auth/me', (req, res) => {
  if (req.isAuthenticated()) res.json({ user: req.user });
  else res.status(401).json({ error: 'Not authenticated' });
});

// ─── Trades routes ────────────────────────────────────────────

// GET all trades — inject live prices + P&L
app.get('/api/trades', requireAuth, async (req, res) => {
  const trades = await getTrades();

  const openTickers = [...new Set(
    trades.filter(t => t.status !== 'closed').map(t => t.ticker)
  )];

  const prices = {};
  await Promise.all(openTickers.map(async ticker => {
    prices[ticker] = await getCurrentPrice(ticker);
  }));

  const enriched = trades.map(trade => {
    const currentPrice = trade.status !== 'closed' ? (prices[trade.ticker] ?? null) : null;
    const pnl = calcPnL(trade, currentPrice);
    return { ...trade, currentPrice, ...pnl };
  });

  res.json(enriched);
});

// POST create trade (mods only)
app.post('/api/trades', requireMod, async (req, res) => {
  const { ticker, companyName, direction, entryPrice, stopLoss, targets,
          sector, confidenceLevel, timeframe, reasoning, riskAnalysis } = req.body;

  const now = new Date().toISOString();
  const newTrade = {
    id: crypto.randomBytes(8).toString('hex'),
    ticker: ticker.toUpperCase().trim(),
    companyName,
    direction,
    entryPrice: parseFloat(entryPrice),
    stopLoss: parseFloat(stopLoss),
    remainingPercent: 100,
    targets: targets.map(t => parseFloat(t)),
    sector:          sector          || '',
    confidenceLevel: confidenceLevel || '',
    timeframe:       timeframe       || '',
    reasoning:       reasoning       || '',
    riskAnalysis:    riskAnalysis    || '',
    status: 'open',
    actions: [{
      id: crypto.randomBytes(4).toString('hex'),
      type: 'open',
      price: parseFloat(entryPrice),
      percentClosed: 0,
      note: reasoning || '',
      date: now
    }],
    createdAt: now,
    updatedAt: now
  };

  const saved = await createTrade(newTrade);
  notifyDiscord(tradeEmbed('open', saved, saved.actions[0]));
  res.status(201).json(saved);
});

// PUT update trade details (mods only)
app.put('/api/trades/:id', requireMod, async (req, res) => {
  const trade = await getTrade(req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  const { ticker, companyName, direction, entryPrice, stopLoss, targets,
          sector, confidenceLevel, timeframe, reasoning, riskAnalysis } = req.body;

  const openAction = trade.actions.find(a => a.type === 'open');
  if (openAction) openAction.price = parseFloat(entryPrice);

  const updated = await updateTrade(req.params.id, {
    ...trade,
    ticker: ticker.toUpperCase().trim(),
    companyName,
    direction,
    entryPrice: parseFloat(entryPrice),
    stopLoss: parseFloat(stopLoss),
    targets: targets.map(t => parseFloat(t)),
    sector:          sector          || '',
    confidenceLevel: confidenceLevel || '',
    timeframe:       timeframe       || '',
    reasoning:       reasoning       || '',
    riskAnalysis:    riskAnalysis    || ''
  });

  res.json(updated);
});

// DELETE trade (mods only)
app.delete('/api/trades/:id', requireMod, async (req, res) => {
  const trade = await getTrade(req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  await deleteTrade(req.params.id);
  res.json({ success: true });
});

// POST add action (partial/full close / DCA) to a trade (mods only)
app.post('/api/trades/:id/actions', requireMod, async (req, res) => {
  const trade = await getTrade(req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  const { type, price, percentClosed, note } = req.body;

  // ── DCA: add to position ──────────────────────────────────
  if (type === 'add_position') {
    const addPct   = Math.max(1, parseFloat(percentClosed) || 50);
    const totalPct = trade.remainingPercent + addPct;
    const newAvgEntry =
      (trade.remainingPercent * trade.entryPrice + addPct * parseFloat(price)) / totalPct;

    trade.actions.push({
      id: crypto.randomBytes(4).toString('hex'),
      type: 'add_position',
      price: parseFloat(price),
      percentAdded: addPct,
      percentClosed: 0,
      note: note || '',
      date: new Date().toISOString()
    });

    trade.entryPrice       = parseFloat(newAvgEntry.toFixed(4));
    trade.remainingPercent = totalPct;

    const updated = await updateTrade(trade.id, trade);
    const addedAction = updated.actions[updated.actions.length - 1];
    notifyDiscord(tradeEmbed('add_position', updated, addedAction));
    return res.json(updated);
  }

  // ── Partial / full close ──────────────────────────────────
  const alreadyClosed = trade.actions
    .filter(a => a.type === 'partial_close' || a.type === 'full_close')
    .reduce((sum, a) => sum + a.percentClosed, 0);

  const remaining = 100 - alreadyClosed;
  if (remaining <= 0) return res.status(400).json({ error: 'Trade is already fully closed' });

  const pctClosed = type === 'full_close'
    ? remaining
    : Math.min(parseFloat(percentClosed), remaining);

  trade.actions.push({
    id: crypto.randomBytes(4).toString('hex'),
    type,
    price: parseFloat(price),
    percentClosed: pctClosed,
    note: note || '',
    date: new Date().toISOString()
  });

  const newClosed = alreadyClosed + pctClosed;
  trade.status = newClosed >= 100 ? 'closed' : 'partial';

  const updated = await updateTrade(trade.id, trade);
  const closedAction = updated.actions[updated.actions.length - 1];
  notifyDiscord(tradeEmbed(type, updated, closedAction));
  res.json(updated);
});

// GET ticker info (company name, current price, sector)
app.get('/api/ticker-info/:ticker', requireAuth, async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const [quote, summary] = await Promise.all([
      yahooFinance.quote(ticker),
      yahooFinance.quoteSummary(ticker, { modules: ['assetProfile'] }).catch(() => null)
    ]);
    res.json({
      companyName:  quote.shortName || quote.longName || null,
      currentPrice: quote.regularMarketPrice || null,
      sector:       summary?.assetProfile?.sector || null
    });
  } catch {
    res.status(404).json({ error: 'Ticker not found' });
  }
});

// ─── Start ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nBulls&Bears running on http://localhost:${PORT}`);
    console.log(`On your local network: http://<your-pc-ip>:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialize DB:', err);
  process.exit(1);
});
