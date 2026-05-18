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
      created_by       TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS challenges (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT,
      starting_balance  NUMERIC NOT NULL,
      target_balance    NUMERIC NOT NULL,
      current_balance   NUMERIC NOT NULL,
      status            TEXT DEFAULT 'active',
      start_date        DATE,
      end_date          DATE,
      created_by        TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS challenge_trades (
      id             TEXT PRIMARY KEY,
      challenge_id   TEXT REFERENCES challenges(id) ON DELETE CASCADE,
      ticker         TEXT NOT NULL,
      direction      TEXT,
      strike         NUMERIC,
      expiry_date    DATE,
      premium        NUMERIC,
      contracts      INTEGER DEFAULT 1,
      stop_loss      NUMERIC,
      target         NUMERIC,
      reasoning      TEXT,
      status         TEXT DEFAULT 'open',
      exit_premium   NUMERIC,
      exit_date      TIMESTAMPTZ,
      realized_pnl_dollar NUMERIC,
      realized_pnl_pct    NUMERIC,
      created_by     TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS options_trades (
      id           TEXT PRIMARY KEY,
      ticker       TEXT NOT NULL,
      direction    TEXT,
      strike       NUMERIC,
      expiry_date  DATE,
      premium      NUMERIC,
      contracts    INTEGER DEFAULT 1,
      stop_loss    NUMERIC,
      target       NUMERIC,
      reasoning    TEXT,
      status       TEXT DEFAULT 'open',
      exit_premium NUMERIC,
      exit_date    TIMESTAMPTZ,
      created_by   TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
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
    createdBy:        row.created_by,
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
       status, actions, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      t.id, t.ticker, t.companyName, t.direction,
      t.entryPrice, t.stopLoss, t.remainingPercent,
      JSON.stringify(t.targets),
      t.sector, t.confidenceLevel, t.timeframe, t.reasoning, t.riskAnalysis,
      t.status, JSON.stringify(t.actions),
      t.createdBy, t.createdAt, t.updatedAt
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
      updated_at       = $16,
      created_by       = $17
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
      new Date().toISOString(),
      fields.createdBy
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

async function notifyDiscord(embed, webhookUrl) {
  if (!webhookUrl) return;
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
    if (!r.ok) {
      const body = await r.text();
      console.error(`Webhook notify failed: ${r.status} — ${body}`);
    }
  } catch (err) {
    console.error('Webhook notify error:', err.message);
  }
}

function tradeEmbed(type, trade, action, username) {
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
  if (username)     fields.push({ name: 'Posted by', value: username, inline: true });

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

    const displayName = profile.global_name || profile.displayName || profile.username;
    return done(null, { id: profile.id, username: profile.username, displayName, isMod });
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
    createdBy: req.user.displayName || req.user.username,
    createdAt: now,
    updatedAt: now
  };

  const saved = await createTrade(newTrade);
  notifyDiscord(tradeEmbed('open', saved, saved.actions[0], req.user.displayName), process.env.DISCORD_WEBHOOK_STOCKS);
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
    notifyDiscord(tradeEmbed('add_position', updated, addedAction, req.user.displayName), process.env.DISCORD_WEBHOOK_STOCKS);
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
  notifyDiscord(tradeEmbed(type, updated, closedAction, req.user.displayName), process.env.DISCORD_WEBHOOK_STOCKS);
  res.json(updated);
});

// PATCH claim trade authorship (mods only, only if createdBy is null)
app.patch('/api/trades/:id/claim', requireMod, async (req, res) => {
  const trade = await getTrade(req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  const name = req.user.displayName || req.user.username;
  await pool.query('UPDATE trades SET created_by = $1 WHERE id = $2', [name, req.params.id]);
  res.json({ success: true, createdBy: name });
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

// ─── Challenges routes ────────────────────────────────────────

function rowToChallenge(row) {
  return {
    id:              row.id,
    name:            row.name,
    description:     row.description,
    startingBalance: parseFloat(row.starting_balance),
    targetBalance:   parseFloat(row.target_balance),
    currentBalance:  parseFloat(row.current_balance),
    status:          row.status,
    startDate:       row.start_date,
    endDate:         row.end_date,
    createdBy:       row.created_by,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at
  };
}

function rowToChallengeTrade(row) {
  return {
    id:               row.id,
    challengeId:      row.challenge_id,
    ticker:           row.ticker,
    direction:        row.direction,
    strike:           parseFloat(row.strike),
    expiryDate:       row.expiry_date,
    premium:          parseFloat(row.premium),
    contracts:        parseInt(row.contracts),
    stopLoss:         row.stop_loss   ? parseFloat(row.stop_loss)  : null,
    target:           row.target      ? parseFloat(row.target)     : null,
    reasoning:        row.reasoning,
    status:           row.status,
    exitPremium:      row.exit_premium ? parseFloat(row.exit_premium) : null,
    exitDate:         row.exit_date,
    realizedPnlDollar: row.realized_pnl_dollar ? parseFloat(row.realized_pnl_dollar) : null,
    realizedPnlPct:   row.realized_pnl_pct    ? parseFloat(row.realized_pnl_pct)    : null,
    createdBy:        row.created_by,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at
  };
}

// GET all challenges
app.get('/api/challenges', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM challenges ORDER BY created_at DESC');
  res.json(rows.map(rowToChallenge));
});

// GET single challenge with its trades
app.get('/api/challenges/:id', requireAuth, async (req, res) => {
  const { rows: cRows } = await pool.query('SELECT * FROM challenges WHERE id=$1', [req.params.id]);
  if (!cRows.length) return res.status(404).json({ error: 'Challenge not found' });
  const { rows: tRows } = await pool.query(
    'SELECT * FROM challenge_trades WHERE challenge_id=$1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json({ ...rowToChallenge(cRows[0]), trades: tRows.map(rowToChallengeTrade) });
});

// POST create challenge (mods only)
app.post('/api/challenges', requireMod, async (req, res) => {
  const { name, description, startingBalance, targetBalance, startDate, endDate } = req.body;
  const now = new Date().toISOString();
  const id  = crypto.randomBytes(8).toString('hex');
  const start = parseFloat(startingBalance);
  const { rows } = await pool.query(
    `INSERT INTO challenges (id,name,description,starting_balance,target_balance,current_balance,start_date,end_date,created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [id, name, description||'', start, parseFloat(targetBalance), start,
     startDate||null, endDate||null, req.user.displayName||req.user.username, now, now]
  );
  const ch = rowToChallenge(rows[0]);
  notifyDiscord({
    title: `🏆 New Challenge — ${ch.name}`,
    color: 0xF59E0B,
    fields: [
      { name: 'Starting',    value: `$${ch.startingBalance.toLocaleString()}`,  inline: true },
      { name: 'Target',      value: `$${ch.targetBalance.toLocaleString()}`,    inline: true },
      { name: 'Need to make',value: `$${(ch.targetBalance-ch.startingBalance).toLocaleString()}`, inline: true },
      ...(description ? [{ name: 'About', value: description, inline: false }] : []),
      { name: 'Created by', value: ch.createdBy||'—', inline: true }
    ],
    footer: { text: 'Bulls & Bears · Challenges' },
    timestamp: now
  }, process.env.DISCORD_WEBHOOK_CHALLENGES);
  res.status(201).json(ch);
});

// PUT edit challenge (mods only)
app.put('/api/challenges/:id', requireMod, async (req, res) => {
  const { name, description, targetBalance, startDate, endDate, status } = req.body;
  const { rows } = await pool.query(
    `UPDATE challenges SET name=$2,description=$3,target_balance=$4,start_date=$5,end_date=$6,status=$7,updated_at=$8
     WHERE id=$1 RETURNING *`,
    [req.params.id, name, description||'', parseFloat(targetBalance),
     startDate||null, endDate||null, status||'active', new Date().toISOString()]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rowToChallenge(rows[0]));
});

// DELETE challenge (mods only)
app.delete('/api/challenges/:id', requireMod, async (req, res) => {
  await pool.query('DELETE FROM challenges WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// POST add trade to challenge (mods only)
app.post('/api/challenges/:id/trades', requireMod, async (req, res) => {
  const ch = await pool.query('SELECT * FROM challenges WHERE id=$1', [req.params.id]);
  if (!ch.rows.length) return res.status(404).json({ error: 'Challenge not found' });

  const { ticker, direction, strike, expiryDate, premium, contracts, stopLoss, target, reasoning } = req.body;
  const now = new Date().toISOString();
  const id  = crypto.randomBytes(8).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO challenge_trades (id,challenge_id,ticker,direction,strike,expiry_date,premium,contracts,stop_loss,target,reasoning,created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [id, req.params.id, ticker.toUpperCase().trim(), direction, parseFloat(strike),
     expiryDate, parseFloat(premium), parseInt(contracts)||1,
     stopLoss ? parseFloat(stopLoss) : null,
     target   ? parseFloat(target)   : null,
     reasoning||'', req.user.displayName||req.user.username, now, now]
  );
  const trade = rowToChallengeTrade(rows[0]);
  const challenge = rowToChallenge(ch.rows[0]);
  notifyDiscord({
    title: `🎯 Challenge Trade — ${trade.ticker} ${trade.direction}`,
    color: 0x5865F2,
    fields: [
      { name: 'Challenge',  value: challenge.name,          inline: false },
      { name: 'Ticker',     value: trade.ticker,            inline: true },
      { name: 'Type',       value: trade.direction,         inline: true },
      { name: 'Strike',     value: `$${trade.strike}`,      inline: true },
      { name: 'Premium',    value: `$${trade.premium}`,     inline: true },
      { name: 'Contracts',  value: `${trade.contracts}`,    inline: true },
      { name: 'Balance',    value: `$${challenge.currentBalance.toLocaleString()}`, inline: true },
      ...(reasoning ? [{ name: 'Reasoning', value: reasoning, inline: false }] : []),
      { name: 'Posted by',  value: trade.createdBy||'—',   inline: true }
    ],
    footer: { text: 'Bulls & Bears · Challenges' },
    timestamp: now
  }, process.env.DISCORD_WEBHOOK_CHALLENGES);
  res.status(201).json(trade);
});

// PUT edit challenge trade
app.put('/api/challenges/:id/trades/:tradeId', requireMod, async (req, res) => {
  const { ticker, direction, strike, expiryDate, premium, contracts, stopLoss, target, reasoning } = req.body;
  const { rows } = await pool.query(
    `UPDATE challenge_trades SET ticker=$2,direction=$3,strike=$4,expiry_date=$5,premium=$6,contracts=$7,stop_loss=$8,target=$9,reasoning=$10,updated_at=$11
     WHERE id=$1 AND challenge_id=$12 RETURNING *`,
    [req.params.tradeId, ticker.toUpperCase().trim(), direction, parseFloat(strike),
     expiryDate, parseFloat(premium), parseInt(contracts)||1,
     stopLoss ? parseFloat(stopLoss) : null,
     target   ? parseFloat(target)   : null,
     reasoning||'', new Date().toISOString(), req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rowToChallengeTrade(rows[0]));
});

// DELETE challenge trade
app.delete('/api/challenges/:id/trades/:tradeId', requireMod, async (req, res) => {
  await pool.query('DELETE FROM challenge_trades WHERE id=$1 AND challenge_id=$2', [req.params.tradeId, req.params.id]);
  res.json({ success: true });
});

// POST close challenge trade
app.post('/api/challenges/:id/trades/:tradeId/close', requireMod, async (req, res) => {
  const { exitPremium, note } = req.body;
  const now = new Date().toISOString();
  const { rows: tRows } = await pool.query('SELECT * FROM challenge_trades WHERE id=$1 AND challenge_id=$2', [req.params.tradeId, req.params.id]);
  if (!tRows.length) return res.status(404).json({ error: 'Trade not found' });
  const t = rowToChallengeTrade(tRows[0]);

  const exit   = parseFloat(exitPremium);
  const pnlDollar = (exit - t.premium) * t.contracts * 100;
  const pnlPct    = (exit - t.premium) / t.premium * 100;

  await pool.query(
    `UPDATE challenge_trades SET exit_premium=$2,exit_date=$3,status='closed',realized_pnl_dollar=$4,realized_pnl_pct=$5,updated_at=$3 WHERE id=$1`,
    [req.params.tradeId, exit, now, pnlDollar, pnlPct]
  );

  // Update challenge balance
  const { rows: cRows } = await pool.query(
    `UPDATE challenges SET current_balance=current_balance+$2,updated_at=$3 WHERE id=$1 RETURNING *`,
    [req.params.id, pnlDollar, now]
  );
  const challenge = rowToChallenge(cRows[0]);

  // Check if challenge completed
  if (challenge.currentBalance >= challenge.targetBalance && challenge.status === 'active') {
    await pool.query(`UPDATE challenges SET status='completed' WHERE id=$1`, [req.params.id]);
    challenge.status = 'completed';
  }

  const pnlSign = pnlPct >= 0 ? '+' : '';
  notifyDiscord({
    title: challenge.status === 'completed'
      ? `🎉 CHALLENGE COMPLETE — ${challenge.name}!`
      : `🏁 Challenge Trade Closed — ${t.ticker} ${t.direction}`,
    color: pnlPct >= 0 ? 0x57F287 : 0xED4245,
    fields: [
      { name: 'Challenge',     value: challenge.name,                                       inline: false },
      { name: 'Ticker',        value: t.ticker,                                             inline: true },
      { name: 'Entry Premium', value: `$${t.premium}`,                                     inline: true },
      { name: 'Exit Premium',  value: `$${exit}`,                                          inline: true },
      { name: 'P&L %',         value: `${pnlSign}${pnlPct.toFixed(2)}%`,                  inline: true },
      { name: 'P&L $',         value: `${pnlSign}$${Math.abs(pnlDollar).toFixed(2)}`,     inline: true },
      { name: 'New Balance',   value: `$${challenge.currentBalance.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`, inline: true },
      { name: 'Progress',      value: `$${challenge.currentBalance.toFixed(0)} / $${challenge.targetBalance.toFixed(0)}`, inline: false },
      ...(note ? [{ name: 'Note', value: note, inline: false }] : []),
      { name: 'Posted by',     value: req.user.displayName||req.user.username||'—',         inline: true }
    ],
    footer: { text: 'Bulls & Bears · Challenges' },
    timestamp: now
  }, process.env.DISCORD_WEBHOOK_CHALLENGES);

  const { rows: finalTrade } = await pool.query('SELECT * FROM challenge_trades WHERE id=$1', [req.params.tradeId]);
  res.json({ trade: rowToChallengeTrade(finalTrade[0]), challenge });
});

// ─── Options routes ───────────────────────────────────────────

function fmtExpiry(d) {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString() : d.toString();
  const [y, m, day] = s.slice(0, 10).split('-');
  return `${m}/${day}/${y}`;
}

function rowToOption(row) {
  const premium     = parseFloat(row.premium);
  const exitPremium = row.exit_premium ? parseFloat(row.exit_premium) : null;
  const contracts   = parseInt(row.contracts);
  const realizedPnlPct  = exitPremium != null ? (exitPremium - premium) / premium * 100 : null;
  const realizedPnlDollar = exitPremium != null ? (exitPremium - premium) * contracts * 100 : null;
  return {
    id:           row.id,
    ticker:       row.ticker,
    direction:    row.direction,
    strike:       parseFloat(row.strike),
    expiryDate:   row.expiry_date,
    premium,
    contracts,
    stopLoss:     row.stop_loss ? parseFloat(row.stop_loss) : null,
    target:       row.target    ? parseFloat(row.target)    : null,
    reasoning:    row.reasoning,
    status:       row.status,
    exitPremium,
    exitDate:     row.exit_date,
    realizedPnlPct,
    realizedPnlDollar,
    createdBy:    row.created_by,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at
  };
}

app.get('/api/options', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM options_trades ORDER BY created_at DESC');
  res.json(rows.map(rowToOption));
});

app.post('/api/options', requireMod, async (req, res) => {
  const { ticker, direction, strike, expiryDate, premium, contracts,
          stopLoss, target, reasoning } = req.body;
  const now = new Date().toISOString();
  const id  = crypto.randomBytes(8).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO options_trades
      (id, ticker, direction, strike, expiry_date, premium, contracts,
       stop_loss, target, reasoning, status, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11,$12,$13) RETURNING *`,
    [id, ticker.toUpperCase().trim(), direction, parseFloat(strike), expiryDate,
     parseFloat(premium), parseInt(contracts) || 1,
     stopLoss ? parseFloat(stopLoss) : null,
     target   ? parseFloat(target)   : null,
     reasoning || '',
     req.user.displayName || req.user.username, now, now]
  );
  const opt = rowToOption(rows[0]);
  notifyDiscord({
    title: `🎯 New Options Trade — ${opt.ticker} ${opt.direction}`,
    color: 0x5865F2,
    fields: [
      { name: 'Ticker',     value: opt.ticker,                       inline: true },
      { name: 'Type',       value: opt.direction,                    inline: true },
      { name: 'Strike',     value: `$${opt.strike}`,                 inline: true },
      { name: 'Expiry',     value: fmtExpiry(opt.expiryDate),inline: true },
      { name: 'Premium',    value: `$${opt.premium}`,                inline: true },
      { name: 'Contracts',  value: `${opt.contracts}`,               inline: true },
      ...(opt.target   ? [{ name: 'Target',   value: `$${opt.target}`,   inline: true }] : []),
      ...(opt.stopLoss ? [{ name: 'Stop Loss', value: `$${opt.stopLoss}`, inline: true }] : []),
      ...(reasoning    ? [{ name: 'Reasoning', value: reasoning, inline: false }] : []),
      { name: 'Posted by', value: opt.createdBy || '—', inline: true }
    ],
    footer: { text: 'Bulls & Bears · Options' },
    timestamp: now
  }, process.env.DISCORD_WEBHOOK_OPTIONS);
  res.status(201).json(opt);
});

app.put('/api/options/:id', requireMod, async (req, res) => {
  const { ticker, direction, strike, expiryDate, premium, contracts,
          stopLoss, target, reasoning } = req.body;
  const { rows } = await pool.query(
    `UPDATE options_trades SET
      ticker=$2, direction=$3, strike=$4, expiry_date=$5, premium=$6,
      contracts=$7, stop_loss=$8, target=$9, reasoning=$10, updated_at=$11
     WHERE id=$1 RETURNING *`,
    [req.params.id, ticker.toUpperCase().trim(), direction, parseFloat(strike),
     expiryDate, parseFloat(premium), parseInt(contracts) || 1,
     stopLoss ? parseFloat(stopLoss) : null,
     target   ? parseFloat(target)   : null,
     reasoning || '', new Date().toISOString()]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rowToOption(rows[0]));
});

app.delete('/api/options/:id', requireMod, async (req, res) => {
  await pool.query('DELETE FROM options_trades WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.post('/api/options/:id/close', requireMod, async (req, res) => {
  const { exitPremium, note } = req.body;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `UPDATE options_trades SET
      exit_premium=$2, exit_date=$3, status='closed', updated_at=$3
     WHERE id=$1 RETURNING *`,
    [req.params.id, parseFloat(exitPremium), now]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const opt = rowToOption(rows[0]);
  const pnlSign = opt.realizedPnlPct >= 0 ? '+' : '';
  notifyDiscord({
    title: `🏁 Options Closed — ${opt.ticker} ${opt.direction}`,
    color: opt.realizedPnlPct >= 0 ? 0x57F287 : 0xED4245,
    fields: [
      { name: 'Ticker',      value: opt.ticker,                            inline: true },
      { name: 'Type',        value: opt.direction,                         inline: true },
      { name: 'Strike',      value: `$${opt.strike}`,                      inline: true },
      { name: 'Entry Premium', value: `$${opt.premium}`,                   inline: true },
      { name: 'Exit Premium',  value: `$${opt.exitPremium}`,               inline: true },
      { name: 'P&L %',       value: `${pnlSign}${opt.realizedPnlPct?.toFixed(2)}%`, inline: true },
      { name: 'P&L $',       value: `${pnlSign}$${opt.realizedPnlDollar?.toFixed(2)}`, inline: true },
      { name: 'Contracts',   value: `${opt.contracts}`,                    inline: true },
      ...(note ? [{ name: 'Note', value: note, inline: false }] : []),
      { name: 'Posted by',   value: req.user.displayName || req.user.username || '—', inline: true }
    ],
    footer: { text: 'Bulls & Bears · Options' },
    timestamp: now
  }, process.env.DISCORD_WEBHOOK_OPTIONS);
  res.json(opt);
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
