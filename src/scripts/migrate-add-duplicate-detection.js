import databaseManager from '../config/database.js';

async function migrateDuplicateDetection() {
  console.log('🔄 Starting duplicate detection migration...');
  
  try {
    await databaseManager.initialize();
    const pool = databaseManager.getPool();
    
    // Check if detection_method column exists
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'duplicates' 
        AND column_name = 'detection_method'
    `;
    
    const columnExists = await pool.query(checkColumnQuery);
    
    if (columnExists.rows.length === 0) {
      console.log('📝 Adding detection_method column to duplicates table...');
      
      // Add the detection_method column
      await pool.query(`
        ALTER TABLE duplicates 
        ADD COLUMN detection_method VARCHAR(50) NOT NULL DEFAULT 'unknown'
      `);
      
      console.log('✅ Added detection_method column');
    } else {
      console.log('✅ detection_method column already exists');
    }
    
    // Check if unique constraint exists
    const checkConstraintQuery = `
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'duplicates' 
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%original_log_id%'
    `;
    
    const constraintExists = await pool.query(checkConstraintQuery);
    
    if (constraintExists.rows.length === 0) {
      console.log('📝 Adding unique constraint to duplicates table...');
      
      // Add unique constraint
      await pool.query(`
        ALTER TABLE duplicates 
        ADD CONSTRAINT duplicates_original_duplicate_unique 
        UNIQUE (original_log_id, duplicate_log_id)
      `);
      
      console.log('✅ Added unique constraint');
    } else {
      console.log('✅ Unique constraint already exists');
    }
    
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
