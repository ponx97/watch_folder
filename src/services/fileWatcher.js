const chokidar = require('chokidar');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class FileWatcher extends EventEmitter {
  constructor(logger, uploadManager, store) {
    super();
    this.logger = logger;
    this.uploadManager = uploadManager;
    this.store = store;
    this.watcher = null;
    this.currentFolder = null;
    this.watching = false;
  }

  async start(folderPath) {
    if (this.watching) {
      await this.stop();
    }

    // Validate folder exists
    if (!fs.existsSync(folderPath)) {
      throw new Error(`Folder does not exist: ${folderPath}`);
    }

    this.currentFolder = folderPath;
    this.logger.info('Starting file watcher', { folder: folderPath });

    // Supported file extensions
    const supportedExtensions = ['.tiff', '.tif', '.pdf', '.jpg', '.jpeg', '.png'];

    // Initialize watcher
    this.watcher = chokidar.watch(folderPath, {
      ignored: [
        /(^|[\/\\])\../, // Ignore hidden files
        '**/processed/**', // Ignore processed subfolder
        '**/failed/**',    // Ignore failed subfolder
        '**/temp/**'       // Ignore temp files
      ],
      persistent: true,
      ignoreInitial: this.store.get('ignoreExistingFiles', false),
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2s after file stops changing
        pollInterval: 100
      },
      depth: 2 // Watch up to 2 levels deep (for batch folders)
    });

    // Event handlers
    this.watcher
      .on('add', async (filePath) => {
        try {
          const ext = path.extname(filePath).toLowerCase();

          // Only process supported file types
          if (supportedExtensions.includes(ext)) {
            this.logger.info('New file detected', { file: filePath });
            await this.handleNewFile(filePath);
          }
        } catch (error) {
          this.logger.error('Error handling new file', {
            file: filePath,
            error: error.message
          });
          this.emit('error', error);
        }
      })
      .on('error', (error) => {
        this.logger.error('File watcher error', { error: error.message });
        this.emit('error', error);
      })
      .on('ready', () => {
        this.watching = true;
        this.logger.info('File watcher ready', { folder: folderPath });
        this.emit('ready');
      });

    return this.watcher;
  }

  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.watching = false;
      this.logger.info('File watcher stopped');
    }
  }

  async handleNewFile(filePath) {
    try {
      const fileName = path.basename(filePath);
      const fileExt = path.extname(filePath).substring(1);
      const stats = fs.statSync(filePath);

      // Extract barcode from filename
      const barcode = this.extractBarcode(fileName);

      // Detect if file is in a batch folder
      const batchId = this.detectBatchFolder(filePath);

      // Validate file
      const validation = this.validateFile(filePath, stats);
      if (!validation.valid) {
        this.logger.warn('File validation failed', {
          file: fileName,
          reason: validation.reason
        });
        this.moveToFailed(filePath, validation.reason);
        return;
      }

      // Create upload task
      const task = {
        id: this.generateTaskId(),
        filePath,
        fileName,
        fileExt,
        fileSize: stats.size,
        barcode,
        batchId,
        status: 'pending',
        attempts: 0,
        addedAt: new Date().toISOString(),
        error: null
      };

      // Add to upload queue
      this.uploadManager.addToQueue(task);

      // Emit event
      this.emit('file-detected', task);

      this.logger.info('File added to upload queue', {
        fileName,
        barcode,
        taskId: task.id
      });

    } catch (error) {
      this.logger.error('Error processing new file', {
        file: filePath,
        error: error.message
      });
      throw error;
    }
  }

  extractBarcode(fileName) {
    // Remove extension
    const nameWithoutExt = path.parse(fileName).name;

    // Try to extract barcode patterns:
    // BC001234, BC-001234, BC_001234
    const barcodePattern = /BC[-_]?\d{6,}/i;
    const match = nameWithoutExt.match(barcodePattern);

    if (match) {
      return match[0].toUpperCase().replace(/[-_]/g, '');
    }

    // If no barcode found, generate one
    return this.generateBarcode();
  }

  detectBatchFolder(filePath) {
    const dir = path.dirname(filePath);
    const folderName = path.basename(dir);

    // Check if parent folder name starts with "batch" or "BATCH"
    if (folderName.toLowerCase().startsWith('batch')) {
      return folderName;
    }

    // Check if it's a date-based batch folder (e.g., 20240115)
    if (/^\d{8}$/.test(folderName)) {
      return `BATCH_${folderName}`;
    }

    return null;
  }

  validateFile(filePath, stats) {
    // Check file size
    const maxSize = this.store.get('maxFileSizeMB', 50) * 1024 * 1024; // Convert to bytes
    if (stats.size > maxSize) {
      return {
        valid: false,
        reason: `File size exceeds maximum (${maxSize / 1024 / 1024}MB)`
      };
    }

    const minSize = 1024; // 1KB minimum
    if (stats.size < minSize) {
      return {
        valid: false,
        reason: 'File is too small (possible corrupt file)'
      };
    }

    // Check if file is readable
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (error) {
      return {
        valid: false,
        reason: 'File is not readable'
      };
    }

    // Check file extension
    const ext = path.extname(filePath).toLowerCase();
    const allowedExtensions = ['.tiff', '.tif', '.pdf', '.jpg', '.jpeg', '.png'];
    if (!allowedExtensions.includes(ext)) {
      return {
        valid: false,
        reason: `Unsupported file type: ${ext}`
      };
    }

    return { valid: true };
  }

  moveToFailed(filePath, reason) {
    try {
      const watchedFolder = this.currentFolder;
      const failedDir = path.join(watchedFolder, 'failed');

      // Create failed directory if it doesn't exist
      if (!fs.existsSync(failedDir)) {
        fs.mkdirSync(failedDir, { recursive: true });
      }

      const fileName = path.basename(filePath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const newFileName = `${timestamp}_${fileName}`;
      const newPath = path.join(failedDir, newFileName);

      // Move file
      fs.renameSync(filePath, newPath);

      // Create reason file
      const reasonFile = path.join(failedDir, `${newFileName}.txt`);
      fs.writeFileSync(reasonFile, `Failed: ${reason}\nOriginal: ${filePath}\nTime: ${new Date().toISOString()}`);

      this.logger.info('File moved to failed folder', {
        original: filePath,
        new: newPath,
        reason
      });

    } catch (error) {
      this.logger.error('Error moving file to failed folder', {
        file: filePath,
        error: error.message
      });
    }
  }

  generateBarcode() {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `BC${timestamp.slice(-6)}${random}`;
  }

  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  isWatching() {
    return this.watching;
  }

  getCurrentFolder() {
    return this.currentFolder;
  }
}

module.exports = FileWatcher;