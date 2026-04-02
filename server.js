const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Data file paths
const stocksFile = path.join(__dirname, 'data', 'stocks.json');
const adminFile = path.join(__dirname, 'data', 'admin.json');
const logsFile = path.join(__dirname, 'data', 'logs.json');

// Initialize data files if they don't exist
function initializeDataFiles() {
  if (!fs.existsSync(stocksFile)) {
    fs.writeFileSync(stocksFile, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(adminFile)) {
    // Default admin: username: 04022026, password: 04022026 (date-based simple login)
    const defaultAdmin = {
      username: '04022026',
      passwordHash: crypto.createHash('sha256').update('04022026').digest('hex'),
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(adminFile, JSON.stringify(defaultAdmin, null, 2));
  }
  if (!fs.existsSync(logsFile)) {
    fs.writeFileSync(logsFile, JSON.stringify([], null, 2));
  }
}

initializeDataFiles();

// Helper functions
function readStocks() {
  try {
    return JSON.parse(fs.readFileSync(stocksFile, 'utf8'));
  } catch (err) {
    return [];
  }
}

function writeStocks(data) {
  fs.writeFileSync(stocksFile, JSON.stringify(data, null, 2));
}

function readAdmin() {
  try {
    return JSON.parse(fs.readFileSync(adminFile, 'utf8'));
  } catch (err) {
    return null;
  }
}

function addLog(action, user, details) {
  try {
    const logs = JSON.parse(fs.readFileSync(logsFile, 'utf8'));
    logs.push({
      timestamp: new Date().toISOString(),
      action,
      user,
      details
    });
    fs.writeFileSync(logsFile, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error('Error writing log:', err);
  }
}

// Routes

// POST: Admin Login
app.post('/api/admin/login', (req, res) => {
  const { code } = req.body;
  const correctCode = '04022026';

  if (code === correctCode) {
    addLog('LOGIN', 'admin', 'Admin login successful');
    res.json({ 
      success: true, 
      token: crypto.randomBytes(32).toString('hex'),
      username: 'admin'
    });
  } else {
    addLog('LOGIN_FAILED', 'admin', 'Failed login attempt');
    res.status(401).json({ error: 'Invalid code' });
  }
});

// GET: All stocks (for view portal)
app.get('/api/stocks', (req, res) => {
  const stocks = readStocks();
  res.json(stocks);
});

// GET: Single stock by ID
app.get('/api/stocks/:id', (req, res) => {
  const stocks = readStocks();
  const stock = stocks.find(s => s.id === req.params.id);
  
  if (!stock) {
    return res.status(404).json({ error: 'Stock not found' });
  }
  
  res.json(stock);
});

// POST: Create new stock (Admin only)
app.post('/api/admin/stocks', (req, res) => {
  const { username, token, stockData } = req.body;

  if (!username || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const admin = readAdmin();
  if (username !== admin.username) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stocks = readStocks();
  const newStock = {
    id: crypto.randomBytes(8).toString('hex'),
    ...stockData,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    views: 0
  };

  stocks.push(newStock);
  writeStocks(stocks);
  addLog('CREATE_STOCK', username, `Created stock: ${newStock.ticker}`);

  res.status(201).json(newStock);
});

// PUT: Update stock (Admin only)
app.put('/api/admin/stocks/:id', (req, res) => {
  const { username, token, stockData } = req.body;

  if (!username || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const admin = readAdmin();
  if (username !== admin.username) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stocks = readStocks();
  const index = stocks.findIndex(s => s.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Stock not found' });
  }

  stocks[index] = {
    ...stocks[index],
    ...stockData,
    updatedAt: new Date().toISOString()
  };

  writeStocks(stocks);
  addLog('UPDATE_STOCK', username, `Updated stock: ${stocks[index].ticker}`);

  res.json(stocks[index]);
});

// DELETE: Delete stock (Admin only)
app.delete('/api/admin/stocks/:id', (req, res) => {
  const { username, token } = req.body;

  if (!username || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const admin = readAdmin();
  if (username !== admin.username) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stocks = readStocks();
  const stockToDelete = stocks.find(s => s.id === req.params.id);

  if (!stockToDelete) {
    return res.status(404).json({ error: 'Stock not found' });
  }

  const filtered = stocks.filter(s => s.id !== req.params.id);
  writeStocks(filtered);
  addLog('DELETE_STOCK', username, `Deleted stock: ${stockToDelete.ticker}`);

  res.json({ success: true, message: 'Stock deleted' });
});

// GET: Export stocks for automation scripts
app.get('/api/export/stocks', (req, res) => {
  const stocks = readStocks();
  res.json(stocks);
});

// GET: Logs (Admin only)
app.get('/api/admin/logs', (req, res) => {
  const { username } = req.query;
  const admin = readAdmin();

  if (username !== admin.username) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const logs = JSON.parse(fs.readFileSync(logsFile, 'utf8'));
    res.json(logs);
  } catch (err) {
    res.json([]);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🐂 Bulls&Bears Trading Platform running on http://localhost:${PORT}`);
  console.log('\n📱 Admin Portal: http://localhost:3000/admin.html');
  console.log('👁️ User View: http://localhost:3000/index.html');
  console.log('\n🔐 Default Admin Credentials:');
  console.log('Username: 04022026');
  console.log('Password: 04022026\n');
});
