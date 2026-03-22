const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.api' });

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Postgres Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Claims Scanner API Server',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      upload: 'POST /api/documents/upload'
    },
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Document upload endpoint
app.post('/api/documents/upload', async (req, res) => {
  try {
    const {
      file_name,
      original_file_name,
      file_type,
      file_size_bytes,
      mime_type,
      storage_bucket,
      storage_path,
      storage_url,
      barcode,
      batch_id,
      scan_date,
      uploaded_by,
      status
    } = req.body;

    // Validate required fields
    if (!barcode || !storage_path || !storage_url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: barcode, storage_path, storage_url'
      });
    }

    // Insert into documents table
    let documentData;
    try {
      const docResult = await pool.query(
        `INSERT INTO documents (
          file_name, original_file_name, file_type, file_size_bytes, mime_type, 
          storage_bucket, storage_path, storage_url, barcode, batch_id, 
          scan_date, uploaded_by, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        ) RETURNING id`,
        [
          file_name, original_file_name, file_type, file_size_bytes, mime_type,
          storage_bucket, storage_path, storage_url, barcode, batch_id,
          scan_date, uploaded_by, status, new Date().toISOString(), new Date().toISOString()
        ]
      );
      documentData = docResult.rows[0];
    } catch (documentError) {
      console.error('Document insert error:', documentError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create document record'
      });
    }

    // Create workflow record (adjust table name and fields as needed)
    let workflowData;
    try {
      const wfResult = await pool.query(
        `INSERT INTO workflows (document_id, barcode, status, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [documentData.id, barcode, 'dmg_bin', new Date().toISOString(), new Date().toISOString()]
      );
      workflowData = wfResult.rows[0];
    } catch (workflowError) {
      console.error('Workflow insert error:', workflowError);
      // Don't fail the request if workflow creation fails
    }

    res.json({
      success: true,
      documentId: documentData.id,
      workflowId: workflowData?.id || null,
      message: 'Document uploaded successfully'
    });

  } catch (error) {
    console.error('Upload endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Claims Scanner API server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/api/health`);
});