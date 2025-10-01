import databaseManager from '../config/database.js';

async function migrateDuplicateDetection() {
  console.log('🔄 Starting duplicate detection migration...');
  
  try {
    await databaseManager.initialize();
    const pool = databaseManager.getPool();
    
    // Add detection_method column if it doesn't exist
    console.log('📝 Adding detection_method column if needed...');
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'duplicates' AND column_name = 'detection_method'
        ) THEN
          ALTER TABLE duplicates ADD COLUMN detection_method VARCHAR(50) NOT NULL DEFAULT 'unknown';
          RAISE NOTICE 'Added detection_method column';
        ELSE
          RAISE NOTICE 'detection_method column already exists';
        END IF;
      END $$;
    `);
    console.log('✅ detection_method column handled');
    
    // Add unique constraint if it doesn't exist
    console.log('📝 Adding unique constraint if needed...');
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'duplicates'
            AND constraint_type = 'UNIQUE'
            AND constraint_name = 'duplicates_original_duplicate_unique'
        ) THEN
          ALTER TABLE duplicates ADD CONSTRAINT duplicates_original_duplicate_unique
          UNIQUE (original_log_id, duplicate_log_id);
          RAISE NOTICE 'Added unique constraint';
        ELSE
          RAISE NOTICE 'Unique constraint already exists';
        END IF;
      END $$;
    `);
    console.log('✅ Unique constraint handled');
    
    // Add new indexes for duplicate detection
    console.log('📝 Adding indexes for duplicate detection...');
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_message_hash ON logs(md5(message));
      CREATE INDEX IF NOT EXISTS idx_logs_app_message ON logs(application_id, message);
      CREATE INDEX IF NOT EXISTS idx_duplicates_method ON duplicates(detection_method);
    `);
    
    console.log('✅ Added duplicate detection indexes');
    
    console.log('🎉 Duplicate detection migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await databaseManager.close();
  }
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateDuplicateDetection();
}

export default migrateDuplicateDetection;
