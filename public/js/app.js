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
        <div class="card-footer-actions">
          ${currentUser?.isMod && !trade.createdBy ? `<button class="btn-sm btn-ghost" onclick="claimTrade('${trade.id}',this)">Claim</button>` : ''}
          ${modActions}
        </div>
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

async function claimTrade(id, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  const res = await fetch(`/api/trades/${id}/claim`, { method: 'PATCH' });
  if (res.ok) { loadTrades(); }
  else { btn.disabled = false; btn.textContent = 'Claim'; alert('Failed to claim trade.'); }
}

// ─── Options state ────────────────────────────────────────────
let allOptions    = [];
let editingOptId  = null;
let closingOptId  = null;
let deletingOptId = null;

async function loadOptions() {
  try {
    const res  = await fetch('/api/options');
    allOptions = await res.json();
    applyOptionFilters();
    renderOptionActivity();
    updateOptionStats();
  } catch {
    document.getElementById('oCardsGrid').innerHTML = '<div class="loading-cell">Failed to load options.</div>';
  }
}

function updateOptionStats() {
  const open   = allOptions.filter(o => o.status === 'open').length;
  const closed  = allOptions.filter(o => o.status === 'closed').length;
  const pnlSum  = allOptions.filter(o => o.realizedPnlPct != null)
    .reduce((s, o) => s + o.realizedPnlPct, 0);
  document.getElementById('oStatOpen').textContent   = open;
  document.getElementById('oStatClosed').textContent = closed;
  document.getElementById('oStatPnl').textContent    = closed ? (pnlSum >= 0 ? '+' : '') + pnlSum.toFixed(2) + '%' : '—';
}

function applyOptionFilters() {
  const q      = document.getElementById('oSearchInput').value.toLowerCase();
  const status = document.getElementById('oFilterStatus').value;
  const filtered = allOptions.filter(o => {
    const matchQ = !q || o.ticker.toLowerCase().includes(q);
    const matchS = !status || o.status === status;
    return matchQ && matchS;
  });
  renderOptionCards(filtered);
  renderOptionTable(filtered);
}

function dirBadgeClass(dir) {
  if (dir === 'CALL') return 'dir-buy';
  if (dir === 'PUT')  return 'dir-sell';
  return 'dir-neutral';
}

function renderOptionCards(options) {
  const grid = document.getElementById('oCardsGrid');
  if (!options.length) {
    grid.innerHTML = '<div class="empty-state">No options trades found.</div>';
    return;
  }
  grid.innerHTML = options.map(o => {
    const isClosed = o.status === 'closed';
    const modActions = currentUser?.isMod ? `
      <button class="btn-sm btn-outline" onclick="openEditOptionModal('${o.id}')">Edit</button>
      ${!isClosed ? `<button class="btn-sm btn-primary" onclick="openCloseOptionModal('${o.id}')">Close</button>` : ''}
      <button class="btn-sm btn-danger" onclick="openDeleteOptionModal('${o.id}')">Del</button>` : '';
    return `<div class="trade-card ${isClosed ? 'card-closed' : ''}">
      <div class="card-header">
        <div class="card-ticker">${o.ticker}</div>
        <span class="dir-badge ${dirBadgeClass(o.direction)}">${o.direction}</span>
        <span class="status-badge status-${o.status}">${o.status}</span>
      </div>
      <div class="card-grid-row">
        <div class="card-cell"><span class="card-cell-label">Strike</span><span class="card-cell-value">$${o.strike}</span></div>
        <div class="card-cell"><span class="card-cell-label">Expiry</span><span class="card-cell-value card-cell-sm">${o.expiryDate ? new Date(o.expiryDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}</span></div>
        <div class="card-cell"><span class="card-cell-label">Contracts</span><span class="card-cell-value">${o.contracts}</span></div>
      </div>
      <div class="card-grid-row">
        <div class="card-cell"><span class="card-cell-label">Premium</span><span class="card-cell-value">$${o.premium}</span></div>
        <div class="card-cell"><span class="card-cell-label">Target</span><span class="card-cell-value">${o.target ? '$'+o.target : '—'}</span></div>
        <div class="card-cell"><span class="card-cell-label">Stop</span><span class="card-cell-value">${o.stopLoss ? '$'+o.stopLoss : '—'}</span></div>
      </div>
      ${isClosed ? `<div class="card-grid-row card-grid-row-last">
        <div class="card-cell"><span class="card-cell-label">Exit Premium</span><span class="card-cell-value">$${o.exitPremium}</span></div>
        <div class="card-cell"><span class="card-cell-label">P&L %</span><span class="card-cell-value ${pnlClass(o.realizedPnlPct)}">${fmtPnl(o.realizedPnlPct)}</span></div>
        <div class="card-cell"><span class="card-cell-label">P&L $</span><span class="card-cell-value ${pnlClass(o.realizedPnlDollar)}">${o.realizedPnlDollar != null ? (o.realizedPnlDollar>=0?'+':'')+'$'+Math.abs(o.realizedPnlDollar).toFixed(2) : '—'}</span></div>
      </div>` : ''}
      <div class="card-footer">
        <span class="card-date">${fmtDate(o.createdAt)}${o.createdBy ? ' · '+o.createdBy : ''}</span>
        <div class="card-footer-actions">${modActions}</div>
      </div>
    </div>`;
  }).join('');
}

function renderOptionTable(options) {
  const tbody = document.getElementById('oTableBody');
  const cols = currentUser?.isMod ? 12 : 11;
  if (!options.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}"><div class="empty-state">No options trades found.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = options.map(o => {
    const modCells = currentUser?.isMod ? `
      <td class="action-cell" onclick="event.stopPropagation()">
        <button class="btn-sm btn-outline" onclick="openEditOptionModal('${o.id}')">Edit</button>
        ${o.status==='open' ? `<button class="btn-sm btn-primary" onclick="openCloseOptionModal('${o.id}')">Close</button>` : ''}
        <button class="btn-sm btn-danger" onclick="openDeleteOptionModal('${o.id}')">Del</button>
      </td>` : '';
    return `<tr>
      <td><div class="trade-ticker">${o.ticker}</div></td>
      <td><span class="dir-badge ${dirBadgeClass(o.direction)}">${o.direction}</span></td>
      <td>$${o.strike}</td>
      <td>${o.expiryDate ? new Date(o.expiryDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) : '—'}</td>
      <td>$${o.premium}</td>
      <td>${o.contracts}</td>
      <td>${o.target ? '$'+o.target : '—'}</td>
      <td>${o.stopLoss ? '$'+o.stopLoss : '—'}</td>
      <td class="${pnlClass(o.realizedPnlPct)} pnl-cell">${fmtPnl(o.realizedPnlPct)}</td>
      <td class="${pnlClass(o.realizedPnlDollar)} pnl-cell">${o.realizedPnlDollar != null ? (o.realizedPnlDollar>=0?'+':'')+'$'+Math.abs(o.realizedPnlDollar).toFixed(2) : '—'}</td>
      <td><span class="status-badge status-${o.status}">${o.status}</span></td>
      ${modCells}
    </tr>`;
  }).join('');
}

function renderOptionActivity() {
  const list  = document.getElementById('oActivityList');
  const count = document.getElementById('oActivityCount');
  const sorted = [...allOptions].sort((a,b) => new Date(b.updatedAt)-new Date(a.updatedAt));
  count.textContent = allOptions.length;
  if (!sorted.length) { list.innerHTML = '<div class="activity-loading">No activity yet.</div>'; return; }
  list.innerHTML = sorted.map(o => {
    const action = o.status === 'closed' ? 'Closed' : 'Opened';
    return `<div class="activity-item">
      <div class="activity-dot dot-${o.status === 'closed' ? 'close' : 'open'}"></div>
      <div class="activity-info">
        <span class="activity-trade">${o.ticker} ${o.direction} — ${action}</span>
        <span class="activity-date">${fmtDate(o.updatedAt)}</span>
      </div>
    </div>`;
  }).join('');
}

function openAddOptionModal() {
  editingOptId = null;
  document.getElementById('optionModalTitle').textContent = 'Add Option Trade';
  document.getElementById('optionForm').reset();
  openModal('optionModal');
}

function openEditOptionModal(id) {
  const o = allOptions.find(x => x.id === id);
  if (!o) return;
  editingOptId = id;
  document.getElementById('optionModalTitle').textContent = 'Edit Option Trade';
  document.getElementById('of-ticker').value    = o.ticker;
  document.getElementById('of-direction').value = o.direction;
  document.getElementById('of-strike').value    = o.strike;
  document.getElementById('of-expiry').value    = o.expiryDate ? o.expiryDate.toString().slice(0,10) : '';
  document.getElementById('of-premium').value   = o.premium;
  document.getElementById('of-contracts').value = o.contracts;
  document.getElementById('of-target').value    = o.target    || '';
  document.getElementById('of-stop').value      = o.stopLoss  || '';
  document.getElementById('of-reasoning').value = o.reasoning || '';
  openModal('optionModal');
}

async function handleOptionSubmit(e) {
  e.preventDefault();
  const body = {
    ticker:    document.getElementById('of-ticker').value,
    direction: document.getElementById('of-direction').value,
    strike:    document.getElementById('of-strike').value,
    expiryDate:document.getElementById('of-expiry').value,
    premium:   document.getElementById('of-premium').value,
    contracts: document.getElementById('of-contracts').value,
    target:    document.getElementById('of-target').value    || null,
    stopLoss:  document.getElementById('of-stop').value      || null,
    reasoning: document.getElementById('of-reasoning').value || ''
  };
  const url    = editingOptId ? `/api/options/${editingOptId}` : '/api/options';
  const method = editingOptId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (res.ok) { closeModal('optionModal'); loadOptions(); }
  else { const d = await res.json(); alert(d.error || 'Error saving option trade.'); }
}

function openCloseOptionModal(id) {
  const o = allOptions.find(x => x.id === id);
  if (!o) return;
  closingOptId = id;
  document.getElementById('closeOptionTicker').textContent = `${o.ticker} ${o.direction}`;
  document.getElementById('closeOptionForm').reset();
  openModal('closeOptionModal');
}

async function handleCloseOptionSubmit(e) {
  e.preventDefault();
  const body = {
    exitPremium: document.getElementById('co-exitPremium').value,
    note:        document.getElementById('co-note').value
  };
  const res = await fetch(`/api/options/${closingOptId}/close`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  if (res.ok) { closeModal('closeOptionModal'); loadOptions(); }
  else alert('Error closing option trade.');
}

function openDeleteOptionModal(id) {
  const o = allOptions.find(x => x.id === id);
  if (!o) return;
  deletingOptId = id;
  document.getElementById('deleteOptionName').textContent = `${o.ticker} ${o.direction}`;
  openModal('deleteOptionModal');
}

async function handleDeleteOption() {
  const res = await fetch(`/api/options/${deletingOptId}`, { method: 'DELETE' });
  if (res.ok) { closeModal('deleteOptionModal'); loadOptions(); }
  else alert('Error deleting option trade.');
}

// ─── Challenges state ─────────────────────────────────────────
let allChallenges       = [];
let activeChallengeId   = null;
let activeChallenge     = null;
let editingChallengeId  = null;
let editingCTId         = null;
let closingCTId         = null;
let deletingChallengeId = null;

async function loadChallenges() {
  const res = await fetch('/api/challenges');
  allChallenges = await res.json();
  renderChallengeCards();
}

async function loadChallengeDetail(id) {
  const res  = await fetch(`/api/challenges/${id}`);
  activeChallenge = await res.json();
  activeChallengeId = id;
  document.getElementById('challengeListView').classList.add('section-hidden');
  document.getElementById('challengeDetailView').classList.remove('section-hidden');
  renderChallengeDetail();
}

function renderChallengeCards() {
  const grid = document.getElementById('challengeCards');
  if (!allChallenges.length) {
    grid.innerHTML = '<div class="empty-state">No challenges yet. Create the first one!</div>';
    return;
  }
  grid.innerHTML = allChallenges.map(ch => {
    const pct     = Math.min(100, ((ch.currentBalance - ch.startingBalance) / (ch.targetBalance - ch.startingBalance)) * 100);
    const pnl     = ch.currentBalance - ch.startingBalance;
    const pnlSign = pnl >= 0 ? '+' : '';
    const statusColor = ch.status === 'completed' ? 'status-closed' : ch.status === 'failed' ? 'status-partial' : 'status-open';
    const modBtns = currentUser?.isMod ? `
      <button class="btn-sm btn-outline" onclick="openEditChallengeModal('${ch.id}',event)">Edit</button>
      <button class="btn-sm btn-danger" onclick="openDeleteChallengeModal('${ch.id}',event)">Del</button>` : '';
    return `<div class="trade-card challenge-card" onclick="loadChallengeDetail('${ch.id}')">
      <div class="card-header">
        <div class="card-ticker">${ch.name}</div>
        <span class="status-badge ${statusColor}">${ch.status}</span>
      </div>
      <div class="challenge-progress-bar" style="margin:0.75rem 0 0.25rem">
        <div class="challenge-progress-fill" style="width:${pct.toFixed(1)}%"></div>
      </div>
      <div class="challenge-meta">
        <span>$${ch.startingBalance.toLocaleString()}</span>
        <strong>${pct.toFixed(1)}%</strong>
        <span>$${ch.targetBalance.toLocaleString()}</span>
      </div>
      <div class="card-grid-row" style="margin-top:0.5rem">
        <div class="card-cell"><span class="card-cell-label">Current</span><span class="card-cell-value">$${ch.currentBalance.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
        <div class="card-cell"><span class="card-cell-label">P&L</span><span class="card-cell-value ${pnl>=0?'pnl-pos':'pnl-neg'}">${pnlSign}$${Math.abs(pnl).toFixed(2)}</span></div>
        <div class="card-cell"><span class="card-cell-label">Target</span><span class="card-cell-value">$${ch.targetBalance.toLocaleString()}</span></div>
      </div>
      <div class="card-footer">
        <span class="card-date">${fmtDate(ch.createdAt)}${ch.createdBy ? ' · '+ch.createdBy : ''}</span>
        <div class="card-footer-actions">${modBtns}</div>
      </div>
    </div>`;
  }).join('');
}

function renderChallengeDetail() {
  const ch = activeChallenge;
  document.getElementById('challengeDetailName').textContent = ch.name;
  const pct = Math.min(100, ((ch.currentBalance - ch.startingBalance) / (ch.targetBalance - ch.startingBalance)) * 100);
  const pnl = ch.currentBalance - ch.startingBalance;
  document.getElementById('cdCurrentBal').textContent = '$' + ch.currentBalance.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('cdTargetBal').textContent  = '$' + ch.targetBalance.toLocaleString();
  document.getElementById('cdProgressPct').textContent = pct.toFixed(1) + '%';
  document.getElementById('cdProgressFill').style.width = pct.toFixed(1) + '%';
  document.getElementById('cdStartBal').textContent  = 'Started: $' + ch.startingBalance.toLocaleString();
  document.getElementById('cdStatus').textContent    = ch.status.toUpperCase();
  document.getElementById('cdPnlTotal').textContent  = (pnl>=0?'+':'') + '$' + pnl.toFixed(2);
  renderChallengeTradeCards(ch.trades || []);
  renderChallengeTradeTable(ch.trades || []);
}

function renderChallengeTradeCards(trades) {
  const grid = document.getElementById('ctCardsGrid');
  if (!trades.length) { grid.innerHTML = '<div class="empty-state">No trades yet.</div>'; return; }
  grid.innerHTML = trades.map(t => {
    const isClosed = t.status === 'closed';
    const modActions = currentUser?.isMod ? `
      <button class="btn-sm btn-outline" onclick="openEditCTModal('${t.id}')">Edit</button>
      ${!isClosed ? `<button class="btn-sm btn-primary" onclick="openCloseCTModal('${t.id}')">Close</button>` : ''}
      <button class="btn-sm btn-danger" onclick="deleteCT('${t.id}')">Del</button>` : '';
    return `<div class="trade-card ${isClosed ? 'card-closed' : ''}">
      <div class="card-header">
        <div class="card-ticker">${t.ticker}</div>
        <span class="dir-badge ${dirBadgeClass(t.direction)}">${t.direction}</span>
        <span class="status-badge status-${t.status}">${t.status}</span>
      </div>
      <div class="card-grid-row">
        <div class="card-cell"><span class="card-cell-label">Strike</span><span class="card-cell-value">$${t.strike}</span></div>
        <div class="card-cell"><span class="card-cell-label">Expiry</span><span class="card-cell-value card-cell-sm">${t.expiryDate ? new Date(t.expiryDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}</span></div>
        <div class="card-cell"><span class="card-cell-label">Contracts</span><span class="card-cell-value">${t.contracts}</span></div>
      </div>
      <div class="card-grid-row ${isClosed ? '' : 'card-grid-row-last'}">
        <div class="card-cell"><span class="card-cell-label">Premium</span><span class="card-cell-value">$${t.premium}</span></div>
        <div class="card-cell"><span class="card-cell-label">Target</span><span class="card-cell-value">${t.target?'$'+t.target:'—'}</span></div>
        <div class="card-cell"><span class="card-cell-label">Stop</span><span class="card-cell-value">${t.stopLoss?'$'+t.stopLoss:'—'}</span></div>
      </div>
      ${isClosed ? `<div class="card-grid-row card-grid-row-last">
        <div class="card-cell"><span class="card-cell-label">Exit</span><span class="card-cell-value">$${t.exitPremium}</span></div>
        <div class="card-cell"><span class="card-cell-label">P&L %</span><span class="card-cell-value ${pnlClass(t.realizedPnlPct)}">${fmtPnl(t.realizedPnlPct)}</span></div>
        <div class="card-cell"><span class="card-cell-label">P&L $</span><span class="card-cell-value ${pnlClass(t.realizedPnlDollar)}">${t.realizedPnlDollar!=null?(t.realizedPnlDollar>=0?'+':'')+'$'+Math.abs(t.realizedPnlDollar).toFixed(2):'—'}</span></div>
      </div>` : ''}
      <div class="card-footer">
        <span class="card-date">${fmtDate(t.createdAt)}${t.createdBy?' · '+t.createdBy:''}</span>
        <div class="card-footer-actions">${modActions}</div>
      </div>
    </div>`;
  }).join('');
}

function renderChallengeTradeTable(trades) {
  const tbody = document.getElementById('ctTableBody');
  const cols = currentUser?.isMod ? 12 : 11;
  if (!trades.length) { tbody.innerHTML = `<tr><td colspan="${cols}"><div class="empty-state">No trades.</div></td></tr>`; return; }
  tbody.innerHTML = trades.map(t => {
    const modCells = currentUser?.isMod ? `<td class="action-cell">
      <button class="btn-sm btn-outline" onclick="openEditCTModal('${t.id}')">Edit</button>
      ${t.status==='open'?`<button class="btn-sm btn-primary" onclick="openCloseCTModal('${t.id}')">Close</button>`:''}
      <button class="btn-sm btn-danger" onclick="deleteCT('${t.id}')">Del</button></td>` : '';
    return `<tr>
      <td>${t.ticker}</td>
      <td><span class="dir-badge ${dirBadgeClass(t.direction)}">${t.direction}</span></td>
      <td>$${t.strike}</td>
      <td>${t.expiryDate?new Date(t.expiryDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}):'—'}</td>
      <td>$${t.premium}</td><td>${t.contracts}</td>
      <td>${t.target?'$'+t.target:'—'}</td><td>${t.stopLoss?'$'+t.stopLoss:'—'}</td>
      <td class="${pnlClass(t.realizedPnlPct)} pnl-cell">${fmtPnl(t.realizedPnlPct)}</td>
      <td class="${pnlClass(t.realizedPnlDollar)} pnl-cell">${t.realizedPnlDollar!=null?(t.realizedPnlDollar>=0?'+':'')+'$'+Math.abs(t.realizedPnlDollar).toFixed(2):'—'}</td>
      <td><span class="status-badge status-${t.status}">${t.status}</span></td>
      ${modCells}
    </tr>`;
  }).join('');
}

// Challenge modals
function openAddChallengeModal() {
  editingChallengeId = null;
  document.getElementById('challengeModalTitle').textContent = 'New Challenge';
  document.getElementById('challengeForm').reset();
  openModal('challengeModal');
}

function openEditChallengeModal(id, e) {
  e?.stopPropagation();
  const ch = allChallenges.find(c => c.id === id);
  if (!ch) return;
  editingChallengeId = id;
  document.getElementById('challengeModalTitle').textContent = 'Edit Challenge';
  document.getElementById('ch-name').value      = ch.name;
  document.getElementById('ch-start').value     = ch.startingBalance;
  document.getElementById('ch-target').value    = ch.targetBalance;
  document.getElementById('ch-startdate').value = ch.startDate ? ch.startDate.toString().slice(0,10) : '';
  document.getElementById('ch-enddate').value   = ch.endDate   ? ch.endDate.toString().slice(0,10)   : '';
  document.getElementById('ch-desc').value      = ch.description || '';
  openModal('challengeModal');
}

async function handleChallengeSubmit(e) {
  e.preventDefault();
  const body = {
    name:            document.getElementById('ch-name').value,
    description:     document.getElementById('ch-desc').value,
    startingBalance: document.getElementById('ch-start').value,
    targetBalance:   document.getElementById('ch-target').value,
    startDate:       document.getElementById('ch-startdate').value || null,
    endDate:         document.getElementById('ch-enddate').value   || null
  };
  const url    = editingChallengeId ? `/api/challenges/${editingChallengeId}` : '/api/challenges';
  const method = editingChallengeId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (res.ok) { closeModal('challengeModal'); loadChallenges(); }
  else { const d = await res.json(); alert(d.error || 'Error saving challenge.'); }
}

function openDeleteChallengeModal(id, e) {
  e?.stopPropagation();
  const ch = allChallenges.find(c => c.id === id);
  if (!ch) return;
  deletingChallengeId = id;
  document.getElementById('deleteChallengeName').textContent = ch.name;
  openModal('deleteChallengeModal');
}

async function handleDeleteChallenge() {
  await fetch(`/api/challenges/${deletingChallengeId}`, { method: 'DELETE' });
  closeModal('deleteChallengeModal');
  loadChallenges();
}

// Challenge trade modals
function openAddCTModal() {
  editingCTId = null;
  document.getElementById('challengeTradeModalTitle').textContent = 'Add Trade';
  document.getElementById('challengeTradeForm').reset();
  openModal('challengeTradeModal');
}

function openEditCTModal(id) {
  const t = activeChallenge.trades.find(x => x.id === id);
  if (!t) return;
  editingCTId = id;
  document.getElementById('challengeTradeModalTitle').textContent = 'Edit Trade';
  document.getElementById('ct-ticker').value    = t.ticker;
  document.getElementById('ct-direction').value = t.direction;
  document.getElementById('ct-strike').value    = t.strike;
  document.getElementById('ct-expiry').value    = t.expiryDate ? t.expiryDate.toString().slice(0,10) : '';
  document.getElementById('ct-premium').value   = t.premium;
  document.getElementById('ct-contracts').value = t.contracts;
  document.getElementById('ct-target').value    = t.target    || '';
  document.getElementById('ct-stop').value      = t.stopLoss  || '';
  document.getElementById('ct-reasoning').value = t.reasoning || '';
  openModal('challengeTradeModal');
}

async function handleCTSubmit(e) {
  e.preventDefault();
  const body = {
    ticker:    document.getElementById('ct-ticker').value,
    direction: document.getElementById('ct-direction').value,
    strike:    document.getElementById('ct-strike').value,
    expiryDate:document.getElementById('ct-expiry').value,
    premium:   document.getElementById('ct-premium').value,
    contracts: document.getElementById('ct-contracts').value,
    target:    document.getElementById('ct-target').value    || null,
    stopLoss:  document.getElementById('ct-stop').value      || null,
    reasoning: document.getElementById('ct-reasoning').value || ''
  };
  const url    = editingCTId
    ? `/api/challenges/${activeChallengeId}/trades/${editingCTId}`
    : `/api/challenges/${activeChallengeId}/trades`;
  const method = editingCTId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (res.ok) { closeModal('challengeTradeModal'); loadChallengeDetail(activeChallengeId); }
  else { const d = await res.json(); alert(d.error || 'Error saving trade.'); }
}

function openCloseCTModal(id) {
  const t = activeChallenge.trades.find(x => x.id === id);
  if (!t) return;
  closingCTId = id;
  document.getElementById('closeCTTicker').textContent = `${t.ticker} ${t.direction}`;
  document.getElementById('closeChallengeTradeForm').reset();
  openModal('closeChallengeTradeModal');
}

async function handleCloseCTSubmit(e) {
  e.preventDefault();
  const body = {
    exitPremium: document.getElementById('cct-exitPremium').value,
    note:        document.getElementById('cct-note').value
  };
  const res = await fetch(`/api/challenges/${activeChallengeId}/trades/${closingCTId}/close`, {
    method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  if (res.ok) { closeModal('closeChallengeTradeModal'); loadChallengeDetail(activeChallengeId); }
  else alert('Error closing trade.');
}

async function deleteCT(id) {
  if (!confirm('Delete this trade?')) return;
  await fetch(`/api/challenges/${activeChallengeId}/trades/${id}`, { method: 'DELETE' });
  loadChallengeDetail(activeChallengeId);
}

// ─── Section switching ────────────────────────────────────────
function switchSection(sectionId) {
  document.querySelectorAll('.nav-section').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });
  ['stocksSection','optionsSection','challengesSection'].forEach(id => {
    document.getElementById(id).classList.toggle('section-hidden', id !== sectionId);
  });
  if (sectionId === 'optionsSection'   && !allOptions.length)    loadOptions();
  if (sectionId === 'challengesSection' && !allChallenges.length) loadChallenges();
}

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  // Section tabs
  document.querySelectorAll('.nav-section').forEach(btn => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });

  // Stocks filters
  document.getElementById('searchInput').addEventListener('input', applyFilters);
  document.getElementById('filterStatus').addEventListener('change', applyFilters);

  // Options filters
  document.getElementById('oSearchInput').addEventListener('input', applyOptionFilters);
  document.getElementById('oFilterStatus').addEventListener('change', applyOptionFilters);

  // View tabs (stocks + options share the same class)
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.querySelectorAll('[data-oview]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-oview]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('#optionsSection .view-panel').forEach(p => p.classList.add('view-panel-hidden'));
      document.getElementById(btn.dataset.oview).classList.remove('view-panel-hidden');
    });
  });

  // Stocks mod controls
  document.getElementById('addTradeBtn').addEventListener('click', openAddModal);
  document.getElementById('fetchTickerBtn').addEventListener('click', fetchTickerInfo);
  document.getElementById('f-ticker').addEventListener('input', () => {
    document.getElementById('tickerStatus').textContent = '';
    document.getElementById('tickerStatus').className  = 'ticker-status';
    document.getElementById('fetchedPriceHint').textContent = '';
  });
  document.getElementById('f-ticker').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); fetchTickerInfo(); }
  });
  document.getElementById('u-type').addEventListener('change', handleTypeChange);
  document.getElementById('tradeForm').addEventListener('submit', handleTradeSubmit);
  document.getElementById('updateForm').addEventListener('submit', handleUpdateSubmit);
  document.getElementById('confirmDeleteBtn').addEventListener('click', handleDelete);

  // Options mod controls
  document.getElementById('addOptionBtn').addEventListener('click', openAddOptionModal);
  document.getElementById('optionForm').addEventListener('submit', handleOptionSubmit);
  document.getElementById('closeOptionForm').addEventListener('submit', handleCloseOptionSubmit);
  document.getElementById('confirmDeleteOptionBtn').addEventListener('click', handleDeleteOption);

  // Challenges controls
  document.getElementById('addChallengeBtn').addEventListener('click', openAddChallengeModal);
  document.getElementById('challengeForm').addEventListener('submit', handleChallengeSubmit);
  document.getElementById('confirmDeleteChallengeBtn').addEventListener('click', handleDeleteChallenge);
  document.getElementById('backToChallengesBtn').addEventListener('click', () => {
    document.getElementById('challengeDetailView').classList.add('section-hidden');
    document.getElementById('challengeListView').classList.remove('section-hidden');
  });
  document.getElementById('addChallengeTradeBtn').addEventListener('click', openAddCTModal);
  document.getElementById('challengeTradeForm').addEventListener('submit', handleCTSubmit);
  document.getElementById('closeChallengeTradeForm').addEventListener('submit', handleCloseCTSubmit);
  document.querySelectorAll('[data-ctview]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-ctview]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('ctCardView').classList.add('view-panel-hidden');
      document.getElementById('ctTableView').classList.add('view-panel-hidden');
      document.getElementById(btn.dataset.ctview).classList.remove('view-panel-hidden');
    });
  });

  // Close buttons (all modals)
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
});
