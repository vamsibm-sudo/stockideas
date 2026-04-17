// ─── State ───────────────────────────────────────────────────
let allTrades   = [];
let currentUser = null;
let editingId   = null;
let updatingId  = null;
let deletingId  = null;
let activeView  = 'cardView';

// ─── Formatters ──────────────────────────────────────────────
function fmtPrice(val) {
  if (val == null) return '—';
  return '$' + parseFloat(val).toFixed(2);
}

function fmtPnl(val) {
  if (val == null) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
}

function pnlClass(val) {
  if (val == null) return 'pnl-null';
  return val >= 0 ? 'pnl-pos' : 'pnl-neg';
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

// ─── Auth ─────────────────────────────────────────────────────
async function checkAuth() {
  const params = new URLSearchParams(window.location.search);
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;

      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('app').classList.remove('app-hidden');
      document.getElementById('navUsername').textContent = currentUser.displayName || currentUser.username;

      if (currentUser.isMod) {
        document.querySelectorAll('.mod-only').forEach(el => el.classList.remove('mod-only'));
      }

      if (params.get('auth_error')) history.replaceState(null, '', '/');
      loadTrades();
    } else {
      if (params.get('auth_error')) document.getElementById('authError').style.display = 'block';
    }
  } catch {
    if (params.get('auth_error')) document.getElementById('authError').style.display = 'block';
  }
}

// ─── Data ────────────────────────────────────────────────────
async function loadTrades() {
  try {
    const res = await fetch('/api/trades');
    allTrades = await res.json();
    updateStats();
    applyFilters();
  } catch {
    document.getElementById('tradesBody').innerHTML =
      '<tr><td colspan="11" class="loading-cell">Failed to load trades. Please refresh.</td></tr>';
  }
}

function updateStats() {
  document.getElementById('statOpen').textContent    = allTrades.filter(t => t.status === 'open').length;
  document.getElementById('statPartial').textContent = allTrades.filter(t => t.status === 'partial').length;
  document.getElementById('statClosed').textContent  = allTrades.filter(t => t.status === 'closed').length;
  renderActivity();
}

// ─── Filters ─────────────────────────────────────────────────
function applyFilters() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const status = document.getElementById('filterStatus').value;

  const matchSearch = t =>
    t.ticker.toLowerCase().includes(search) || t.companyName.toLowerCase().includes(search);

  // Cards + Table: active trades only, filtered by status if selected
  const activeTrades = allTrades.filter(t => t.status !== 'closed');
  const filtered = activeTrades.filter(t =>
    matchSearch(t) && (!status || t.status === status)
  );

  renderCards(filtered);
  renderTable(filtered);

  // Closed tab: always show closed, but still honour search
  const closedFiltered = allTrades.filter(t => t.status === 'closed' && matchSearch(t));
  renderClosed(closedFiltered);
}

// ─── Table rendering ─────────────────────────────────────────
function renderTable(trades) {
  const tbody = document.getElementById('tradesBody');
  const cols  = currentUser?.isMod ? 11 : 10;

  if (trades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols}">
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <h3>No Trades Found</h3>
        <p>${allTrades.length === 0 ? 'No trades have been posted yet.' : 'No trades match your filters.'}</p>
      </div>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = trades.map(renderRow).join('');
}

function renderRow(trade) {
  const targets  = trade.targets.map(fmtPrice).join(' / ');
  const modCells = currentUser?.isMod ? `
    <td class="action-cell" onclick="event.stopPropagation()">
      <button class="btn-sm btn-outline" onclick="openEditModal('${trade.id}')">Edit</button>
      ${trade.status !== 'closed'
        ? `<button class="btn-sm btn-primary" onclick="openUpdateModal('${trade.id}')">+ Update</button>`
        : ''}
      <button class="btn-sm btn-danger" onclick="openDeleteModal('${trade.id}')">Delete</button>
    </td>` : '';

  return `
    <tr class="trade-row" onclick="toggleExpand('${trade.id}')">
      <td class="col-expand"><span class="expand-icon" id="icon-${trade.id}">▶</span></td>
      <td>
        <div class="trade-ticker">${trade.ticker}</div>
        <div class="trade-company">${trade.companyName}</div>
      </td>
      <td><span class="dir-badge dir-${trade.direction.toLowerCase()}">${trade.direction}</span></td>
      <td>${fmtPrice(trade.entryPrice)}</td>
      <td class="current-price">${fmtPrice(trade.currentPrice)}</td>
      <td>${fmtPrice(trade.stopLoss)}</td>
      <td class="targets-cell">${targets}</td>
      <td class="${pnlClass(trade.realizedPnL)} pnl-cell">${fmtPnl(trade.realizedPnL)}</td>
      <td class="${pnlClass(trade.openPnL)} pnl-cell">${fmtPnl(trade.openPnL)}</td>
      <td><span class="status-badge status-${trade.status}">${trade.status}</span></td>
      ${modCells}
    </tr>
    <tr class="detail-row" id="detail-${trade.id}">
      <td colspan="${currentUser?.isMod ? 11 : 10}" class="detail-cell">
        ${renderTimeline(trade)}
      </td>
    </tr>`;
}

function renderTimeline(trade) {
  const dir   = trade.direction === 'BUY' ? 1 : -1;
  const entry = trade.entryPrice;
  const typeLabel = {
    open:          'OPENED',
    partial_close: 'PARTIAL CLOSE',
    full_close:    'FULL CLOSE',
    add_position:  'ADDED TO POSITION (DCA)'
  };
  const typeIcon = {
    open:          '📈',
    partial_close: '📉',
    full_close:    '✅',
    add_position:  '➕'
  };

  const items = trade.actions.map(a => {
    const pctStr = a.type === 'add_position'
      ? ` — ${a.percentAdded}% added`
      : a.percentClosed > 0 ? ` — ${a.percentClosed}% of position` : '';

    let pnlTag = '';
    if (a.type === 'partial_close' || a.type === 'full_close') {
      const pct = dir * (a.price - entry) / entry * 100;
      pnlTag = `<span class="timeline-pnl ${pnlClass(pct)}">${fmtPnl(pct)} on this tranche</span>`;
    }
    if (a.type === 'add_position') {
      pnlTag = `<span class="timeline-pnl pnl-null">new avg: ${fmtPrice(trade.entryPrice)}</span>`;
    }
    return `
      <div class="timeline-item">
        <div class="timeline-dot">${typeIcon[a.type]}</div>
        <div class="timeline-body">
          <div class="timeline-meta">
            <span class="timeline-type">${typeLabel[a.type]}${pctStr}</span>
            <span class="timeline-price">${fmtPrice(a.price)}</span>
            ${pnlTag}
            <span class="timeline-date">${fmtDate(a.date)}</span>
          </div>
          ${a.note ? `<div class="timeline-note">"${a.note}"</div>` : ''}
        </div>
      </div>`;
  }).join('');

  const summary  = buildSummary(trade);
  const analysis = (trade.reasoning || trade.riskAnalysis) ? `
    <div class="trade-analysis">
      ${trade.reasoning    ? `<div class="analysis-item"><span class="analysis-label">Thesis</span>${trade.reasoning}</div>` : ''}
      ${trade.riskAnalysis ? `<div class="analysis-item analysis-risk"><span class="analysis-label">Risk</span>${trade.riskAnalysis}</div>` : ''}
    </div>` : '';

  return `<div class="timeline-wrap">${items}${summary}${analysis}</div>`;
}

function buildSummary(trade) {
  if (trade.realizedPnL == null && trade.openPnL == null) return '';
  const parts = [];
  if (trade.realizedPnL != null)
    parts.push(`<span>Realized: <strong class="${pnlClass(trade.realizedPnL)}">${fmtPnl(trade.realizedPnL)}</strong> (${trade.closedPercent}% closed)</span>`);
  if (trade.openPnL != null)
    parts.push(`<span>Open P&amp;L: <strong class="${pnlClass(trade.openPnL)}">${fmtPnl(trade.openPnL)}</strong> (${trade.remainingPercent}% remaining)</span>`);
  return `<div class="timeline-summary">${parts.join('<span class="sum-divider">|</span>')}</div>`;
}

function toggleExpand(id) {
  const row  = document.getElementById(`detail-${id}`);
  const icon = document.getElementById(`icon-${id}`);
  const open = row.classList.toggle('detail-open');
  icon.textContent = open ? '▼' : '▶';
  icon.classList.toggle('expanded', open);
}

// ─── Card rendering ───────────────────────────────────────────
function renderCards(trades) {
  const grid = document.getElementById('cardsGrid');

  if (trades.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <h3>No Trades Found</h3>
      <p>${allTrades.length === 0 ? 'No trades have been posted yet.' : 'No trades match your filters.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = trades.map(renderCard).join('');
}

function renderCard(trade) {
  const isClosed = trade.status === 'closed';

  const modActions = currentUser?.isMod ? `
    <div class="card-actions">
      <button class="btn-sm btn-outline" onclick="openEditModal('${trade.id}')">Edit</button>
      ${!isClosed ? `<button class="btn-sm btn-primary" onclick="openUpdateModal('${trade.id}')">+ Update</button>` : ''}
      <button class="btn-sm btn-danger" onclick="openDeleteModal('${trade.id}')">Delete</button>
    </div>` : '';

  const targetList = trade.targets.map(fmtPrice).join(' / ');

  return `
    <div class="trade-card ${isClosed ? 'card-closed' : ''} card-dir-${trade.direction.toLowerCase()}">
      <div class="card-header">
        <div class="card-title">
          <span class="card-ticker">${trade.ticker}</span>
          <span class="dir-badge dir-${trade.direction.toLowerCase()}">${trade.direction}</span>
        </div>
        <span class="status-badge status-${trade.status}">${trade.status}</span>
      </div>

      <div class="card-company">${trade.companyName}</div>

      <div class="card-grid-row">
        <div class="card-cell">
          <span class="card-cell-label">Entry</span>
          <span class="card-cell-value">${fmtPrice(trade.entryPrice)}</span>
        </div>
        <div class="card-cell card-cell-highlight">
          <span class="card-cell-label">Current</span>
          <span class="card-cell-value">${fmtPrice(trade.currentPrice)}</span>
        </div>
        <div class="card-cell">
          <span class="card-cell-label">Stop</span>
          <span class="card-cell-value pnl-neg">${fmtPrice(trade.stopLoss)}</span>
        </div>
      </div>

      <div class="card-grid-row">
        <div class="card-cell">
          <span class="card-cell-label">Target(s)</span>
          <span class="card-cell-value">${targetList}</span>
        </div>
        <div class="card-cell">
          <span class="card-cell-label">Open P&amp;L</span>
          <span class="card-cell-value ${pnlClass(trade.openPnL)}">${fmtPnl(trade.openPnL)}</span>
        </div>
        <div class="card-cell">
          <span class="card-cell-label">Realized P&amp;L</span>
          <span class="card-cell-value ${pnlClass(trade.realizedPnL)}">${fmtPnl(trade.realizedPnL)}</span>
        </div>
      </div>

      <div class="card-grid-row card-grid-row-last">
        <div class="card-cell">
          <span class="card-cell-label">Sector</span>
          <span class="card-cell-value card-cell-sm">${trade.sector || '—'}</span>
        </div>
        <div class="card-cell">
          <span class="card-cell-label">Timeframe</span>
          <span class="card-cell-value card-cell-sm">${trade.timeframe || '—'}</span>
        </div>
        <div class="card-cell">
          <span class="card-cell-label">Confidence</span>
          <span class="card-cell-value card-cell-sm ${trade.confidenceLevel ? 'conf-' + trade.confidenceLevel : ''}">${trade.confidenceLevel || '—'}</span>
        </div>
      </div>

      <div class="card-footer">
        <span class="card-date">${fmtDate(trade.createdAt)}${trade.createdBy ? ' · ' + trade.createdBy : ''}</span>
        ${modActions}
      </div>
    </div>`;
}

// ─── Closed positions tab ─────────────────────────────────────
function renderClosed(closed) {
  if (!closed) closed = allTrades.filter(t => t.status === 'closed');
  const tbody  = document.getElementById('closedBody');
  const cols   = currentUser?.isMod ? 11 : 10;

  if (closed.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols}">
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <h3>No Closed Positions</h3>
        <p>Fully closed trades will appear here.</p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = closed.map(trade => {
    const targets   = trade.targets.map(fmtPrice).join(' / ');
    const closedAt  = trade.actions.findLast(a => a.type === 'full_close')?.date
                   || trade.updatedAt;
    const modCells  = currentUser?.isMod ? `
      <td class="action-cell" onclick="event.stopPropagation()">
        <button class="btn-sm btn-outline" onclick="openEditModal('${trade.id}')">Edit</button>
        <button class="btn-sm btn-danger"  onclick="openDeleteModal('${trade.id}')">Delete</button>
      </td>` : '';

    return `
      <tr class="trade-row" onclick="toggleClosedExpand('${trade.id}')">
        <td class="col-expand"><span class="expand-icon" id="cicon-${trade.id}">▶</span></td>
        <td>
          <div class="trade-ticker">${trade.ticker}</div>
          <div class="trade-company">${trade.companyName}</div>
        </td>
        <td><span class="dir-badge dir-${trade.direction.toLowerCase()}">${trade.direction}</span></td>
        <td>${fmtPrice(trade.entryPrice)}</td>
        <td>${fmtPrice(trade.stopLoss)}</td>
        <td class="targets-cell">${targets}</td>
        <td class="${pnlClass(trade.realizedPnL)} pnl-cell">${fmtPnl(trade.realizedPnL)}</td>
        <td>${trade.confidenceLevel ? `<span class="card-tag confidence-${trade.confidenceLevel}">${trade.confidenceLevel}</span>` : '—'}</td>
        <td>${trade.timeframe || '—'}</td>
        <td class="closed-date">${fmtDate(closedAt)}</td>
        ${modCells}
      </tr>
      <tr class="detail-row" id="cdetail-${trade.id}">
        <td colspan="${cols}" class="detail-cell">${renderTimeline(trade)}</td>
      </tr>`;
  }).join('');
}

function toggleClosedExpand(id) {
  const row  = document.getElementById(`cdetail-${id}`);
  const icon = document.getElementById(`cicon-${id}`);
  const open = row.classList.toggle('detail-open');
  icon.textContent = open ? '▼' : '▶';
  icon.classList.toggle('expanded', open);
}

// ─── Activity panel ───────────────────────────────────────────
function renderActivity() {
  const typeLabel = {
    open:          'Trade Opened',
    partial_close: 'Partial Close',
    full_close:    'Fully Closed',
    add_position:  'Added to Position'
  };
  const typeIcon = {
    open:          '📈',
    partial_close: '📉',
    full_close:    '✅',
    add_position:  '➕'
  };
  const typeColor = {
    open:          'activity-open',
    partial_close: 'activity-partial',
    full_close:    'activity-closed',
    add_position:  'activity-add'
  };

  // Collect all actions across all trades, sorted newest first
  const events = [];
  allTrades.forEach(trade => {
    trade.actions.forEach(a => {
      events.push({ ...a, trade });
    });
  });
  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  const list = document.getElementById('activityList');
  document.getElementById('activityCount').textContent = events.length;

  if (events.length === 0) {
    list.innerHTML = '<div class="activity-empty">No activity yet</div>';
    return;
  }

  list.innerHTML = events.map(ev => {
    const dir   = ev.trade.direction === 'BUY' ? 1 : -1;
    const entry = ev.trade.entryPrice;
    let pnlTag  = '';

    if (ev.type === 'partial_close' || ev.type === 'full_close') {
      const pct = dir * (ev.price - entry) / entry * 100;
      pnlTag = `<span class="activity-pnl ${pnlClass(pct)}">${fmtPnl(pct)}</span>`;
    }
    if (ev.type === 'add_position') {
      pnlTag = `<span class="activity-pnl pnl-null">+${ev.percentAdded}%</span>`;
    }

    const subtext = ev.note
      ? `<div class="activity-note">${ev.note}</div>`
      : '';

    return `
      <div class="activity-item ${typeColor[ev.type] || ''}">
        <div class="activity-icon">${typeIcon[ev.type] || '📌'}</div>
        <div class="activity-body">
          <div class="activity-main">
            <span class="activity-ticker">${ev.trade.ticker}</span>
            <span class="activity-label">${typeLabel[ev.type] || ev.type}</span>
            <span class="activity-price">${fmtPrice(ev.price)}</span>
            ${pnlTag}
          </div>
          ${subtext}
          <div class="activity-date">${fmtDate(ev.date)}</div>
        </div>
      </div>`;
  }).join('');
}

// ─── View tabs ────────────────────────────────────────────────
function switchView(viewId) {
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.toggle('view-panel-hidden', panel.id !== viewId);
  });
  activeView = viewId;
}

// ─── Expand / collapse ────────────────────────────────────────
// (already defined above inside renderRow context — stand-alone for onclick calls)

// ─── Ticker fetch ─────────────────────────────────────────────
async function fetchTickerInfo() {
  const ticker = document.getElementById('f-ticker').value.trim().toUpperCase();
  if (!ticker) return;

  const statusEl     = document.getElementById('tickerStatus');
  const hintEl       = document.getElementById('fetchedPriceHint');
  const fetchBtn     = document.getElementById('fetchTickerBtn');

  fetchBtn.textContent = 'Fetching…';
  fetchBtn.disabled    = true;
  statusEl.className   = 'ticker-status ticker-loading';
  statusEl.textContent = `Looking up ${ticker}…`;

  try {
    const res  = await fetch(`/api/ticker-info/${ticker}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    // Auto-fill company name, sector, entry price
    document.getElementById('f-company').value = data.companyName || '';
    if (data.sector) document.getElementById('f-sector').value = data.sector;
    if (data.currentPrice) {
      document.getElementById('f-entry').value = data.currentPrice.toFixed(2);
      hintEl.textContent = `current: ${fmtPrice(data.currentPrice)}`;
    }

    statusEl.className   = 'ticker-status ticker-success';
    statusEl.textContent = `✓ ${data.companyName}${data.sector ? ' · ' + data.sector : ''}${data.currentPrice ? ' — ' + fmtPrice(data.currentPrice) : ''}`;
  } catch {
    statusEl.className   = 'ticker-status ticker-error';
    statusEl.textContent = '✗ Ticker not found — enter details manually below';
    hintEl.textContent   = '';
  } finally {
    fetchBtn.textContent = 'Fetch';
    fetchBtn.disabled    = false;
  }
}

// ─── Modal helpers ────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ─── Add / Edit Trade ─────────────────────────────────────────
function resetTradeForm() {
  document.getElementById('tradeForm').reset();
  document.getElementById('tickerStatus').textContent     = '';
  document.getElementById('tickerStatus').className       = 'ticker-status';
  document.getElementById('fetchedPriceHint').textContent = '';
}

function openAddModal() {
  editingId = null;
  document.getElementById('tradeModalTitle').textContent = 'Add Trade';
  resetTradeForm();
  openModal('tradeModal');
}

function openEditModal(id) {
  const trade = allTrades.find(t => t.id === id);
  if (!trade) return;

  editingId = id;
  resetTradeForm();
  document.getElementById('tradeModalTitle').textContent   = `Edit — ${trade.ticker}`;
  document.getElementById('f-ticker').value                = trade.ticker;
  document.getElementById('f-company').value               = trade.companyName;
  document.getElementById('f-direction').value             = trade.direction;
  document.getElementById('f-sector').value                = trade.sector          || '';
  document.getElementById('f-confidence').value            = trade.confidenceLevel || '';
  document.getElementById('f-entry').value                 = trade.entryPrice;
  document.getElementById('f-stop').value                  = trade.stopLoss;
  document.getElementById('f-targets').value               = trade.targets.join(', ');
  document.getElementById('f-timeframe').value             = trade.timeframe       || '';
  document.getElementById('f-reasoning').value             = trade.reasoning       || '';
  document.getElementById('f-risk').value                  = trade.riskAnalysis    || '';
  openModal('tradeModal');
}

async function handleTradeSubmit(e) {
  e.preventDefault();
  const body = {
    ticker:          document.getElementById('f-ticker').value,
    companyName:     document.getElementById('f-company').value,
    direction:       document.getElementById('f-direction').value,
    sector:          document.getElementById('f-sector').value,
    confidenceLevel: document.getElementById('f-confidence').value,
    entryPrice:      document.getElementById('f-entry').value,
    stopLoss:        document.getElementById('f-stop').value,
    targets:         document.getElementById('f-targets').value.split(',').map(s => s.trim()).filter(Boolean),
    timeframe:       document.getElementById('f-timeframe').value,
    reasoning:       document.getElementById('f-reasoning').value,
    riskAnalysis:    document.getElementById('f-risk').value
  };

  const url    = editingId ? `/api/trades/${editingId}` : '/api/trades';
  const method = editingId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) { closeModal('tradeModal'); loadTrades(); }
  else alert('Error saving trade. Please try again.');
}

// ─── Add Update ───────────────────────────────────────────────
function openUpdateModal(id) {
  const trade = allTrades.find(t => t.id === id);
  if (!trade) return;
  updatingId = id;
  document.getElementById('updateModalTitle').textContent = `Update — ${trade.ticker}`;
  document.getElementById('updateForm').reset();
  document.getElementById('u-type').value = 'partial_close';
  document.getElementById('percentGroup').style.display = '';
  openModal('updateModal');
}

function handleTypeChange() {
  const type      = document.getElementById('u-type').value;
  const isDca     = type === 'add_position';
  const needsPct  = type === 'partial_close' || isDca;

  document.getElementById('percentGroup').style.display = needsPct ? '' : 'none';
  document.getElementById('u-price-label').textContent  = isDca ? 'Buy Price *'   : 'Close Price *';
  document.getElementById('u-percent-label').textContent = isDca ? '% of Position to Add *' : '% of Position to Close *';
}

async function handleUpdateSubmit(e) {
  e.preventDefault();
  const type = document.getElementById('u-type').value;
  const body = {
    type,
    price:         document.getElementById('u-price').value,
    percentClosed: type === 'partial_close' ? document.getElementById('u-percent').value : null,
    note:          document.getElementById('u-note').value
  };

  const res = await fetch(`/api/trades/${updatingId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) { closeModal('updateModal'); loadTrades(); }
  else alert('Error saving update. Please try again.');
}

// ─── Delete ───────────────────────────────────────────────────
function openDeleteModal(id) {
  const trade = allTrades.find(t => t.id === id);
  if (!trade) return;
  deletingId = id;
  document.getElementById('deleteTickerName').textContent = `${trade.ticker} — ${trade.companyName}`;
  openModal('deleteModal');
}

async function handleDelete() {
  const res = await fetch(`/api/trades/${deletingId}`, { method: 'DELETE' });
  if (res.ok) { closeModal('deleteModal'); loadTrades(); }
  else alert('Error deleting trade. Please try again.');
}

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  // Filters
  document.getElementById('searchInput').addEventListener('input', applyFilters);
  document.getElementById('filterStatus').addEventListener('change', applyFilters);

  // View tabs
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Mod controls
  document.getElementById('addTradeBtn').addEventListener('click', openAddModal);
  document.getElementById('fetchTickerBtn').addEventListener('click', fetchTickerInfo);

  // Clear ticker status on input change
  document.getElementById('f-ticker').addEventListener('input', () => {
    document.getElementById('tickerStatus').textContent = '';
    document.getElementById('tickerStatus').className  = 'ticker-status';
    document.getElementById('fetchedPriceHint').textContent = '';
  });

  // Also fetch on Enter inside ticker input
  document.getElementById('f-ticker').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); fetchTickerInfo(); }
  });

  // Update type toggle
  document.getElementById('u-type').addEventListener('change', handleTypeChange);

  // Form submissions
  document.getElementById('tradeForm').addEventListener('submit', handleTradeSubmit);
  document.getElementById('updateForm').addEventListener('submit', handleUpdateSubmit);
  document.getElementById('confirmDeleteBtn').addEventListener('click', handleDelete);

  // Close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Close on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
});
