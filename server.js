require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fetch = require('node-fetch');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const app = express();
const PORT = process.env.PORT || 3000;

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
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static('public'));

// ─── Data helpers ─────────────────────────────────────────────
const tradesFile = path.join(__dirname, 'data', 'trades.json');

function readTrades() {
  try { return JSON.parse(fs.readFileSync(tradesFile, 'utf8')); }
  catch { return []; }
}

function writeTrades(data) {
  fs.writeFileSync(tradesFile, JSON.stringify(data, null, 2));
}

if (!fs.existsSync(tradesFile)) {
  fs.writeFileSync(tradesFile, JSON.stringify([], null, 2));
}

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
  const trades = readTrades();

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
app.post('/api/trades', requireMod, (req, res) => {
  const { ticker, companyName, direction, entryPrice, stopLoss, targets,
          sector, confidenceLevel, timeframe, reasoning, riskAnalysis } = req.body;

  const trades = readTrades();
  const newTrade = {
    id: crypto.randomBytes(8).toString('hex'),
    ticker: ticker.toUpperCase().trim(),
    companyName,
    direction,
    entryPrice: parseFloat(entryPrice),
    stopLoss: parseFloat(stopLoss),
    targets: targets.map(t => parseFloat(t)),
    sector:         sector         || '',
    confidenceLevel: confidenceLevel || '',
    timeframe:      timeframe      || '',
    reasoning:      reasoning      || '',
    riskAnalysis:   riskAnalysis   || '',
    status: 'open',
    actions: [{
      id: crypto.randomBytes(4).toString('hex'),
      type: 'open',
      price: parseFloat(entryPrice),
      percentClosed: 0,
      note: reasoning || '',
      date: new Date().toISOString()
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  trades.unshift(newTrade); // newest first
  writeTrades(trades);
  res.status(201).json(newTrade);
});

// PUT update trade details (mods only)
app.put('/api/trades/:id', requireMod, (req, res) => {
  const trades = readTrades();
  const idx = trades.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Trade not found' });

  const { ticker, companyName, direction, entryPrice, stopLoss, targets,
          sector, confidenceLevel, timeframe, reasoning, riskAnalysis } = req.body;

  trades[idx] = {
    ...trades[idx],
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
    riskAnalysis:    riskAnalysis    || '',
    updatedAt: new Date().toISOString()
  };

  // Keep the open action's price in sync
  const openAction = trades[idx].actions.find(a => a.type === 'open');
  if (openAction) openAction.price = parseFloat(entryPrice);

  writeTrades(trades);
  res.json(trades[idx]);
});

// DELETE trade (mods only)
app.delete('/api/trades/:id', requireMod, (req, res) => {
  const trades = readTrades();
  const idx = trades.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Trade not found' });

  trades.splice(idx, 1);
  writeTrades(trades);
  res.json({ success: true });
});

// POST add action (partial/full close) to a trade (mods only)
app.post('/api/trades/:id/actions', requireMod, (req, res) => {
  const trades = readTrades();
  const trade = trades.find(t => t.id === req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  const { type, price, percentClosed, note } = req.body;

  // ── DCA: add to position ──────────────────────────────────
  if (type === 'add_position') {
    const addPct    = Math.max(1, parseFloat(percentClosed) || 50);
    const totalPct  = trade.remainingPercent + addPct;
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

    trade.entryPrice      = parseFloat(newAvgEntry.toFixed(4));
    trade.remainingPercent = totalPct;
    trade.updatedAt       = new Date().toISOString();
    writeTrades(trades);
    return res.json(trade);
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
  trade.updatedAt = new Date().toISOString();

  writeTrades(trades);
  res.json(trade);
});

// GET ticker info (company name, current price, sector) from Yahoo Finance
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🐂 Bulls&Bears running on http://localhost:${PORT}`);
  console.log(`📱 On your local network: http://<your-pc-ip>:${PORT}\n`);
});
