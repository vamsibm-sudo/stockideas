let adminUser = null;
let adminToken = null;
let allStocks = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    loginForm.addEventListener('submit', handleLogin);

    // Close modal buttons
    document.querySelectorAll('.close-btn, .close-stock').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    // New stock button
    document.getElementById('newStockBtn').addEventListener('click', openNewStockModal);

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', switchTab);
    });

    // Stock form
    document.getElementById('stockForm').addEventListener('submit', handleStockSubmit);

    // Export buttons
    document.getElementById('exportJSON').addEventListener('click', () => exportData('json'));
    document.getElementById('exportCSV').addEventListener('click', () => exportData('csv'));

    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Check if already logged in
    const storedUser = localStorage.getItem('adminUser');
    const storedToken = localStorage.getItem('adminToken');
    if (storedUser && storedToken) {
        adminUser = storedUser;
        adminToken = storedToken;
        showDashboard();
    }
});

// Handle login
async function handleLogin(e) {
    e.preventDefault();
    
    const loginCode = document.getElementById('loginCode').value;
    const correctCode = '04022026';

    if (loginCode === correctCode) {
        adminUser = 'admin';
        adminToken = crypto.getRandomValues(new Uint8Array(32)).toString();

        localStorage.setItem('adminUser', adminUser);
        localStorage.setItem('adminToken', adminToken);

        document.getElementById('loginForm').reset();
        showDashboard();
    } else {
        alert('Invalid access code');
    }
}

// Show dashboard
function showDashboard() {
    document.getElementById('loginModal').classList.remove('active');
    document.getElementById('adminDashboard').classList.remove('hidden');
    document.getElementById('adminUser').textContent = `Logged in`;

    loadAdminStocks();
    loadLogs();
}

// Load stocks for admin
async function loadAdminStocks() {
    try {
        const response = await fetch('/api/stocks');  
        allStocks = await response.json();
        displayAdminStocks();
    } catch (error) {
        console.error('Error loading stocks:', error);
    }
}

// Display admin stock list
function displayAdminStocks() {
    const container = document.getElementById('stocksList');

    if (allStocks.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📈</div><h3>No Stock Ideas Yet</h3><p>Create your first stock idea to get started!</p></div>';
        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Ticker</th>
                    <th>Company</th>
                    <th>Entry Price</th>
                    <th>Target Price</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${allStocks.map(stock => `
                    <tr>
                        <td><strong>${stock.ticker}</strong></td>
                        <td>${stock.companyName}</td>
                        <td>$${parseFloat(stock.entryPrice).toFixed(2)}</td>
                        <td>$${parseFloat(stock.targetPrice).toFixed(2)}</td>
                        <td><span class="action-badge action-${stock.action.toLowerCase()}">${stock.action}</span></td>
                        <td><span class="stock-status status-${stock.status}">${stock.status}</span></td>
                        <td class="action-buttons">
                            <button class="btn btn-secondary" onclick="editStock('${stock.id}')">Edit</button>
                            <button class="btn btn-danger" onclick="deleteStock('${stock.id}')">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// Load activity logs
async function loadLogs() {
    try {
        const response = await fetch(`/api/admin/logs?username=admin`);
        const logs = await response.json();

        const container = document.getElementById('logsList');
        if (logs.length === 0) {
            container.innerHTML = '<p>No logs available</p>';
            return;
        }

        container.innerHTML = logs.reverse().map(log => `
            <div class="log-item">
                <div class="log-time">${new Date(log.timestamp).toLocaleString()}</div>
                <div class="log-action">${log.action}</div>
                <div class="log-details">User: ${log.user} | ${log.details}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading logs:', error);
    }
}

// Open new stock modal
function openNewStockModal() {
    document.getElementById('modalTitle').textContent = 'Add New Stock Idea';
    document.getElementById('stockForm').reset();
    document.getElementById('stockForm').dataset.stockId = '';
    document.getElementById('stockModal').classList.add('active');
}

// Edit stock
async function editStock(id) {
    const stock = allStocks.find(s => s.id === id);
    if (!stock) return;

    document.getElementById('modalTitle').textContent = 'Edit Stock Idea';
    document.getElementById('ticker').value = stock.ticker;
    document.getElementById('companyName').value = stock.companyName;
    document.getElementById('currentPrice').value = stock.currentPrice;
    document.getElementById('entryPrice').value = stock.entryPrice;
    document.getElementById('targetPrice').value = stock.targetPrice;
    document.getElementById('stopLoss').value = stock.stopLoss;
    document.getElementById('action').value = stock.action.toLowerCase();
    document.getElementById('confidenceLevel').value = stock.confidenceLevel.toLowerCase();
    document.getElementById('sector').value = stock.sector;
    document.getElementById('timeframe').value = stock.timeframe;
    document.getElementById('reasoning').value = stock.reasoning;
    document.getElementById('riskAnalysis').value = stock.riskAnalysis || '';
    document.getElementById('status').value = stock.status;

    document.getElementById('stockForm').dataset.stockId = id;
    document.getElementById('stockModal').classList.add('active');
}

// Delete stock
async function deleteStock(id) {
    if (!confirm('Are you sure you want to delete this stock idea?')) return;

    try {
        const response = await fetch(`/api/admin/stocks/${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: adminUser, token: adminToken })
        });

        if (response.ok) {
            alert('Stock deleted successfully');
            loadAdminStocks();
            loadLogs();
        } else {
            alert('Error deleting stock');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Handle stock form submit
async function handleStockSubmit(e) {
    e.preventDefault();

    const stockId = document.getElementById('stockForm').dataset.stockId;
    const stockData = {
        ticker: document.getElementById('ticker').value,
        companyName: document.getElementById('companyName').value,
        currentPrice: parseFloat(document.getElementById('currentPrice').value),
        entryPrice: parseFloat(document.getElementById('entryPrice').value),
        targetPrice: parseFloat(document.getElementById('targetPrice').value),
        stopLoss: parseFloat(document.getElementById('stopLoss').value),
        action: document.getElementById('action').value,
        confidenceLevel: document.getElementById('confidenceLevel').value,
        sector: document.getElementById('sector').value,
        timeframe: document.getElementById('timeframe').value,
        reasoning: document.getElementById('reasoning').value,
        riskAnalysis: document.getElementById('riskAnalysis').value,
        status: document.getElementById('status').value
    };

    try {
        const url = stockId 
            ? `/api/admin/stocks/${stockId}`
            : '/api/admin/stocks';
        
        const method = stockId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: adminUser,
                token: adminToken,
                stockData
            })
        });

        if (response.ok) {
            alert(stockId ? 'Stock updated successfully' : 'Stock created successfully');
            closeModal();
            loadAdminStocks();
            loadLogs();
        } else {
            alert('Error saving stock');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error saving stock');
    }
}

// Close modal
function closeModal() {
    document.getElementById('stockModal').classList.remove('active');
}

// Switch tabs
function switchTab(e) {
    const tabName = e.target.dataset.tab;

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    e.target.classList.add('active');
    document.getElementById(tabName).classList.add('active');
}

// Export data
function exportData(format) {
    if (format === 'json') {
        const dataStr = JSON.stringify(allStocks, null, 2);
        downloadFile(dataStr, 'stock-ideas.json', 'application/json');
    } else if (format === 'csv') {
        let csv = 'Ticker,Company,Sector,Action,Entry Price,Target Price,Stop Loss,Status,Confidence,Timeframe,Reasoning\n';
        allStocks.forEach(stock => {
            csv += `"${stock.ticker}","${stock.companyName}","${stock.sector}","${stock.action}",${stock.entryPrice},${stock.targetPrice},${stock.stopLoss},"${stock.status}","${stock.confidenceLevel}","${stock.timeframe}","${stock.reasoning.replace(/"/g, '""')}"\n`;
        });
        downloadFile(csv, 'stock-ideas.csv', 'text/csv');
    }
}

// Download file helper
function downloadFile(content, filename, type) {
    const element = document.createElement('a');
    element.setAttribute('href', `data:${type};charset=utf-8,${encodeURIComponent(content)}`);
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

// Logout
function logout() {
    localStorage.removeItem('adminUser');
    localStorage.removeItem('adminToken');
    adminUser = null;
    adminToken = null;
    location.reload();
}

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    const stockModal = document.getElementById('stockModal');
    if (e.target === stockModal) {
        closeModal();
    }
});
