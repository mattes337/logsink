#!/usr/bin/env node

import { Client } from 'pg';
import config from '../config/index.js';

async function migrateAddIssueFields() {
  const client = new Client({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
  });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('📋 Checking current table structure...');
    const result = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'logs' AND table_schema = 'public'
    `);
    
    const existingColumns = result.rows.map(row => row.column_name);
    console.log('📊 Existing columns:', existingColumns);

    // Add plan column (markdown text for implementation plan)
    if (!existingColumns.includes('plan')) {
      console.log('➕ Adding plan column...');
      await client.query('ALTER TABLE logs ADD COLUMN plan TEXT');
    } else {
      console.log('✅ Plan column already exists');
    }

    // Add type column (enum for bugfix/feature/documentation)
    if (!existingColumns.includes('type')) {
      console.log('➕ Adding type column...');
      await client.query(`
        ALTER TABLE logs ADD COLUMN type VARCHAR(50) DEFAULT 'feature' 
        CHECK (type IN ('bugfix', 'feature', 'documentation'))
      `);
    } else {
      console.log('✅ Type column already exists');
    }

    // Add effort column (effort estimation)
    if (!existingColumns.includes('effort')) {
      console.log('➕ Adding effort column...');
      await client.query(`
        ALTER TABLE logs ADD COLUMN effort VARCHAR(50) DEFAULT 'medium'
        CHECK (effort IN ('low', 'medium', 'high', 'critical'))
      `);
    } else {
      console.log('✅ Effort column already exists');
    }

    // Add llm_output column (complete LLM output log)
    if (!existingColumns.includes('llm_output')) {
      console.log('➕ Adding llm_output column...');
      await client.query('ALTER TABLE logs ADD COLUMN llm_output TEXT');
    } else {
      console.log('✅ LLM output column already exists');
    }

    console.log('📊 Creating indexes for new columns...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);
      CREATE INDEX IF NOT EXISTS idx_logs_effort ON logs(effort);
    `);

    console.log('✅ Migration completed successfully!');
    
    // Verify the changes
    const finalResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'logs' AND table_schema = 'public'
      AND column_name IN ('plan', 'type', 'effort', 'llm_output')
      ORDER BY column_name
    `);
    
    console.log('📋 New columns added:');
    finalResult.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default})`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateAddIssueFields()
    .then(() => {
      console.log('🎉 Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

export default migrateAddIssueFields;
