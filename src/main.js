const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const Tray = electron.Tray;
const Menu = electron.Menu;
const ipcMain = electron.ipcMain;
const dialog = electron.dialog;
const shell = electron.shell;
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const FileWatcher = require('./services/fileWatcher');
const UploadManager = require('./services/uploadManager');
const Logger = require('./services/logger');
require('dotenv').config();

// Initialize services
const store = new Store();
let logger, uploadManager, fileWatcher;

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Single instance lock - temporarily disabled
// const gotTheLock = app.requestSingleInstanceLock();

// if (!gotTheLock) {
//   app.quit();
// } else {
//   app.on('second-instance', () => {
//     if (mainWindow) {
//       if (mainWindow.isMinimized()) mainWindow.restore();
//       mainWindow.focus();
//     }
//   });
// }

// App initialization
app.whenReady().then(async () => {
  await initializeApp();
});

app.on('window-all-closed', () => {
  // Don't quit on window close, keep running in tray
  if (process.platform !== 'darwin') {
    // Keep app running
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

async function initializeApp() {
  try {
    // Initialize services
    logger = new Logger();
    uploadManager = new UploadManager(logger, store);
    fileWatcher = new FileWatcher(logger, uploadManager, store);

    // Configure system startup
    app.setLoginItemSettings({
      openAtLogin: store.get('runOnStartup', true),
      path: app.getPath('exe')
    });

    // Check first-time setup
    if (!store.get('configured')) {
      await runFirstTimeSetup();
    }

    // Create main window
    createWindow();

    // Create system tray
    createTray();

    // Start file watcher
    const watchedFolder = store.get('watchedFolder') || process.env.WATCHED_FOLDER;
    if (watchedFolder && store.get('autoStart', true)) {
      await fileWatcher.start(watchedFolder);
      logger.info('File watcher started', { folder: watchedFolder });
    }

    // Start upload manager
    uploadManager.start();

    // Setup IPC handlers
    setupIpcHandlers();

    logger.info('Application initialized successfully');

  } catch (error) {
    logger.error('Failed to initialize application', { error: error.message });
    dialog.showErrorBox('Initialization Error', `Failed to start application: ${error.message}`);
    app.quit();
  }
}

function createWindow() {
  const windowOptions = {
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: 'Claims Scanner',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false // Start hidden if auto-minimize enabled
  };

  // Temporarily remove icon
  // const iconPath = path.join(__dirname, 'assets', 'icon.png');
  // if (fs.existsSync(iconPath) && fs.statSync(iconPath).size > 100) {
  //   windowOptions.icon = iconPath;
  // }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (!store.get('startMinimized', false)) {
      mainWindow.show();
    }
  });

  // Handle window close
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      // Show notification on first minimize
      if (!store.get('seenMinimizeNotification')) {
        const balloonOptions = {
          title: 'Claims Scanner',
          content: 'App is still running in the system tray. Click the icon to open.'
        };

        // Temporarily remove balloon icon
        // const balloonIconPath = path.join(__dirname, 'assets', 'icon.png');
        // if (fs.existsSync(balloonIconPath) && fs.statSync(balloonIconPath).size > 100) {
        //   balloonOptions.icon = balloonIconPath;
        // }

        tray.displayBalloon(balloonOptions);
        store.set('seenMinimizeNotification', true);
      }
    }
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  let iconPath;

  if (process.platform === 'win32') {
    iconPath = path.join(__dirname, 'assets', 'icon.ico');
    if (!fs.existsSync(iconPath) || fs.statSync(iconPath).size < 100) {
      // Use default icon if custom icon doesn't exist
      iconPath = undefined;
    }
  } else {
    iconPath = path.join(__dirname, 'assets', 'icon.png');
    if (!fs.existsSync(iconPath) || fs.statSync(iconPath).size < 100) {
      // Use default icon if custom icon doesn't exist
      iconPath = undefined;
    }
  }

  // Create tray with default icon if custom icon not available
  tray = new Tray(iconPath || undefined);

  updateTrayMenu();

  tray.setToolTip('Claims Scanner - Ready');

  // Double click to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
}

function updateTrayMenu() {
  const queueSize = uploadManager.getQueueSize();
  const isWatching = fileWatcher.isWatching();
  const watchedFolder = store.get('watchedFolder', 'Not set');

  const menuItems = [
    {
      label: 'Claims Scanner',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { type: 'separator' },
    {
      label: `Status: ${isWatching ? '🟢 Watching' : '🔴 Stopped'}`,
      enabled: false
    },
    {
      label: `Folder: ${watchedFolder}`,
      enabled: false
    },
    {
      label: `Queue: ${queueSize} files`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: isWatching ? 'Pause Watching' : 'Resume Watching',
      click: () => toggleWatching()
    },
    {
      label: 'Open Watched Folder',
      click: () => {
        const folder = store.get('watchedFolder');
        if (folder && fs.existsSync(folder)) {
          shell.openPath(folder);
        } else {
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Folder Not Found',
            message: 'Watched folder does not exist. Please configure in settings.'
          });
        }
      }
    },
    {
      label: 'View Logs',
      click: () => {
        const logFolder = logger.getLogFolder();
        shell.openPath(logFolder);
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('navigate-to', 'settings');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];

  // Temporarily remove menu icon
  // const menuIconPath = path.join(__dirname, 'assets', 'icon.png');
  // if (fs.existsSync(menuIconPath) && fs.statSync(menuIconPath).size > 100) {
  //   menuItems[0].icon = menuIconPath;
  // }

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

async function toggleWatching() {
  try {
    if (fileWatcher.isWatching()) {
      await fileWatcher.stop();
      logger.info('File watching paused by user');
      tray.displayBalloon({
        title: 'Watching Paused',
        content: 'File monitoring has been paused'
      });
    } else {
      const watchedFolder = store.get('watchedFolder');
      if (!watchedFolder) {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'No Folder Configured',
          message: 'Please configure a watched folder in settings first.'
        });
        return;
      }
      await fileWatcher.start(watchedFolder);
      logger.info('File watching resumed by user');
      tray.displayBalloon({
        title: 'Watching Resumed',
        content: `Monitoring: ${watchedFolder}`
      });
    }
    updateTrayMenu();
    sendStatusUpdate();
  } catch (error) {
    logger.error('Error toggling watcher', { error: error.message });
    dialog.showErrorBox('Error', `Failed to toggle watcher: ${error.message}`);
  }
}

async function runFirstTimeSetup() {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'First Time Setup',
    message: 'Welcome to Claims Scanner!',
    detail: 'Please select the folder to monitor for scanned claim documents.',
    buttons: ['Select Folder', 'Cancel']
  });

  if (result.response === 0) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Folder to Watch',
      defaultPath: 'C:\\ScannedClaims'
    });

    if (!canceled && filePaths.length > 0) {
      store.set('watchedFolder', filePaths[0]);
      store.set('configured', true);
      logger.info('First time setup completed', { folder: filePaths[0] });
    } else {
      app.quit();
    }
  } else {
    app.quit();
  }
}

function setupIpcHandlers() {
  // Get app status
  ipcMain.handle('get-status', () => ({
    isWatching: fileWatcher.isWatching(),
    watchedFolder: store.get('watchedFolder'),
    queueSize: uploadManager.getQueueSize(),
    todayUploads: uploadManager.getTodayStats(),
    version: app.getVersion()
  }));

  // Get upload queue
  ipcMain.handle('get-queue', () => uploadManager.getQueue());

  // Get statistics
  ipcMain.handle('get-stats', () => uploadManager.getStats());

  // Get recent logs
  ipcMain.handle('get-logs', (event, limit = 100) => logger.getRecentLogs(limit));

  // Settings
  ipcMain.handle('get-settings', () => store.store);

  ipcMain.handle('update-settings', async (event, settings) => {
    try {
      Object.keys(settings).forEach(key => {
        store.set(key, settings[key]);
      });

      // Update startup settings if provided
      if ('runOnStartup' in settings) {
        app.setLoginItemSettings({
          openAtLogin: settings.runOnStartup,
          path: app.getPath('exe')
        });
      }

      // Restart watcher if folder changed
      if (settings.watchedFolder && settings.watchedFolder !== fileWatcher.getCurrentFolder()) {
        await fileWatcher.stop();
        await fileWatcher.start(settings.watchedFolder);
      }

      logger.info('Settings updated', { settings });
      updateTrayMenu();
      return { success: true };
    } catch (error) {
      logger.error('Failed to update settings', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // Select folder
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Folder to Watch'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Retry failed upload
  ipcMain.handle('retry-upload', async (event, taskId) => {
    try {
      await uploadManager.retry(taskId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Clear completed uploads
  ipcMain.handle('clear-completed', async () => {
    uploadManager.clearCompleted();
    return { success: true };
  });

  // Pause/Resume watching
  ipcMain.handle('toggle-watching', async () => {
    await toggleWatching();
    return { success: true, isWatching: fileWatcher.isWatching() };
  });

  // Open folder
  ipcMain.handle('open-folder', async (event, folderType) => {
    let folder;
    switch (folderType) {
      case 'watched':
        folder = store.get('watchedFolder');
        break;
      case 'logs':
        folder = logger.getLogFolder();
        break;
      default:
        return { success: false, error: 'Invalid folder type' };
    }

    if (folder && fs.existsSync(folder)) {
      shell.openPath(folder);
      return { success: true };
    }
    return { success: false, error: 'Folder not found' };
  });

  // Test connection
  ipcMain.handle('test-connection', async () => {
    try {
      const result = await uploadManager.testConnection();
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

// Send status updates to renderer
function sendStatusUpdate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-update', {
      isWatching: fileWatcher.isWatching(),
      queueSize: uploadManager.getQueueSize(),
      todayUploads: uploadManager.getTodayStats()
    });
  }
}

// Update tray periodically
setInterval(() => {
  updateTrayMenu();
}, 30000); // Every 30 seconds

// Listen to upload manager events
uploadManager.on('queue-updated', () => {
  sendStatusUpdate();
  updateTrayMenu();
});

uploadManager.on('upload-success', (data) => {
  logger.info('Upload successful', data);
  sendStatusUpdate();
});

uploadManager.on('upload-failed', (data) => {
  logger.error('Upload failed', data);
  sendStatusUpdate();
});

// Listen to file watcher events
fileWatcher.on('file-detected', (file) => {
  logger.info('New file detected', { file });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('file-detected', file);
  }
});

fileWatcher.on('error', (error) => {
  logger.error('File watcher error', { error: error.message });
});