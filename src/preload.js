const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Status
  getStatus: () => ipcRenderer.invoke('get-status'),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (event, data) => callback(data)),

  // Queue
  getQueue: () => ipcRenderer.invoke('get-queue'),
  retryUpload: (taskId) => ipcRenderer.invoke('retry-upload', taskId),
  clearCompleted: () => ipcRenderer.invoke('clear-completed'),

  // Stats
  getStats: () => ipcRenderer.invoke('get-stats'),

  // Logs
  getLogs: (limit) => ipcRenderer.invoke('get-logs', limit),
  onLogEntry: (callback) => ipcRenderer.on('log-entry', (event, log) => callback(log)),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Actions
  toggleWatching: () => ipcRenderer.invoke('toggle-watching'),
  openFolder: (type) => ipcRenderer.invoke('open-folder', type),
  testConnection: () => ipcRenderer.invoke('test-connection'),

  // Events
  onFileDetected: (callback) => ipcRenderer.on('file-detected', (event, file) => callback(file)),
  onNavigateTo: (callback) => ipcRenderer.on('navigate-to', (event, page) => callback(page)),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});