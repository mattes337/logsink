#!/usr/bin/env node

/**
 * Migration script to transfer data from SQLite to PostgreSQL
 * This script helps users upgrade from LogSink v2.0 (SQLite) to v2.1 (PostgreSQL)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SQLiteToPostgresMigrator {
  constructor() {
    this.sqliteDb = null;
    this.pgPool = null;
    this.migratedLogs = 0;
    this.migratedBlacklist = 0;
    this.migratedDuplicates = 0;
    this.errors = [];
  }

  async initialize() {
    console.log('🔄 Initializing migration from SQLite to PostgreSQL...');
    
    // Check if SQLite database exists
    const sqliteDbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '../../data/logsink.db');
    if (!fs.existsSync(sqliteDbPath)) {
      throw new Error(`SQLite database not found at: ${sqliteDbPath}`);
    }

    // Initialize SQLite connection
    try {
      const Database = (await import('better-sqlite3')).default;
      this.sqliteDb = new Database(sqliteDbPath, { readonly: true });
      console.log('✅ Connected to SQLite database');
    } catch (error) {
      throw new Error(`Failed to connect to SQLite: ${error.message}. Please install better-sqlite3: npm install better-sqlite3`);
    }

    // Initialize PostgreSQL connection
    const pgConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'logsink',
      user: process.env.DB_USER || 'logsink',
      password: process.env.DB_PASSWORD || 'logsink',
    };

    this.pgPool = new Pool(pgConfig);
    
    try {
      await this.pgPool.query('SELECT NOW()');
      console.log('✅ Connected to PostgreSQL database');
    } catch (error) {
      throw new Error(`Failed to connect to PostgreSQL: ${error.message}`);
    }
  }

  async migrate() {
    console.log('🚀 Starting migration process...');
    
    try {
      await this.initialize();
      
      // Migrate in order: logs first, then blacklist, then duplicates
      await this.migrateLogs();
      await this.migrateBlacklist();
      await this.migrateDuplicates();
      
      console.log('\n✅ Migration completed successfully!');
      console.log(`📊 Migration Summary:`);
      console.log(`   - Logs migrated: ${this.migratedLogs}`);
      console.log(`   - Blacklist entries migrated: ${this.migratedBlacklist}`);
      console.log(`   - Duplicate entries migrated: ${this.migratedDuplicates}`);
      
      if (this.errors.length > 0) {
        console.log(`\n⚠️  Errors encountered: ${this.errors.length}`);
        this.errors.forEach((error, index) => {
          console.log(`   ${index + 1}. ${error}`);
        });
      }
      
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  async migrateLogs() {
    console.log('\n📝 Migrating logs...');
    
    try {
      const logs = this.sqliteDb.prepare('SELECT * FROM logs').all();
      console.log(`Found ${logs.length} log entries to migrate`);
      
      for (const log of logs) {
        try {
          await this.migrateLogEntry(log);
          this.migratedLogs++;
          
          if (this.migratedLogs % 100 === 0) {
            console.log(`   Migrated ${this.migratedLogs}/${logs.length} logs...`);
          }
        } catch (error) {
          this.errors.push(`Failed to migrate log ${log.id}: ${error.message}`);
        }
      }
      
      console.log(`✅ Migrated ${this.migratedLogs} log entries`);
    } catch (error) {
      throw new Error(`Failed to migrate logs: ${error.message}`);
    }
  }

  async migrateLogEntry(log) {
    const query = `
      INSERT INTO logs (
        id, application_id, timestamp, message, context, screenshots,
        state, llm_message, git_commit, statistics, reopen_count,
        started_at, completed_at, reopened_at, reverted_at, revert_reason,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id) DO NOTHING
    `;
    
    const values = [
      log.id,
      log.application_id,
      log.timestamp,
      log.message,
      log.context ? JSON.parse(log.context) : {},
      log.screenshots ? JSON.parse(log.screenshots) : [],
      log.state,
      log.llm_message,
      log.git_commit,
      log.statistics ? JSON.parse(log.statistics) : {},
      log.reopen_count || 0,
      log.started_at,
      log.completed_at,
      log.reopened_at,
      log.reverted_at,
      log.revert_reason,
      log.created_at,
      log.updated_at
    ];
    
    await this.pgPool.query(query, values);
  }

  async migrateBlacklist() {
    console.log('\n🚫 Migrating blacklist entries...');
    
    try {
      const blacklistEntries = this.sqliteDb.prepare('SELECT * FROM blacklist').all();
      console.log(`Found ${blacklistEntries.length} blacklist entries to migrate`);
      
      for (const entry of blacklistEntries) {
        try {
          await this.migrateBlacklistEntry(entry);
          this.migratedBlacklist++;
        } catch (error) {
          this.errors.push(`Failed to migrate blacklist entry ${entry.id}: ${error.message}`);
        }
      }
      
      console.log(`✅ Migrated ${this.migratedBlacklist} blacklist entries`);
    } catch (error) {
      throw new Error(`Failed to migrate blacklist: ${error.message}`);
    }
  }

  async migrateBlacklistEntry(entry) {
    const query = `
      INSERT INTO blacklist (
        pattern, pattern_type, application_id, reason, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (pattern, application_id) DO NOTHING
    `;
    
    const values = [
      entry.pattern,
      entry.pattern_type,
      entry.application_id,
      entry.reason,
      entry.created_at,
      entry.updated_at
    ];
    
    await this.pgPool.query(query, values);
  }

  async migrateDuplicates() {
    console.log('\n🔄 Migrating duplicate entries...');
    
    try {
      const duplicates = this.sqliteDb.prepare('SELECT * FROM duplicates').all();
      console.log(`Found ${duplicates.length} duplicate entries to migrate`);
      
      for (const duplicate of duplicates) {
        try {
          await this.migrateDuplicateEntry(duplicate);
          this.migratedDuplicates++;
        } catch (error) {
          this.errors.push(`Failed to migrate duplicate entry ${duplicate.id}: ${error.message}`);
        }
      }
      
      console.log(`✅ Migrated ${this.migratedDuplicates} duplicate entries`);
    } catch (error) {
      throw new Error(`Failed to migrate duplicates: ${error.message}`);
    }
  }

  async migrateDuplicateEntry(duplicate) {
    const query = `
      INSERT INTO duplicates (
        original_log_id, duplicate_log_id, similarity_score, detected_at
      ) VALUES ($1, $2, $3, $4)
    `;
    
    const values = [
      duplicate.original_log_id,
      duplicate.duplicate_log_id,
      duplicate.similarity_score,
      duplicate.detected_at
    ];
    
    await this.pgPool.query(query, values);
  }

  async cleanup() {
    if (this.sqliteDb) {
      this.sqliteDb.close();
    }
    if (this.pgPool) {
      await this.pgPool.end();
    }
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const migrator = new SQLiteToPostgresMigrator();
  
  migrator.migrate()
    .then(() => {
      console.log('\n🎉 Migration completed! You can now start using PostgreSQL.');
      console.log('💡 Consider backing up your SQLite database before removing it.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration failed:', error.message);
      process.exit(1);
    });
}

export default SQLiteToPostgresMigrator;
