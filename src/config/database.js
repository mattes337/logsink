import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseManager {
  constructor() {
    this.db = null;
  }

  initialize(dbPath = null) {
    if (!dbPath) {
      dbPath = path.join(__dirname, '../../data/logsink.db');
    }

    // Ensure data directory exists synchronously
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    this.createTables();
    return this.db;
  }

  createTables() {
    // Logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT, -- JSON string
        screenshots TEXT, -- JSON array of filenames
        state TEXT NOT NULL DEFAULT 'open',
        llm_message TEXT,
        git_commit TEXT,
        statistics TEXT, -- JSON string
        reopen_count INTEGER DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        reopened_at TEXT,
        reverted_at TEXT,
        revert_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Blacklist table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL UNIQUE,
        pattern_type TEXT NOT NULL DEFAULT 'substring', -- 'substring', 'regex', 'exact'
        application_id TEXT, -- NULL means applies to all applications
        reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Duplicate tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS duplicates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_log_id TEXT NOT NULL,
        duplicate_log_id TEXT NOT NULL,
        similarity_score REAL NOT NULL,
        detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (original_log_id) REFERENCES logs(id),
        FOREIGN KEY (duplicate_log_id) REFERENCES logs(id)
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_application_id ON logs(application_id);
      CREATE INDEX IF NOT EXISTS idx_logs_state ON logs(state);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_message ON logs(message);
      CREATE INDEX IF NOT EXISTS idx_blacklist_application_id ON blacklist(application_id);
      CREATE INDEX IF NOT EXISTS idx_duplicates_original ON duplicates(original_log_id);
    `);

    // Create triggers for updated_at
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_logs_timestamp 
      AFTER UPDATE ON logs
      BEGIN
        UPDATE logs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_blacklist_timestamp 
      AFTER UPDATE ON blacklist
      BEGIN
        UPDATE blacklist SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);
  }

  getDatabase() {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
const databaseManager = new DatabaseManager();

export default databaseManager;
