let allStocks = [];

// Load all stocks
async function loadStocks() {
    try {
        const response = await fetch('/api/stocks');
        allStocks = await response.json();
        displayStocks(allStocks);
    } catch (error) {
        console.error('Error loading stocks:', error);
        document.getElementById('stocksContainer').innerHTML = 
            '<div class="empty-state"><div class="empty-state-icon">❌</div><h3>Error Loading Data</h3><p>Unable to load stock ideas. Please try again later.</p></div>';
    }
}

// Display stocks
function displayStocks(stocks) {
    const container = document.getElementById('stocksContainer');

    if (stocks.length === 0) {
        container.innerHTML = 
            '<div class="empty-state"><div class="empty-state-icon">📊</div><h3>No Stock Ideas Found</h3><p>Check back later for new investment opportunities!</p></div>';
        return;
    }

    container.innerHTML = stocks.map(stock => `
        <div class="stock-card" onclick="viewDetails('${stock.id}')">
            <div class="stock-header">
                <div>
                    <div class="stock-ticker">${stock.ticker}</div>
                    <div class="stock-company">${stock.companyName}</div>
                </div>
                <span class="stock-status status-${stock.status}">${stock.status.toUpperCase()}</span>
            </div>

            <div class="stock-sector">${capitalizeFirst(stock.sector)}</div>

            <div class="stock-prices">
                <div class="price-item">
                    <div class="price-label">Entry Price</div>
                    <div class="price-value">$${parseFloat(stock.entryPrice).toFixed(2)}</div>
                </div>
                <div class="price-item">
                    <div class="price-label">Target Price</div>
                    <div class="price-value" style="color: var(--success-color);">$${parseFloat(stock.targetPrice).toFixed(2)}</div>
                </div>
            </div>

            <div class="stock-prices">
                <div class="price-item">
                    <div class="price-label">Stop Loss</div>
                    <div class="price-value" style="color: var(--danger-color);">$${parseFloat(stock.stopLoss).toFixed(2)}</div>
                </div>
                <div class="price-item">
                    <div class="price-label">Current Price</div>
                    <div class="price-value">$${parseFloat(stock.currentPrice).toFixed(2)}</div>
                </div>
            </div>

            <div class="stock-action">
                <div class="action-badge action-${stock.action.toLowerCase()}">
                    <strong>${stock.action.toUpperCase()}</strong>
                </div>
            </div>

            <div class="stock-confidence confidence-${stock.confidenceLevel.toLowerCase()}">
                📊 Confidence: ${capitalizeFirst(stock.confidenceLevel)}
            </div>

            <div class="stock-reasoning">
                <strong>Why:</strong> ${stock.reasoning.substring(0, 100)}...
            </div>

            <div class="stock-footer">
                <span>📅 ${new Date(stock.createdAt).toLocaleDateString()}</span>
                <span>⏱️ ${stock.timeframe}</span>
            </div>
        </div>
    `).join('');
}

// Filter stocks
function filterStocks() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const status = document.getElementById('filterStatus').value;
    const timeframe = document.getElementById('filterTimeframe').value;

    const filtered = allStocks.filter(stock => {
        const matchesSearch = stock.ticker.toLowerCase().includes(search) || 
                            stock.companyName.toLowerCase().includes(search);
        const matchesStatus = !status || stock.status === status;
        const matchesTimeframe = !timeframe || stock.timeframe === timeframe;

        return matchesSearch && matchesStatus && matchesTimeframe;
    });

    displayStocks(filtered);
}

// View stock details (optional modal)
function viewDetails(id) {
    const stock = allStocks.find(s => s.id === id);
    if (stock) {
        alert(`${stock.ticker} - ${stock.companyName}\n\nReasoning: ${stock.reasoning}\n\nRisk Analysis: ${stock.riskAnalysis || 'N/A'}`);
    }
}

// Utility functions
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
