const axios = require('axios');

class ApiClient {
  constructor(logger) {
    this.logger = logger;
    this.baseURL = process.env.API_URL || 'http://localhost:3000/api';

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        this.logger.error('API request failed', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          message: error.message
        });
        return Promise.reject(error);
      }
    );
  }

  async createDocument(documentData) {
    try {
      this.logger.info('Creating document record', {
        barcode: documentData.barcode
      });

      const response = await this.client.post('/documents/upload', documentData);

      this.logger.info('Document record created', {
        barcode: documentData.barcode,
        documentId: response.data.documentId
      });

      return {
        success: true,
        documentId: response.data.documentId,
        workflowId: response.data.workflowId
      };

    } catch (error) {
      this.logger.error('Failed to create document record', {
        barcode: documentData.barcode,
        error: error.message
      });

      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  async testConnection() {
    try {
      const response = await this.client.get('/health');

      return {
        success: true,
        message: 'Connected to API',
        version: response.data.version
      };

    } catch (error) {
      return {
        success: false,
        message: 'API connection failed',
        error: error.message
      };
    }
  }
}

module.exports = ApiClient;