// State
let currentTab = 'dashboard';
let currentFilter = 'all';
let activityLog = [];

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  await initializeApp();
  setupEventListeners();
  setupIpcListeners();
  startPeriodicUpdates();
});

async function initializeApp() {
  // Load initial data
  await updateStatus();
  await updateQueue();
  await updateStats();
  await loadSettings();
  await loadLogs();

  showToast('Application started', 'success');
}

function setupEventListeners() {
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Dashboard buttons
  document.getElementById('toggleWatchBtn')?.addEventListener('click', toggleWatching);
  document.getElementById('openFolderBtn')?.addEventListener('click', () => openFolder('watched'));
  document.getElementById('clearActivityBtn')?.addEventListener('click', clearActivity);

  // Queue buttons
  document.getElementById('clearCompletedBtn')?.addEventListener('click', clearCompleted);
  document.getElementById('refreshQueueBtn')?.addEventListener('click', updateQueue);

  // Queue filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateQueue();
    });
  });

  // Logs buttons
  document.getElementById('clearLogsBtn')?.addEventListener('click', clearLogDisplay);
  document.getElementById('openLogFolderBtn')?.addEventListener('click', () => openFolder('logs'));
  document.getElementById('logLevelFilter')?.addEventListener('change', loadLogs);

  // Settings buttons
  document.getElementById('selectFolderBtn')?.addEventListener('click', selectFolder);
  document.getElementById('testConnectionBtn')?.addEventListener('click', testConnection);
  document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettings);
  document.getElementById('resetSettingsBtn')?.addEventListener('click', resetSettings);
}

function setupIpcListeners() {
  // Status updates
  window.electronAPI.onStatusUpdate((data) => {
    updateStatusDisplay(data);
  });

  // File detected
  window.electronAPI.onFileDetected((file) => {
    addActivity(`New file detected: ${file.fileName}`, 'info');
  });

  // Log entries
  window.electronAPI.onLogEntry((log) => {
    addLogEntry(log);
  });

  // Navigation
  window.electronAPI.onNavigateTo((page) => {
    switchTab(page);
  });
}

function startPeriodicUpdates() {
  // Update stats every 5 seconds
  setInterval(async () => {
    await updateStatus();
    await updateStats();
  }, 5000);

  // Update queue every 2 seconds when on queue tab
  setInterval(async () => {
    if (currentTab === 'queue') {
      await updateQueue();
    }
  }, 2000);
}

// Tab Management
function switchTab(tabName) {
  currentTab = tabName;

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabName);
  });

  // Load tab-specific data
  if (tabName === 'queue') {
    updateQueue();
  } else if (tabName === 'logs') {
    loadLogs();
  }
}

// Status Management
async function updateStatus() {
  try {
    const status = await window.electronAPI.getStatus();
    updateStatusDisplay(status);
  } catch (error) {
    console.error('Failed to update status:', error);
  }
}

function updateStatusDisplay(status) {
  // Header status
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');

  if (status.isWatching) {
    statusBadge.classList.add('active');
    statusBadge.classList.remove('inactive');
    statusText.textContent = 'Watching';
  } else {
    statusBadge.classList.remove('active');
    statusBadge.classList.add('inactive');
    statusText.textContent = 'Paused';
  }

  // Dashboard watching panel
  document.getElementById('watchingStatus').textContent = status.isWatching ? 'Watching' : 'Paused';
  document.getElementById('watchedFolder').textContent = status.watchedFolder || 'Not set';
  document.getElementById('toggleWatchBtn').textContent = status.isWatching ? 'Pause' : 'Resume';

  // Update queue count badges
  document.getElementById('queueCount').textContent = status.queueSize;
  document.getElementById('queueSize').textContent = status.queueSize;

  // Version
  document.getElementById('versionText').textContent = `v${status.version}`;
}

async function toggleWatching() {
  try {
    const result = await window.electronAPI.toggleWatching();
    if (result.success) {
      showToast(result.isWatching ? 'Watching resumed' : 'Watching paused', 'success');
    }
  } catch (error) {
    showToast('Failed to toggle watching', 'error');
  }
}

// Queue Management
async function updateQueue() {
  try {
    const queue = await window.electronAPI.getQueue();
    displayQueue(queue);
  } catch (error) {
    console.error('Failed to update queue:', error);
  }
}

function displayQueue(queue) {
  const queueList = document.getElementById('queueList');

  // Filter queue
  let filteredQueue = queue;
  if (currentFilter !== 'all') {
    filteredQueue = queue.filter(item => item.status === currentFilter);
  }

  if (filteredQueue.length === 0) {
    queueList.innerHTML = '<div class="empty-state">No files in queue</div>';
    return;
  }

  queueList.innerHTML = filteredQueue.map(item => `
    <div class="queue-item" data-id="${item.id}">
      <div class="queue-item-info">
        <div class="queue-item-name">${item.fileName}</div>
        <div class="queue-item-details">
          Barcode: ${item.barcode} |
          Size: ${formatBytes(item.fileSize)} |
          Added: ${formatTime(item.addedAt)}
          ${item.error ? `<br><span style="color: var(--danger-color);">Error: ${item.error}</span>` : ''}
        </div>
      </div>
      <div class="queue-item-status">
        <span class="status-badge status-${item.status}">${item.status}</span>
        ${item.status === 'failed' ? `
          <button class="btn btn-sm btn-primary" onclick="retryUpload('${item.id}')">
            Retry
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function retryUpload(taskId) {
  try {
    const result = await window.electronAPI.retryUpload(taskId);
    if (result.success) {
      showToast('Retrying upload', 'info');
      await updateQueue();
    }
  } catch (error) {
    showToast('Failed to retry upload', 'error');
  }
}

async function clearCompleted() {
  try {
    await window.electronAPI.clearCompleted();
    showToast('Completed uploads cleared', 'success');
    await updateQueue();
  } catch (error) {
    showToast('Failed to clear completed', 'error');
  }
}

// Stats Management
async function updateStats() {
  try {
    const stats = await window.electronAPI.getStats();

    // Today's stats
    document.getElementById('todayUploads').textContent = stats.today.total;
    document.getElementById('failedCount').textContent = stats.today.failed;

    const successRate = stats.today.total > 0
      ? Math.round((stats.today.success / stats.today.total) * 100)
      : 100;
    document.getElementById('successRate').textContent = `${successRate}%`;

    // All-time stats
    document.getElementById('lifetimeTotal').textContent = stats.allTime.total;
    document.getElementById('lifetimeSuccess').textContent = stats.allTime.success;
    document.getElementById('lifetimeFailed').textContent = stats.allTime.failed;
    document.getElementById('lifetimeSize').textContent = formatBytes(stats.allTime.totalSize);

  } catch (error) {
    console.error('Failed to update stats:', error);
  }
}

// Activity Log
function addActivity(message, type = 'info') {
  const activity = {
    message,
    type,
    timestamp: new Date().toISOString()
  };

  activityLog.unshift(activity);

  // Keep only last 50
  if (activityLog.length > 50) {
    activityLog = activityLog.slice(0, 50);
  }

  updateActivityDisplay();
}

function updateActivityDisplay() {
  const activityList = document.getElementById('activityList');

  if (activityLog.length === 0) {
    activityList.innerHTML = '<div class="empty-state">No recent activity</div>';
    return;
  }

  activityList.innerHTML = activityLog.map(activity => `
    <div class="activity-item">
      <span class="activity-icon">${getActivityIcon(activity.type)}</span>
      <div class="activity-info">
        <div class="activity-title">${activity.message}</div>
        <div class="activity-time">${formatTime(activity.timestamp)}</div>
      </div>
    </div>
  `).join('');
}

function clearActivity() {
  activityLog = [];
  updateActivityDisplay();
}

function getActivityIcon(type) {
  const icons = {
    'info': 'ℹ️',
    'success': '✅',
    'warning': '⚠️',
    'error': '❌'
  };
  return icons[type] || icons.info;
}

// Logs
async function loadLogs() {
  try {
    const logs = await window.electronAPI.getLogs(100);
    const filter = document.getElementById('logLevelFilter')?.value || 'all';

    const filteredLogs = filter === 'all'
      ? logs
      : logs.filter(log => log.level === filter);

    displayLogs(filteredLogs);
  } catch (error) {
    console.error('Failed to load logs:', error);
  }
}

function displayLogs(logs) {
  const logContainer = document.getElementById('logContainer');

  if (logs.length === 0) {
    logContainer.innerHTML = '<div class="empty-state">No logs to display</div>';
    return;
  }

  logContainer.innerHTML = logs.map(log => `
    <div class="log-entry ${log.level}">
      [${new Date(log.timestamp).toLocaleTimeString()}]
      [${log.level.toUpperCase()}]
      ${log.message}
      ${log.meta && Object.keys(log.meta).length > 2 ?
        ` - ${JSON.stringify(log.meta, null, 2)}` : ''}
    </div>
  `).join('');

  // Scroll to bottom
  logContainer.scrollTop = logContainer.scrollHeight;
}

function addLogEntry(log) {
  const logContainer = document.getElementById('logContainer');
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry ${log.level}`;
  logEntry.textContent = `[${new Date(log.timestamp).toLocaleTimeString()}] [${log.level.toUpperCase()}] ${log.message}`;

  logContainer.appendChild(logEntry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function clearLogDisplay() {
  const logContainer = document.getElementById('logContainer');
  logContainer.innerHTML = '<div class="empty-state">Logs cleared</div>';
}

// Settings
async function loadSettings() {
  try {
    const settings = await window.electronAPI.getSettings();

    document.getElementById('watchedFolderInput').value = settings.watchedFolder || '';
    document.getElementById('ignoreExistingFiles').checked = settings.ignoreExistingFiles || false;
    document.getElementById('maxRetries').value = settings.maxRetries || 3;
    document.getElementById('retryDelay').value = (settings.retryDelayMs || 5000) / 1000;
    document.getElementById('maxFileSize').value = settings.maxFileSizeMB || 50;
    document.getElementById('autoStart').checked = settings.autoStart !== false;
    document.getElementById('startMinimized').checked = settings.startMinimized || false;
    document.getElementById('apiUrl').value = settings.apiUrl || process.env.API_URL;

  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

async function selectFolder() {
  try {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      document.getElementById('watchedFolderInput').value = folder;
    }
  } catch (error) {
    showToast('Failed to select folder', 'error');
  }
}

async function saveSettings() {
  try {
    const settings = {
      watchedFolder: document.getElementById('watchedFolderInput').value,
      ignoreExistingFiles: document.getElementById('ignoreExistingFiles').checked,
      maxRetries: parseInt(document.getElementById('maxRetries').value),
      retryDelayMs: parseInt(document.getElementById('retryDelay').value) * 1000,
      maxFileSizeMB: parseInt(document.getElementById('maxFileSize').value),
      autoStart: document.getElementById('autoStart').checked,
      startMinimized: document.getElementById('startMinimized').checked,
      apiUrl: document.getElementById('apiUrl').value
    };

    const result = await window.electronAPI.updateSettings(settings);

    if (result.success) {
      showToast('Settings saved successfully', 'success');
      await updateStatus();
    } else {
      showToast(`Failed to save settings: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('Failed to save settings', 'error');
  }
}

function resetSettings() {
  if (confirm('Are you sure you want to reset all settings to defaults?')) {
    // Reset form to defaults
    document.getElementById('ignoreExistingFiles').checked = false;
    document.getElementById('maxRetries').value = 3;
    document.getElementById('retryDelay').value = 5;
    document.getElementById('maxFileSize').value = 50;
    document.getElementById('autoStart').checked = true;
    document.getElementById('startMinimized').checked = false;

    showToast('Settings reset to defaults. Click Save to apply.', 'info');
  }
}

async function testConnection() {
  const btn = document.getElementById('testConnectionBtn');
  const status = document.getElementById('connectionStatus');

  btn.disabled = true;
  status.textContent = 'Testing...';
  status.className = 'connection-status';

  try {
    const result = await window.electronAPI.testConnection();

    if (result.success && result.result.overall) {
      status.textContent = 'Connected';
      status.classList.add('success');
      showToast('Connection test successful', 'success');
    } else {
      status.textContent = 'Failed';
      status.classList.add('error');
      showToast('Connection test failed', 'error');
    }
  } catch (error) {
    status.textContent = 'Error';
    status.classList.add('error');
    showToast('Connection test error', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function openFolder(type) {
  try {
    const result = await window.electronAPI.openFolder(type);
    if (!result.success) {
      showToast(`Failed to open folder: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('Failed to open folder', 'error');
  }
}

// Utility Functions
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = getToastIcon(type);
  const closeBtn = document.createElement('span');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => toast.remove();

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${message}</span>
  `;
  toast.appendChild(closeBtn);

  toastContainer.appendChild(toast);

  // Auto remove after 5 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 5000);
}

function getToastIcon(type) {
  const icons = {
    'success': '✅',
    'error': '❌',
    'warning': '⚠️',
    'info': 'ℹ️'
  };
  return icons[type] || icons.info;
}