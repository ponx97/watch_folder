const Client = require('ssh2-sftp-client');

class SftpClient {
  constructor(logger) {
    this.logger = logger;
    
    this.config = {
      host: process.env.SFTP_HOST,
      port: process.env.SFTP_PORT ? parseInt(process.env.SFTP_PORT, 10) : 22,
      username: process.env.SFTP_USERNAME,
      password: process.env.SFTP_PASSWORD
    };

    if (!this.config.host || !this.config.username) {
      this.logger.error('SFTP configuration missing. Check .env file', this.config);
    }
    
    this.basePath = process.env.SFTP_BASE_PATH || '/uploads';
  }

  async uploadFile(storagePath, fileBuffer, fileExtension) {
    const sftp = new Client();
    try {
      this.logger.info('Uploading to VPS SFTP Server', { path: storagePath });

      await sftp.connect(this.config);

      // Ensure directory exists
      const fullPath = `${this.basePath}/${storagePath}`;
      const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
      
      const dirExists = await sftp.exists(dirPath);
      if (!dirExists) {
        await sftp.mkdir(dirPath, true);
      }

      await sftp.put(fileBuffer, fullPath);

      this.logger.info('SFTP Upload successful', {
        path: storagePath,
        fullPath: fullPath
      });

      return {
        success: true,
        path: storagePath,
        url: `sftp://${this.config.host}:${this.config.port}${fullPath}`
      };

    } catch (error) {
      this.logger.error('SFTP upload exception', { error: error.message });
      return { success: false, error: error.message };
    } finally {
      try {
        await sftp.end();
      } catch (err) {
        // ignore end error
      }
    }
  }

  async testConnection() {
    const sftp = new Client();
    try {
      await sftp.connect(this.config);
      
      const dirExists = await sftp.exists(this.basePath);
      if (!dirExists) {
         try {
           await sftp.mkdir(this.basePath, true);
         } catch (mkdirError) {
           this.logger.warn('Could not create base path during testConnection (might not have permissions)', { path: this.basePath });
         }
      }

      return {
        success: true,
        message: 'Connected to SFTP Server',
        details: `Connected to ${this.config.host}:${this.config.port}`
      };

    } catch (error) {
      return {
        success: false,
        message: 'SFTP connection failed',
        error: error.message
      };
    } finally {
      try {
        await sftp.end();
      } catch (err) {}
    }
  }
}

module.exports = SftpClient;
