-- LogSink PostgreSQL Database Schema
-- This script initializes the PostgreSQL database for LogSink

-- Create database (run this manually if needed)
-- CREATE DATABASE logsink;
-- CREATE USER logsink WITH PASSWORD 'logsink';
-- GRANT ALL PRIVILEGES ON DATABASE logsink TO logsink;

-- Connect to the logsink database before running the rest

-- Enable UUID extension for better ID generation (optional)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
  id VARCHAR(255) PRIMARY KEY,
  application_id VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  message TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  screenshots JSONB DEFAULT '[]',
  state VARCHAR(50) NOT NULL DEFAULT 'open',
  llm_message TEXT,
  git_commit VARCHAR(255),
  statistics JSONB DEFAULT '{}',
  reopen_count INTEGER DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  reopened_at TIMESTAMP WITH TIME ZONE,
  reverted_at TIMESTAMP WITH TIME ZONE,
  revert_reason TEXT,
  embedding vector(768),
  embedding_model VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Blacklist table
CREATE TABLE IF NOT EXISTS blacklist (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,
  pattern_type VARCHAR(50) NOT NULL DEFAULT 'substring',
  application_id VARCHAR(255),
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(pattern, application_id)
);

-- Duplicate tracking table
CREATE TABLE IF NOT EXISTS duplicates (
  id SERIAL PRIMARY KEY,
  original_log_id VARCHAR(255) NOT NULL,
  duplicate_log_id VARCHAR(255) NOT NULL,
  similarity_score DECIMAL(5,4) NOT NULL,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (original_log_id) REFERENCES logs(id) ON DELETE CASCADE,
  FOREIGN KEY (duplicate_log_id) REFERENCES logs(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_logs_application_id ON logs(application_id);
CREATE INDEX IF NOT EXISTS idx_logs_state ON logs(state);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_message ON logs USING gin(to_tsvector('english', message));
CREATE INDEX IF NOT EXISTS idx_logs_context ON logs USING gin(context);
CREATE INDEX IF NOT EXISTS idx_logs_embedding ON logs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_blacklist_application_id ON blacklist(application_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_pattern ON blacklist(pattern);
CREATE INDEX IF NOT EXISTS idx_duplicates_original ON duplicates(original_log_id);
CREATE INDEX IF NOT EXISTS idx_duplicates_duplicate ON duplicates(duplicate_log_id);

-- Create function for updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_logs_updated_at ON logs;
CREATE TRIGGER update_logs_updated_at
  BEFORE UPDATE ON logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_blacklist_updated_at ON blacklist;
CREATE TRIGGER update_blacklist_updated_at
  BEFORE UPDATE ON blacklist
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create views for common queries
CREATE OR REPLACE VIEW logs_summary AS
SELECT 
  application_id,
  state,
  COUNT(*) as count,
  MAX(timestamp) as latest_timestamp,
  MIN(timestamp) as earliest_timestamp
FROM logs 
GROUP BY application_id, state;

CREATE OR REPLACE VIEW recent_logs AS
SELECT * FROM logs 
WHERE timestamp >= NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- Grant permissions to logsink user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO logsink;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO logsink;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO logsink;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO logsink;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO logsink;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO logsink;

COMMENT ON TABLE logs IS 'Main log entries table with JSON support for flexible data storage';
COMMENT ON TABLE blacklist IS 'Pattern-based blacklist for filtering log entries';
COMMENT ON TABLE duplicates IS 'Tracks duplicate log entries for cleanup purposes';
