import databaseManager from '../config/database.js';

class BlacklistRepository {
  constructor() {
    this.db = null;
  }

  initialize() {
    this.db = databaseManager.getDatabase();
    this.prepareStatements();
  }

  prepareStatements() {
    this.statements = {
      insert: this.db.prepare(`
        INSERT INTO blacklist (pattern, pattern_type, application_id, reason)
        VALUES (?, ?, ?, ?)
      `),
      
      findAll: this.db.prepare(`
        SELECT * FROM blacklist ORDER BY created_at DESC
      `),
      
      findByApplicationId: this.db.prepare(`
        SELECT * FROM blacklist 
        WHERE application_id IS NULL OR application_id = ?
        ORDER BY created_at DESC
      `),
      
      findById: this.db.prepare('SELECT * FROM blacklist WHERE id = ?'),
      
      findByPattern: this.db.prepare(`
        SELECT * FROM blacklist WHERE pattern = ? AND 
        (application_id IS NULL OR application_id = ?)
      `),
      
      update: this.db.prepare(`
        UPDATE blacklist SET pattern = ?, pattern_type = ?, 
        application_id = ?, reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `),
      
      deleteById: this.db.prepare('DELETE FROM blacklist WHERE id = ?'),
      
      deleteByPattern: this.db.prepare(`
        DELETE FROM blacklist WHERE pattern = ? AND 
        (application_id IS NULL OR application_id = ?)
      `),
      
      deleteAll: this.db.prepare('DELETE FROM blacklist'),
      
      count: this.db.prepare('SELECT COUNT(*) as count FROM blacklist'),
      
      countByApplicationId: this.db.prepare(`
        SELECT COUNT(*) as count FROM blacklist 
        WHERE application_id IS NULL OR application_id = ?
      `)
    };
  }

  async create(blacklistData) {
    const { pattern, patternType = 'substring', applicationId = null, reason = null } = blacklistData;
    
    try {
      const result = this.statements.insert.run(pattern, patternType, applicationId, reason);
      return this.findById(result.lastInsertRowid);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error(`Blacklist pattern already exists: ${pattern}`);
      }
      throw new Error(`Failed to create blacklist entry: ${error.message}`);
    }
  }

  findAll() {
    try {
      const rows = this.statements.findAll.all();
      return rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find all blacklist entries: ${error.message}`);
    }
  }

  findByApplicationId(applicationId) {
    try {
      const rows = this.statements.findByApplicationId.all(applicationId);
      return rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find blacklist entries by application ID: ${error.message}`);
    }
  }

  findById(id) {
    try {
      const row = this.statements.findById.get(id);
      return row ? this.transformRow(row) : null;
    } catch (error) {
      throw new Error(`Failed to find blacklist entry by ID: ${error.message}`);
    }
  }

  findByPattern(pattern, applicationId = null) {
    try {
      const row = this.statements.findByPattern.get(pattern, applicationId);
      return row ? this.transformRow(row) : null;
    } catch (error) {
      throw new Error(`Failed to find blacklist entry by pattern: ${error.message}`);
    }
  }

  update(id, blacklistData) {
    const { pattern, patternType, applicationId, reason } = blacklistData;
    
    try {
      const result = this.statements.update.run(
        pattern, patternType, applicationId, reason, id
      );
      return result.changes > 0;
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error(`Blacklist pattern already exists: ${pattern}`);
      }
      throw new Error(`Failed to update blacklist entry: ${error.message}`);
    }
  }

  deleteById(id) {
    try {
      const result = this.statements.deleteById.run(id);
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to delete blacklist entry by ID: ${error.message}`);
    }
  }

  deleteByPattern(pattern, applicationId = null) {
    try {
      const result = this.statements.deleteByPattern.run(pattern, applicationId);
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to delete blacklist entry by pattern: ${error.message}`);
    }
  }

  deleteAll() {
    try {
      const result = this.statements.deleteAll.run();
      return result.changes;
    } catch (error) {
      throw new Error(`Failed to delete all blacklist entries: ${error.message}`);
    }
  }

  count() {
    try {
      const result = this.statements.count.get();
      return result.count;
    } catch (error) {
      throw new Error(`Failed to count blacklist entries: ${error.message}`);
    }
  }

  countByApplicationId(applicationId) {
    try {
      const result = this.statements.countByApplicationId.get(applicationId);
      return result.count;
    } catch (error) {
      throw new Error(`Failed to count blacklist entries by application ID: ${error.message}`);
    }
  }

  // Check if a message matches any blacklist patterns
  isBlacklisted(message, applicationId = null) {
    try {
      const blacklistEntries = this.findByApplicationId(applicationId);
      
      for (const entry of blacklistEntries) {
        if (this.matchesPattern(message, entry.pattern, entry.patternType)) {
          return {
            isBlacklisted: true,
            matchedPattern: entry.pattern,
            patternType: entry.patternType,
            reason: entry.reason,
            entryId: entry.id
          };
        }
      }
      
      return { isBlacklisted: false };
    } catch (error) {
      throw new Error(`Failed to check blacklist: ${error.message}`);
    }
  }

  matchesPattern(message, pattern, patternType) {
    try {
      switch (patternType) {
        case 'exact':
          return message === pattern;
        
        case 'substring':
          return message.toLowerCase().includes(pattern.toLowerCase());
        
        case 'regex':
          const regex = new RegExp(pattern, 'i');
          return regex.test(message);
        
        default:
          console.warn(`Unknown pattern type: ${patternType}, falling back to substring`);
          return message.toLowerCase().includes(pattern.toLowerCase());
      }
    } catch (error) {
      console.error(`Error matching pattern "${pattern}" of type "${patternType}":`, error);
      return false;
    }
  }

  transformRow(row) {
    return {
      id: row.id,
      pattern: row.pattern,
      patternType: row.pattern_type,
      applicationId: row.application_id,
      reason: row.reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export default BlacklistRepository;
