import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import databaseManager from '../config/database.js';
import LogRepository from '../repositories/LogRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MigrationScript {
  constructor() {
    this.logRepo = new LogRepository();
    this.migratedCount = 0;
    this.errorCount = 0;
    this.errors = [];
  }

  async run() {
    console.log('🔄 Starting migration from file-based logs to database...');
    
    try {
      // Initialize database
      databaseManager.initialize();
      this.logRepo.initialize();
      
      // Find old logs directory
      const oldLogsDir = path.join(__dirname, '../../logs');
      
      if (!fs.existsSync(oldLogsDir)) {
        console.log('📁 No old logs directory found, nothing to migrate');
        return;
      }
      
      // Get all log files
      const logFiles = fs.readdirSync(oldLogsDir).filter(file => file.endsWith('.log'));
      
      if (logFiles.length === 0) {
        console.log('📄 No log files found in logs directory');
        return;
      }
      
      console.log(`📄 Found ${logFiles.length} log files to migrate`);
      
      // Migrate each file
      for (const logFile of logFiles) {
        await this.migrateLogFile(oldLogsDir, logFile);
      }
      
      console.log(`✅ Migration completed:`);
      console.log(`   - Migrated: ${this.migratedCount} log entries`);
      console.log(`   - Errors: ${this.errorCount} entries`);
      
      if (this.errors.length > 0) {
        console.log('\n❌ Errors encountered:');
        this.errors.forEach((error, index) => {
          console.log(`   ${index + 1}. ${error}`);
        });
      }
      
      // Ask user if they want to backup old files
      console.log('\n💡 Migration complete! Consider backing up the old logs directory before deleting it.');
      console.log('   You can now start the new server with: npm start');
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    } finally {
      databaseManager.close();
    }
  }

  async migrateLogFile(logsDir, logFile) {
    try {
      const applicationId = path.basename(logFile, '.log');
      const logFilePath = path.join(logsDir, logFile);
      
      console.log(`📝 Migrating ${logFile} (${applicationId})...`);
      
      // Read and parse log file
      const content = fs.readFileSync(logFilePath, 'utf8');
      let logs;
      
      try {
        logs = JSON.parse(content);
        if (!Array.isArray(logs)) {
          logs = [];
        }
      } catch (parseError) {
        this.errors.push(`Failed to parse ${logFile}: ${parseError.message}`);
        this.errorCount++;
        return;
      }
      
      // Migrate each log entry
      for (const log of logs) {
        try {
          await this.migrateLogEntry(log, applicationId);
          this.migratedCount++;
        } catch (error) {
          this.errors.push(`Failed to migrate log ${log.id || 'unknown'} from ${logFile}: ${error.message}`);
          this.errorCount++;
        }
      }
      
      console.log(`   ✅ Migrated ${logs.length} entries from ${logFile}`);
      
    } catch (error) {
      this.errors.push(`Failed to process file ${logFile}: ${error.message}`);
      this.errorCount++;
    }
  }

  async migrateLogEntry(log, applicationId) {
    // Map old log structure to new structure
    const logData = {
      id: log.id,
      applicationId: log.applicationId || applicationId,
      timestamp: log.timestamp,
      message: log.message,
      context: log.context || {},
      screenshots: log.screenshots || [],
      state: log.state || 'open',
      reopenCount: log.reopenCount || 0
    };
    
    // Create the log entry in database
    await this.logRepo.create(logData);
    
    // If the log has additional metadata, update it
    if (log.llmMessage || log.git_commit || log.statistics) {
      if (log.state === 'done') {
        this.logRepo.updateToDone(
          log.id,
          log.llmMessage || '',
          log.git_commit || null,
          log.statistics || null
        );
      }
    }
    
    // Handle state-specific updates
    if (log.startedAt && log.state === 'in_progress') {
      this.logRepo.updateToInProgress(log.id);
    }
    
    if (log.revertedAt && log.state === 'revert') {
      this.logRepo.updateToRevert(log.id, log.revertReason || null);
    }
  }
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const migration = new MigrationScript();
  migration.run().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}

export default MigrationScript;
