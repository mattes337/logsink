#!/usr/bin/env node

/**
 * Migration script to add pgvector support to existing LogSink database
 * This script adds the embedding columns and indexes to existing logs table
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class EmbeddingMigration {
  constructor() {
    this.pgPool = null;
  }

  async initialize() {
    console.log('🔄 Initializing database connections...');

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

  async runMigration() {
    console.log('🚀 Starting embedding migration...');
    
    const client = await this.pgPool.connect();
    
    try {
      await client.query('BEGIN');
      
      console.log('📦 Installing pgvector extension...');
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      
      console.log('🔧 Checking if embedding columns exist...');
      const columnCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'logs' AND column_name IN ('embedding', 'embedding_model')
      `);
      
      const existingColumns = columnCheck.rows.map(row => row.column_name);
      
      if (!existingColumns.includes('embedding')) {
        console.log('➕ Adding embedding column...');
        await client.query('ALTER TABLE logs ADD COLUMN embedding vector(768)');
      } else {
        console.log('✅ Embedding column already exists');
      }
      
      if (!existingColumns.includes('embedding_model')) {
        console.log('➕ Adding embedding_model column...');
        await client.query('ALTER TABLE logs ADD COLUMN embedding_model VARCHAR(100)');
      } else {
        console.log('✅ Embedding_model column already exists');
      }
      
      console.log('📊 Creating vector similarity index...');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_logs_embedding 
        ON logs USING ivfflat (embedding vector_cosine_ops) 
        WITH (lists = 100)
      `);
      
      await client.query('COMMIT');
      console.log('✅ Migration completed successfully');
      
      // Get statistics
      const stats = await this.getStatistics();
      console.log('\n📈 Migration Statistics:');
      console.log(`   Total logs: ${stats.totalLogs}`);
      console.log(`   Logs with embeddings: ${stats.logsWithEmbeddings}`);
      console.log(`   Logs without embeddings: ${stats.logsWithoutEmbeddings}`);
      
      if (stats.logsWithoutEmbeddings > 0) {
        console.log('\n💡 Next steps:');
        console.log('   1. Set GEMINI_EMBEDDING_ENABLED=true in your .env file');
        console.log('   2. Set GEMINI_API_KEY in your .env file');
        console.log('   3. Restart the application');
        console.log('   4. Existing logs will be processed in the background');
        console.log('   5. New logs will automatically use the pending state for embedding processing');
      }
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getStatistics() {
    try {
      const totalResult = await this.pgPool.query('SELECT COUNT(*) as count FROM logs');
      const embeddedResult = await this.pgPool.query('SELECT COUNT(*) as count FROM logs WHERE embedding IS NOT NULL');
      
      const totalLogs = parseInt(totalResult.rows[0].count);
      const logsWithEmbeddings = parseInt(embeddedResult.rows[0].count);
      const logsWithoutEmbeddings = totalLogs - logsWithEmbeddings;
      
      return {
        totalLogs,
        logsWithEmbeddings,
        logsWithoutEmbeddings
      };
    } catch (error) {
      console.error('Failed to get statistics:', error);
      return {
        totalLogs: 0,
        logsWithEmbeddings: 0,
        logsWithoutEmbeddings: 0
      };
    }
  }

  async close() {
    if (this.pgPool) {
      await this.pgPool.end();
    }
  }
}

// Main execution
async function main() {
  const migration = new EmbeddingMigration();
  
  try {
    await migration.initialize();
    await migration.runMigration();
    console.log('\n🎉 Embedding migration completed successfully!');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await migration.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default EmbeddingMigration;
