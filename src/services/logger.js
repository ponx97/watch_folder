const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class Logger {
  constructor() {
    // Get logs directory
    this.logDir = path.join(app.getPath('userData'), 'logs');

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Create Winston logger
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        // Console output
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(info => {
              const { timestamp, level, message, ...meta } = info;
              const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
              return `${timestamp} [${level}]: ${message} ${metaStr}`;
            })
          )
        }),
        // Daily rotating file
        new winston.transports.File({
          filename: path.join(this.logDir, `app-${this.getDateString()}.log`),
          maxsize: 10485760, // 10MB
          maxFiles: 30 // Keep 30 days of logs
        }),
        // Error log file
        new winston.transports.File({
          filename: path.join(this.logDir, `error-${this.getDateString()}.log`),
          level: 'error',
          maxsize: 10485760,
          maxFiles: 30
        })
      ],
      exceptionHandlers: [
        new winston.transports.File({
          filename: path.join(this.logDir, 'exceptions.log')
        })
      ]
    });

    // Store recent logs in memory for UI
    this.recentLogs = [];
    this.maxRecentLogs = 1000;

    // Intercept logs for recent logs array
    this.logger.on('data', (info) => {
      this.recentLogs.push({
        timestamp: info.timestamp,
        level: info.level,
        message: info.message,
        meta: info
      });

      // Keep only recent logs
      if (this.recentLogs.length > this.maxRecentLogs) {
        this.recentLogs.shift();
      }
    });
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  getRecentLogs(limit = 100) {
    return this.recentLogs.slice(-limit);
  }

  getLogFolder() {
    return this.logDir;
  }

  getDateString() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

module.exports = Logger;