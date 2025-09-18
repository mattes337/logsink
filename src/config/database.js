import pkg from 'pg';
const { Pool } = pkg;

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isInitialized = false;
  }

  initialize(config = null) {
    if (this.isInitialized) {
      return this.pool;
    }

    const dbConfig = config || {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'logsink',
      user: process.env.DB_USER || 'logsink',
      password: process.env.DB_PASSWORD || 'logsink',
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
    };

    this.pool = new Pool(dbConfig);

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });

    this.isInitialized = true;
    return this.pool;
  }

  async createTables() {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Enable pgvector extension
      await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);

      // Logs table
      await client.query(`
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
        )
      `);

      // Blacklist table
      await client.query(`
        CREATE TABLE IF NOT EXISTS blacklist (
          id SERIAL PRIMARY KEY,
          pattern TEXT NOT NULL,
          pattern_type VARCHAR(50) NOT NULL DEFAULT 'substring',
          application_id VARCHAR(255),
          reason TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(pattern, application_id)
        )
      `);

      // Duplicate tracking table
      await client.query(`
        CREATE TABLE IF NOT EXISTS duplicates (
          id SERIAL PRIMARY KEY,
          original_log_id VARCHAR(255) NOT NULL,
          duplicate_log_id VARCHAR(255) NOT NULL,
          similarity_score DECIMAL(5,4) NOT NULL,
          detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          FOREIGN KEY (original_log_id) REFERENCES logs(id) ON DELETE CASCADE,
          FOREIGN KEY (duplicate_log_id) REFERENCES logs(id) ON DELETE CASCADE
        )
      `);

      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_logs_application_id ON logs(application_id);
        CREATE INDEX IF NOT EXISTS idx_logs_state ON logs(state);
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_message ON logs USING gin(to_tsvector('english', message));
        CREATE INDEX IF NOT EXISTS idx_logs_embedding ON logs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
        CREATE INDEX IF NOT EXISTS idx_blacklist_application_id ON blacklist(application_id);
        CREATE INDEX IF NOT EXISTS idx_duplicates_original ON duplicates(original_log_id);
      `);

      // Create function for updating updated_at timestamp
      await client.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      // Create triggers for updated_at
      await client.query(`
        DROP TRIGGER IF EXISTS update_logs_updated_at ON logs;
        CREATE TRIGGER update_logs_updated_at
          BEFORE UPDATE ON logs
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS update_blacklist_updated_at ON blacklist;
        CREATE TRIGGER update_blacklist_updated_at
          BEFORE UPDATE ON blacklist
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      `);

      await client.query('COMMIT');
      console.log('✅ Database tables created successfully');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  getPool() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.pool;
  }

  async query(text, params) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.pool.query(text, params);
  }

  async getClient() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.pool.connect();
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isInitialized = false;
    }
  }

  async testConnection() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      return true;
    } catch (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
  }
}

// Singleton instance
const databaseManager = new DatabaseManager();

export default databaseManager;
