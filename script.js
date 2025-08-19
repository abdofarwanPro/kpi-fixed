let currentTab = 'pick';
let userMappings = {};

// Load user mappings from localStorage
function loadUserMappings() {
    const saved = localStorage.getItem('userMappings');
    if (saved) {
        userMappings = JSON.parse(saved);
        displayUserMappings();
    }
}

// Save user mappings to localStorage
function saveUserMappings() {
    localStorage.setItem('userMappings', JSON.stringify(userMappings));
}

// Display user mappings
function displayUserMappings() {
    const list = document.getElementById('userMappingsList');
    list.innerHTML = '';
    
    Object.keys(userMappings).forEach(userId => {
        const div = document.createElement('div');
        div.innerHTML = `${userId} → ${userMappings[userId]} <button onclick="removeMapping('${userId}')">Remove</button>`;
        list.appendChild(div);
    });
}

// Add user mapping
function addUserMapping() {
    const userIdInput = document.getElementById('userId');
    const nameInput = document.getElementById('userName');
    
    const userId = userIdInput.value.trim();
    const name = nameInput.value.trim();
    
    if (userId && name) {
        userMappings[userId] = name;
        saveUserMappings();
        displayUserMappings();
        userIdInput.value = '';
        nameInput.value = '';
    }
}

// Remove user mapping
function removeMapping(userId) {
    delete userMappings[userId];
    saveUserMappings();
    displayUserMappings();
}

// Clear all mappings
function clearMappings() {
    userMappings = {};
    localStorage.removeItem('userMappings');
    displayUserMappings();
}

// Get user display name
function getUserDisplay(userId) {
    return userMappings[userId] ? `${userId}/${userMappings[userId]}` : userId;
}

// Tab switching
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(tabName).style.display = 'block';
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
    
    currentTab = tabName;
}

// CSV parsing
function parseCSV(text) {
    const lines = text.split('\n');
    return lines.map(line => {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }).filter(row => row.length > 1);
}

// Data processing
function processFile(type) {
    const fileInput = document.getElementById(type + 'File');
    const files = fileInput.files;
    
    if (files.length === 0) {
        alert('Please select at least one CSV file.');
        return;
    }
    
    let processedFiles = 0;
    let allTransactions = [];
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const csv = e.target.result;
            const data = parseCSV(csv);
            const transactions = extractTransactions(data, type);
            allTransactions = allTransactions.concat(transactions);
            
            processedFiles++;
            if (processedFiles === files.length) {
                // All files processed, generate table
                const grouped = groupByUserAndHour(allTransactions);
                generateTable(grouped, type);
                document.getElementById(`export${type.charAt(0).toUpperCase() + type.slice(1)}`).disabled = false;
                document.getElementById(`copy${type.charAt(0).toUpperCase() + type.slice(1)}`).disabled = false;
            }
        };
        reader.readAsText(file);
    });
}

function extractTransactions(data, type) {
    if (data.length < 2) return [];
    
    // Find column indices dynamically from headers
    const headers = data[1]; // Second row contains the actual column names
    const columnIndices = findColumnIndices(headers);
    
    if (!columnIndices.tran_time || !columnIndices.user_id) {
        alert('Required columns not found. Please ensure your CSV has "tran_time" and "user_id" columns.');
        return [];
    }
    
    if (type === 'replan' && !columnIndices.tag_id) {
        alert('For replan transactions, "tag_id" column is required.');
        return [];
    }
    
    if (type !== 'replan' && !columnIndices.update_qty) {
        alert('For pick/pack/returns transactions, "update_qty" column is required.');
        return [];
    }
    
    const transactions = [];
    
    for (let i = 2; i < data.length; i++) {
        const row = data[i];
        let qty, time, userId;
        
        if (type === 'replan') {
            // For replan, count tag_id entries (1 if tag exists, 0 if empty)
            qty = row[columnIndices.tag_id] && row[columnIndices.tag_id].trim() ? 1 : 0;
        } else {
            // For pick/pack/returns, use update_qty
            qty = parseInt(row[columnIndices.update_qty]) || 0;
        }
        
        time = row[columnIndices.tran_time] || '';
        userId = row[columnIndices.user_id] || '';
        
        if (!time || !userId || qty === 0) continue;
        
        const timeMatch = time.match(/(\d{1,2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
            transactions.push({
                userId: userId.trim(),
                hour: parseInt(timeMatch[1]),
                quantity: qty
            });
        }
    }
    
    return transactions;
}

function findColumnIndices(headers) {
    const indices = {};
    
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase().trim();
        
        // Map various possible header names to our standard names
        if (header === 'update_qty' || header === 'updateqty' || header === 'quantity') {
            indices.update_qty = i;
        } else if (header === 'tran_time' || header === 'trantime' || header === 'transaction_time' || header === 'time') {
            indices.tran_time = i;
        } else if (header === 'user_id' || header === 'userid' || header === 'user') {
            indices.user_id = i;
        } else if (header === 'tag_id' || header === 'tagid' || header === 'tag') {
            indices.tag_id = i;
        }
    }
    
    return indices;
}

function groupByUserAndHour(transactions) {
    const grouped = {};
    
    transactions.forEach(transaction => {
        if (!grouped[transaction.userId]) {
            grouped[transaction.userId] = {};
        }
        
        if (!grouped[transaction.userId][transaction.hour]) {
            grouped[transaction.userId][transaction.hour] = 0;
        }
        
        grouped[transaction.userId][transaction.hour] += transaction.quantity;
    });
    
    return grouped;
}

function generateTable(grouped, type) {
    const target = getTarget(type);
    const allHours = new Set();
    const userTotals = {};
    
    // Collect all hours and calculate totals
    Object.keys(grouped).forEach(userId => {
        userTotals[userId] = 0;
        Object.keys(grouped[userId]).forEach(hour => {
            allHours.add(parseInt(hour));
            userTotals[userId] += grouped[userId][hour];
        });
    });
    
    const sortedHours = Array.from(allHours).sort((a, b) => a - b);
    
    // Generate table HTML
    let html = '<table><tr><th></th>';
    sortedHours.forEach(hour => {
        html += `<th>${hour.toString().padStart(2, '0')}:00</th>`;
    });
    html += '<th>TOTAL</th></tr>';
    
    Object.keys(grouped).sort().forEach(userId => {
        html += '<tr>';
        html += `<td class="user-cell">${getUserDisplay(userId)}</td>`;
        
        sortedHours.forEach(hour => {
            const count = grouped[userId][hour] || 0;
            let cellClass = '';
            let displayValue = count;
            
            // If count is 0, display empty and no color
            if (count === 0) {
                cellClass = '';
                displayValue = '';
            } else if (target && count >= target) {
                cellClass = 'green';
            } else if (target) {
                cellClass = 'red';
            }
            
            html += `<td class="${cellClass}">${displayValue}</td>`;
        });
        
        const totalClass = ''; // Remove color highlighting from TOTAL column
        html += `<td class="${totalClass}">${userTotals[userId]}</td>`;
        html += '</tr>';
    });
    
    // Add totals row
    html += '<tr><td class="total-cell">TOTAL</td>';
    const hourTotals = {};
    let grandTotal = 0;
    
    sortedHours.forEach(hour => {
        hourTotals[hour] = 0;
        Object.keys(grouped).forEach(userId => {
            hourTotals[hour] += grouped[userId][hour] || 0;
        });
        grandTotal += hourTotals[hour];
        html += `<td class="total-cell">${hourTotals[hour]}</td>`;
    });
    
    html += `<td class="total-cell">${grandTotal}</td></tr></table>`;
    
    document.getElementById(type + 'Result').innerHTML = html;
}

function getTarget(type) {
    switch(type) {
        case 'pick': return 100;
        case 'pack': return 150;
        case 'returns': return 25;
        case 'replan': return null;
        default: return null;
    }
}

// Export functions
function exportImage(type) {
    const table = document.querySelector(`#${type}Result table`);
    if (!table) {
        alert('No table to export. Please process a file first.');
        return;
    }
    
    html2canvas(table).then(canvas => {
        const link = document.createElement('a');
        link.download = `${type}_transactions.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

function copyTable(type) {
    const table = document.querySelector(`#${type}Result table`);
    if (!table) {
        alert('No table to copy. Please process a file first.');
        return;
    }
    
    // Create a copy of the table with inline styles for email compatibility
    const tableClone = table.cloneNode(true);
    
    // Apply inline styles
    tableClone.style.cssText = 'border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; background-color: #e6f3ff;';
    
    const cells = tableClone.querySelectorAll('td, th');
    cells.forEach(cell => {
        cell.style.cssText = 'border: 1px solid #333; padding: 4px 8px; text-align: center; background-color: #e6f3ff;';
        
        if (cell.classList.contains('green')) {
            cell.style.backgroundColor = '#90EE90';
        } else if (cell.classList.contains('red')) {
            cell.style.backgroundColor = '#FFB6C1';
        } else if (cell.classList.contains('user-cell') || cell.classList.contains('total-cell')) {
            cell.style.backgroundColor = '#b3d9ff';
        }
        
        if (cell.tagName === 'TH') {
            cell.style.backgroundColor = '#cce7ff';
            cell.style.fontWeight = 'bold';
        }
    });
    
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.write) {
        const htmlBlob = new Blob([tableClone.outerHTML], { type: 'text/html' });
        const textBlob = new Blob([table.innerText], { type: 'text/plain' });
        
        const clipboardItem = new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob
        });
        
        navigator.clipboard.write([clipboardItem]).then(() => {
            alert('Table copied to clipboard! You can now paste it into your email.');
        }).catch(() => {
            fallbackCopy(tableClone);
        });
    } else {
        fallbackCopy(tableClone);
    }
}

function fallbackCopy(tableElement) {
    // Fallback method for older browsers
    const range = document.createRange();
    range.selectNode(tableElement);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    
    try {
        document.execCommand('copy');
        alert('Table copied to clipboard! You can now paste it into your email.');
    } catch (err) {
        alert('Copy failed. Please select the table manually and copy it.');
    }
    
    window.getSelection().removeAllRanges();
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    loadUserMappings();
    showTab('pick');
});

