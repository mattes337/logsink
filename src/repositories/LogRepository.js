import databaseManager from '../config/database.js';

class LogRepository {
  constructor() {
    this.db = null;
  }

  initialize() {
    this.db = databaseManager.getDatabase();
    this.prepareStatements();
  }

  prepareStatements() {
    // Prepared statements for better performance
    this.statements = {
      insert: this.db.prepare(`
        INSERT INTO logs (
          id, application_id, timestamp, message, context, screenshots, 
          state, reopen_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      
      findById: this.db.prepare('SELECT * FROM logs WHERE id = ?'),
      
      findByApplicationId: this.db.prepare(`
        SELECT * FROM logs WHERE application_id = ? 
        ORDER BY timestamp DESC
      `),
      
      findByState: this.db.prepare(`
        SELECT * FROM logs WHERE application_id = ? AND state = ? 
        ORDER BY timestamp DESC
      `),
      
      findOpenAndRevert: this.db.prepare(`
        SELECT * FROM logs WHERE application_id = ? AND state IN ('open', 'revert') 
        ORDER BY CASE WHEN state = 'revert' THEN 0 ELSE 1 END, timestamp DESC
      `),
      
      updateState: this.db.prepare(`
        UPDATE logs SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `),
      
      updateToInProgress: this.db.prepare(`
        UPDATE logs SET state = 'in_progress', started_at = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `),
      
      updateToDone: this.db.prepare(`
        UPDATE logs SET state = 'done', llm_message = ?, git_commit = ?, 
        statistics = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `),
      
      updateToRevert: this.db.prepare(`
        UPDATE logs SET state = 'revert', revert_reason = ?, reverted_at = ?, 
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `),
      
      updateToOpen: this.db.prepare(`
        UPDATE logs SET state = 'open', context = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `),
      
      reopenExisting: this.db.prepare(`
        UPDATE logs SET state = 'open', timestamp = ?, context = ?, 
        screenshots = ?, reopened_at = ?, reopen_count = reopen_count + 1,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `),
      
      deleteById: this.db.prepare('DELETE FROM logs WHERE id = ?'),
      
      deleteByApplicationId: this.db.prepare('DELETE FROM logs WHERE application_id = ?'),
      
      deleteByClosed: this.db.prepare(`
        DELETE FROM logs WHERE application_id = ? AND state = 'closed'
      `),
      
      findDuplicates: this.db.prepare(`
        SELECT * FROM logs 
        WHERE application_id = ? AND message = ? AND state IN ('done', 'closed')
        ORDER BY timestamp DESC LIMIT 1
      `),
      
      findSimilarMessages: this.db.prepare(`
        SELECT id, message, context FROM logs 
        WHERE application_id = ? AND state NOT IN ('closed') 
        AND created_at > datetime('now', '-7 days')
      `),
      
      getStatistics: this.db.prepare(`
        SELECT 
          state,
          COUNT(*) as count,
          MIN(timestamp) as oldest,
          MAX(timestamp) as newest
        FROM logs 
        WHERE application_id = ? 
        GROUP BY state
      `)
    };
  }

  async create(logData) {
    const {
      id, applicationId, timestamp, message, context, 
      screenshots, state = 'open', reopenCount = 0
    } = logData;

    try {
      this.statements.insert.run(
        id, applicationId, timestamp, message, 
        JSON.stringify(context || {}), 
        JSON.stringify(screenshots || []), 
        state, reopenCount
      );
      return this.findById(id);
    } catch (error) {
      throw new Error(`Failed to create log entry: ${error.message}`);
    }
  }

  findById(id) {
    try {
      const row = this.statements.findById.get(id);
      return row ? this.transformRow(row) : null;
    } catch (error) {
      throw new Error(`Failed to find log by ID: ${error.message}`);
    }
  }

  findByApplicationId(applicationId) {
    try {
      const rows = this.statements.findByApplicationId.all(applicationId);
      return rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find logs by application ID: ${error.message}`);
    }
  }

  findByState(applicationId, state) {
    try {
      const rows = this.statements.findByState.all(applicationId, state);
      return rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find logs by state: ${error.message}`);
    }
  }

  findOpenAndRevert(applicationId) {
    try {
      const rows = this.statements.findOpenAndRevert.all(applicationId);
      return rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find open and revert logs: ${error.message}`);
    }
  }

  findDuplicateCandidate(applicationId, message, context) {
    try {
      const combinedMessage = message + (context?.message || '');
      const row = this.statements.findDuplicates.get(applicationId, combinedMessage);
      return row ? this.transformRow(row) : null;
    } catch (error) {
      throw new Error(`Failed to find duplicate candidate: ${error.message}`);
    }
  }

  updateState(id, state) {
    try {
      const result = this.statements.updateState.run(state, id);
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to update log state: ${error.message}`);
    }
  }

  updateToInProgress(id) {
    try {
      const now = new Date().toISOString();
      const result = this.statements.updateToInProgress.run(now, id);
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to update log to in progress: ${error.message}`);
    }
  }

  updateToDone(id, llmMessage, gitCommit, statistics) {
    try {
      const now = new Date().toISOString();
      const result = this.statements.updateToDone.run(
        llmMessage, gitCommit, JSON.stringify(statistics), now, id
      );
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to update log to done: ${error.message}`);
    }
  }

  updateToRevert(id, revertReason) {
    try {
      const now = new Date().toISOString();
      const result = this.statements.updateToRevert.run(revertReason, now, id);
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to update log to revert: ${error.message}`);
    }
  }

  updateToOpen(id, context) {
    try {
      const result = this.statements.updateToOpen.run(JSON.stringify(context), id);
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to update log to open: ${error.message}`);
    }
  }

  reopenExisting(id, timestamp, context, screenshots) {
    try {
      const now = new Date().toISOString();
      const result = this.statements.reopenExisting.run(
        timestamp, JSON.stringify(context), JSON.stringify(screenshots), now, id
      );
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to reopen existing log: ${error.message}`);
    }
  }

  deleteById(id) {
    try {
      const result = this.statements.deleteById.run(id);
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to delete log by ID: ${error.message}`);
    }
  }

  deleteByApplicationId(applicationId) {
    try {
      const result = this.statements.deleteByApplicationId.run(applicationId);
      return result.changes;
    } catch (error) {
      throw new Error(`Failed to delete logs by application ID: ${error.message}`);
    }
  }

  deleteClosedLogs(applicationId) {
    try {
      const result = this.statements.deleteByClosed.run(applicationId);
      return result.changes;
    } catch (error) {
      throw new Error(`Failed to delete closed logs: ${error.message}`);
    }
  }

  getStatistics(applicationId) {
    try {
      const rows = this.statements.getStatistics.all(applicationId);
      return rows.reduce((acc, row) => {
        acc[row.state] = {
          count: row.count,
          oldest: row.oldest,
          newest: row.newest
        };
        return acc;
      }, {});
    } catch (error) {
      throw new Error(`Failed to get statistics: ${error.message}`);
    }
  }

  transformRow(row) {
    return {
      id: row.id,
      applicationId: row.application_id,
      timestamp: row.timestamp,
      message: row.message,
      context: row.context ? JSON.parse(row.context) : {},
      screenshots: row.screenshots ? JSON.parse(row.screenshots) : [],
      state: row.state,
      llmMessage: row.llm_message,
      gitCommit: row.git_commit,
      statistics: row.statistics ? JSON.parse(row.statistics) : null,
      reopenCount: row.reopen_count,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      reopenedAt: row.reopened_at,
      revertedAt: row.reverted_at,
      revertReason: row.revert_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export default LogRepository;
