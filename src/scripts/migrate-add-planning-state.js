import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'logsink',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

async function addPlanningState() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Adding in_planning state to logs table...');
    
    // Check if the state constraint exists and what values it allows
    const constraintQuery = `
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conrelid = 'logs'::regclass 
      AND contype = 'c' 
      AND pg_get_constraintdef(oid) LIKE '%state%';
    `;
    
    const constraintResult = await client.query(constraintQuery);
    console.log('Current state constraints:', constraintResult.rows);
    
    // Drop existing state constraint if it exists
    if (constraintResult.rows.length > 0) {
      const constraintName = constraintResult.rows[0].conname;
      console.log(`Dropping existing constraint: ${constraintName}`);
      await client.query(`ALTER TABLE logs DROP CONSTRAINT IF EXISTS ${constraintName}`);
    }
    
    // Add new constraint with in_planning state
    console.log('Adding new state constraint with in_planning...');
    await client.query(`
      ALTER TABLE logs ADD CONSTRAINT logs_state_check 
      CHECK (state IN ('pending', 'in_planning', 'open', 'in_progress', 'done', 'closed', 'revert'))
    `);
    
    // Update any existing 'pending' entries to 'in_planning' if they don't have a plan
    console.log('Updating existing pending entries without plans to in_planning...');
    const updateResult = await client.query(`
      UPDATE logs 
      SET state = 'in_planning' 
      WHERE state = 'pending' AND (plan IS NULL OR plan = '')
    `);
    console.log(`Updated ${updateResult.rowCount} entries from pending to in_planning`);
    
    // Update any existing 'pending' entries with plans to 'open'
    console.log('Updating existing pending entries with plans to open...');
    const updateResult2 = await client.query(`
      UPDATE logs 
      SET state = 'open' 
      WHERE state = 'pending' AND plan IS NOT NULL AND plan != ''
    `);
    console.log(`Updated ${updateResult2.rowCount} entries from pending to open`);
    
    console.log('✅ Successfully added in_planning state and updated existing entries');
    
  } catch (error) {
    console.error('❌ Error adding in_planning state:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
if (import.meta.url === `file://${process.argv[1]}`) {
  addPlanningState()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default addPlanningState;
