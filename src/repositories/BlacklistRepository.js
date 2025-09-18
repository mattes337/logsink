import databaseManager from '../config/database.js';

class BlacklistRepository {
  constructor() {
    this.pool = null;
  }

  initialize() {
    this.pool = databaseManager.getPool();
  }

  async create(blacklistData) {
    const { pattern, patternType = 'substring', applicationId = null, reason = null } = blacklistData;

    try {
      const query = `
        INSERT INTO blacklist (pattern, pattern_type, application_id, reason)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      const result = await this.pool.query(query, [pattern, patternType, applicationId, reason]);
      return this.transformRow(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') { // PostgreSQL unique constraint violation
        throw new Error(`Blacklist pattern already exists: ${pattern}`);
      }
      throw new Error(`Failed to create blacklist entry: ${error.message}`);
    }
  }

  async findAll() {
    try {
      const query = 'SELECT * FROM blacklist ORDER BY created_at DESC';
      const result = await this.pool.query(query);
      return result.rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find all blacklist entries: ${error.message}`);
    }
  }

  async findByApplicationId(applicationId) {
    try {
      const query = `
        SELECT * FROM blacklist
        WHERE application_id IS NULL OR application_id = $1
        ORDER BY created_at DESC
      `;
      const result = await this.pool.query(query, [applicationId]);
      return result.rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find blacklist entries by application ID: ${error.message}`);
    }
  }

  async findById(id) {
    try {
      const query = 'SELECT * FROM blacklist WHERE id = $1';
      const result = await this.pool.query(query, [id]);
      return result.rows.length > 0 ? this.transformRow(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to find blacklist entry by ID: ${error.message}`);
    }
  }

  async findByPattern(pattern, applicationId = null) {
    try {
      const query = `
        SELECT * FROM blacklist WHERE pattern = $1 AND
        (application_id IS NULL OR application_id = $2)
      `;
      const result = await this.pool.query(query, [pattern, applicationId]);
      return result.rows.length > 0 ? this.transformRow(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to find blacklist entry by pattern: ${error.message}`);
    }
  }

  async update(id, blacklistData) {
    const { pattern, patternType, applicationId, reason } = blacklistData;

    try {
      const query = `
        UPDATE blacklist SET pattern = $1, pattern_type = $2,
        application_id = $3, reason = $4
        WHERE id = $5
      `;
      const result = await this.pool.query(query, [
        pattern, patternType, applicationId, reason, id
      ]);
      return result.rowCount > 0;
    } catch (error) {
      if (error.code === '23505') { // PostgreSQL unique constraint violation
        throw new Error(`Blacklist pattern already exists: ${pattern}`);
      }
      throw new Error(`Failed to update blacklist entry: ${error.message}`);
    }
  }

  async deleteById(id) {
    try {
      const query = 'DELETE FROM blacklist WHERE id = $1';
      const result = await this.pool.query(query, [id]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to delete blacklist entry by ID: ${error.message}`);
    }
  }

  async deleteByPattern(pattern, applicationId = null) {
    try {
      const query = `
        DELETE FROM blacklist WHERE pattern = $1 AND
        (application_id IS NULL OR application_id = $2)
      `;
      const result = await this.pool.query(query, [pattern, applicationId]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to delete blacklist entry by pattern: ${error.message}`);
    }
  }

  async deleteAll() {
    try {
      const query = 'DELETE FROM blacklist';
      const result = await this.pool.query(query);
      return result.rowCount;
    } catch (error) {
      throw new Error(`Failed to delete all blacklist entries: ${error.message}`);
    }
  }

  async count() {
    try {
      const query = 'SELECT COUNT(*) as count FROM blacklist';
      const result = await this.pool.query(query);
      return parseInt(result.rows[0].count);
    } catch (error) {
      throw new Error(`Failed to count blacklist entries: ${error.message}`);
    }
  }

  async countByApplicationId(applicationId) {
    try {
      const query = `
        SELECT COUNT(*) as count FROM blacklist
        WHERE application_id IS NULL OR application_id = $1
      `;
      const result = await this.pool.query(query, [applicationId]);
      return parseInt(result.rows[0].count);
    } catch (error) {
      throw new Error(`Failed to count blacklist entries by application ID: ${error.message}`);
    }
  }

  // Check if a message matches any blacklist patterns
  async isBlacklisted(message, applicationId = null) {
    try {
      const blacklistEntries = await this.findByApplicationId(applicationId);

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
