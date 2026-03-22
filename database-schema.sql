-- Claims Scanner Database Schema
-- Run this in your PostgreSQL database

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name TEXT NOT NULL,
  original_file_name TEXT,
  file_type TEXT,
  file_size_bytes BIGINT,
  mime_type TEXT,
  storage_bucket TEXT,
  storage_path TEXT,
  storage_url TEXT,
  barcode TEXT NOT NULL UNIQUE,
  batch_id TEXT,
  scan_date TIMESTAMPTZ,
  uploaded_by TEXT DEFAULT 'scanner_app',
  status TEXT DEFAULT 'dmg_bin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflows table
CREATE TABLE IF NOT EXISTS workflows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  status TEXT DEFAULT 'dmg_bin',
  assigned_to UUID, -- User ID if you have user management
  priority TEXT DEFAULT 'normal',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_documents_barcode ON documents(barcode);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_workflows_document_id ON workflows(document_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);

-- Note: Row Level Security (RLS) policies were removed for standard PostgreSQL compatibility.