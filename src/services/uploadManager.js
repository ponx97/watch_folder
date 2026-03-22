const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const SftpClient = require('./sftpClient');
const ApiClient = require('./apiClient');

class UploadManager extends EventEmitter {
  constructor(logger, store) {
    super();
    this.logger = logger;
    this.store = store;
    this.queue = [];
    this.processing = false;
    this.currentTask = null;
    this.stats = {
      today: {
        total: 0,
        success: 0,
        failed: 0,
        totalSize: 0
      },
      allTime: this.store.get('stats', {
        total: 0,
        success: 0,
        failed: 0,
        totalSize: 0
      })
    };

    this.sftp = new SftpClient(logger);
    this.api = new ApiClient(logger);

    // Reset today stats at midnight
    this.scheduleStatsReset();
  }

  start() {
    this.logger.info('Upload manager started');
    this.processQueue();
  }

  addToQueue(task) {
    this.queue.push(task);
    this.emit('queue-updated', this.queue);

    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue[0];
      this.currentTask = task;

      // Skip if already completed
      if (task.status === 'completed') {
        this.queue.shift();
        continue;
      }

      // Check if should retry
      const maxRetries = this.store.get('maxRetries', 3);
      if (task.status === 'failed' && task.attempts >= maxRetries) {
        this.logger.warn('Max retries reached, moving to failed', {
          taskId: task.id,
          fileName: task.fileName
        });
        this.moveToFailedFolder(task);
        this.queue.shift();
        this.emit('queue-updated', this.queue);
        continue;
      }

      try {
        // Update status
        task.status = 'uploading';
        task.attempts++;
        this.emit('queue-updated', this.queue);

        // Upload file
        await this.uploadFile(task);

        // Success
        task.status = 'completed';
        task.completedAt = new Date().toISOString();

        // Update stats
        this.updateStats('success', task.fileSize);

        // Move file to processed folder
        this.moveToProcessedFolder(task);

        // Emit success event
        this.emit('upload-success', {
          taskId: task.id,
          fileName: task.fileName,
          barcode: task.barcode
        });

        this.logger.info('Upload successful', {
          taskId: task.id,
          fileName: task.fileName,
          barcode: task.barcode,
          attempts: task.attempts
        });

        // Remove from queue
        this.queue.shift();

      } catch (error) {
        this.logger.error('Upload failed', {
          taskId: task.id,
          fileName: task.fileName,
          error: error.message,
          attempts: task.attempts
        });

        task.status = 'failed';
        task.error = error.message;

        this.updateStats('failed', 0);

        // Emit failure event
        this.emit('upload-failed', {
          taskId: task.id,
          fileName: task.fileName,
          error: error.message,
          attempts: task.attempts
        });

        // Retry or move to failed
        if (task.attempts >= maxRetries) {
          this.moveToFailedFolder(task);
          this.queue.shift();
        } else {
          // Wait before retry
          const retryDelay = this.store.get('retryDelayMs', 5000);
          await this.sleep(retryDelay);
        }
      }

      this.emit('queue-updated', this.queue);
    }

    this.processing = false;
    this.currentTask = null;
  }

  async uploadFile(task) {
    // Read file
    const fileBuffer = fs.readFileSync(task.filePath);

    // Generate storage path
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const storagePath = `dmg-bin/${year}/${month}/${task.barcode}.${task.fileExt}`;

    // Upload to VPS via SFTP
    this.logger.info('Uploading to VPS via SFTP', {
      fileName: task.fileName,
      storagePath
    });

    const uploadResult = await this.sftp.uploadFile(
      storagePath,
      fileBuffer,
      task.fileExt
    );

    if (!uploadResult.success) {
      throw new Error(uploadResult.error);
    }

    // Create database record via API
    this.logger.info('Creating database record', {
      fileName: task.fileName,
      barcode: task.barcode
    });

    const dbResult = await this.api.createDocument({
      file_name: task.barcode,
      original_file_name: task.fileName,
      file_type: task.fileExt,
      file_size_bytes: task.fileSize,
      mime_type: this.getMimeType(task.fileExt),
      storage_bucket: 'claim-documents',
      storage_path: storagePath,
      storage_url: uploadResult.url,
      barcode: task.barcode,
      batch_id: task.batchId,
      scan_date: new Date().toISOString(),
      uploaded_by: this.store.get('uploadUser', 'scanner_app'),
      status: 'dmg_bin'
    });

    if (!dbResult.success) {
      throw new Error(dbResult.error);
    }

    // Store document ID in task
    task.documentId = dbResult.documentId;
    task.workflowId = dbResult.workflowId;
  }

  getMimeType(extension) {
    const mimeTypes = {
      'tiff': 'image/tiff',
      'tif': 'image/tiff',
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png'
    };
    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  moveToProcessedFolder(task) {
    try {
      const processedDir = path.join(
        path.dirname(task.filePath),
        'processed',
        new Date().toISOString().split('T')[0] // Date folder
      );

      if (!fs.existsSync(processedDir)) {
        fs.mkdirSync(processedDir, { recursive: true });
      }

      const newPath = path.join(processedDir, task.fileName);
      fs.renameSync(task.filePath, newPath);

      this.logger.info('File moved to processed folder', {
        original: task.filePath,
        new: newPath
      });

    } catch (error) {
      this.logger.warn('Could not move file to processed folder', {
        file: task.filePath,
        error: error.message
      });
    }
  }

  moveToFailedFolder(task) {
    try {
      const failedDir = path.join(
        path.dirname(task.filePath),
        'failed'
      );

      if (!fs.existsSync(failedDir)) {
        fs.mkdirSync(failedDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const newFileName = `${timestamp}_${task.fileName}`;
      const newPath = path.join(failedDir, newFileName);

      if (fs.existsSync(task.filePath)) {
        fs.renameSync(task.filePath, newPath);

        // Create error log file
        const errorFile = path.join(failedDir, `${newFileName}.txt`);
        fs.writeFileSync(errorFile,
          `Failed upload\n` +
          `Original: ${task.filePath}\n` +
          `Barcode: ${task.barcode}\n` +
          `Attempts: ${task.attempts}\n` +
          `Error: ${task.error}\n` +
          `Time: ${new Date().toISOString()}`
        );
      }

      this.logger.info('File moved to failed folder', {
        original: task.filePath,
        new: newPath
      });

    } catch (error) {
      this.logger.error('Error moving file to failed folder', {
        file: task.filePath,
        error: error.message
      });
    }
  }

  updateStats(result, fileSize) {
    this.stats.today.total++;
    this.stats.allTime.total++;

    if (result === 'success') {
      this.stats.today.success++;
      this.stats.today.totalSize += fileSize;
      this.stats.allTime.success++;
      this.stats.allTime.totalSize += fileSize;
    } else if (result === 'failed') {
      this.stats.today.failed++;
      this.stats.allTime.failed++;
    }

    // Save all-time stats
    this.store.set('stats', this.stats.allTime);
  }

  scheduleStatsReset() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = tomorrow - now;

    setTimeout(() => {
      this.stats.today = {
        total: 0,
        success: 0,
        failed: 0,
        totalSize: 0
      };
      this.logger.info('Daily stats reset');

      // Schedule next reset
      this.scheduleStatsReset();
    }, msUntilMidnight);
  }

  async retry(taskId) {
    const task = this.queue.find(t => t.id === taskId);
    if (task) {
      task.status = 'pending';
      task.attempts = 0;
      task.error = null;

      if (!this.processing) {
        this.processQueue();
      }
    }
  }

  clearCompleted() {
    this.queue = this.queue.filter(t => t.status !== 'completed');
    this.emit('queue-updated', this.queue);
  }

  getQueue() {
    return this.queue;
  }

  getQueueSize() {
    return this.queue.length;
  }

  getStats() {
    return {
      today: this.stats.today,
      allTime: this.stats.allTime,
      queue: {
        total: this.queue.length,
        pending: this.queue.filter(t => t.status === 'pending').length,
        uploading: this.queue.filter(t => t.status === 'uploading').length,
        failed: this.queue.filter(t => t.status === 'failed').length,
        completed: this.queue.filter(t => t.status === 'completed').length
      }
    };
  }

  getTodayStats() {
    return this.stats.today;
  }

  async testConnection() {
    try {
      const sftpTest = await this.sftp.testConnection();
      const apiTest = await this.api.testConnection();

      return {
        sftp: sftpTest,
        api: apiTest,
        overall: sftpTest.success && apiTest.success
      };
    } catch (error) {
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = UploadManager;