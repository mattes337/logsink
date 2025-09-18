import databaseManager from '../config/database.js';

class LogRepository {
  constructor() {
    this.pool = null;
  }

  initialize() {
    this.pool = databaseManager.getPool();
  }

  async create(logData) {
    const {
      id, applicationId, timestamp, message, context,
      screenshots, state = 'open', reopenCount = 0
    } = logData;

    try {
      const query = `
        INSERT INTO logs (
          id, application_id, timestamp, message, context, screenshots,
          state, reopen_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;

      const values = [
        id,
        applicationId,
        timestamp,
        message,
        context || {},
        screenshots || [],
        state,
        reopenCount
      ];

      const result = await this.pool.query(query, values);
      return this.transformRow(result.rows[0]);
    } catch (error) {
      throw new Error(`Failed to create log entry: ${error.message}`);
    }
  }

  async findById(id) {
    try {
      const query = 'SELECT * FROM logs WHERE id = $1';
      const result = await this.pool.query(query, [id]);
      return result.rows.length > 0 ? this.transformRow(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to find log by ID: ${error.message}`);
    }
  }

  async findByApplicationId(applicationId) {
    try {
      const query = `
        SELECT * FROM logs WHERE application_id = $1
        ORDER BY timestamp DESC
      `;
      const result = await this.pool.query(query, [applicationId]);
      return result.rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find logs by application ID: ${error.message}`);
    }
  }

  async findByState(applicationId, state) {
    try {
      const query = `
        SELECT * FROM logs WHERE application_id = $1 AND state = $2
        ORDER BY timestamp DESC
      `;
      const result = await this.pool.query(query, [applicationId, state]);
      return result.rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find logs by state: ${error.message}`);
    }
  }

  async findOpenAndRevert(applicationId) {
    try {
      const query = `
        SELECT * FROM logs WHERE application_id = $1 AND state IN ('open', 'revert')
        ORDER BY CASE WHEN state = 'revert' THEN 0 ELSE 1 END, timestamp DESC
      `;
      const result = await this.pool.query(query, [applicationId]);
      return result.rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find open and revert logs: ${error.message}`);
    }
  }

  async findDuplicateCandidate(applicationId, message, context) {
    try {
      const combinedMessage = message + (context?.message || '');
      const query = `
        SELECT * FROM logs
        WHERE application_id = $1 AND message = $2 AND state IN ('done', 'closed')
        ORDER BY timestamp DESC LIMIT 1
      `;
      const result = await this.pool.query(query, [applicationId, combinedMessage]);
      return result.rows.length > 0 ? this.transformRow(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to find duplicate candidate: ${error.message}`);
    }
  }

  async updateState(id, state) {
    try {
      const query = 'UPDATE logs SET state = $1 WHERE id = $2';
      const result = await this.pool.query(query, [state, id]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to update log state: ${error.message}`);
    }
  }

  async updateToInProgress(id) {
    try {
      const query = `
        UPDATE logs SET state = 'in_progress', started_at = NOW()
        WHERE id = $1
      `;
      const result = await this.pool.query(query, [id]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to update log to in progress: ${error.message}`);
    }
  }

  async updateToDone(id, llmMessage, gitCommit, statistics) {
    try {
      const query = `
        UPDATE logs SET state = 'done', llm_message = $1, git_commit = $2,
        statistics = $3, completed_at = NOW()
        WHERE id = $4
      `;
      const result = await this.pool.query(query, [
        llmMessage, gitCommit, statistics || {}, id
      ]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to update log to done: ${error.message}`);
    }
  }

  async updateToRevert(id, revertReason) {
    try {
      const query = `
        UPDATE logs SET state = 'revert', revert_reason = $1, reverted_at = NOW()
        WHERE id = $2
      `;
      const result = await this.pool.query(query, [revertReason, id]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to update log to revert: ${error.message}`);
    }
  }

  async updateToOpen(id, context) {
    try {
      const query = 'UPDATE logs SET state = \'open\', context = $1 WHERE id = $2';
      const result = await this.pool.query(query, [context || {}, id]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to update log to open: ${error.message}`);
    }
  }

  async reopenExisting(id, timestamp, context, screenshots) {
    try {
      const query = `
        UPDATE logs SET state = 'open', timestamp = $1, context = $2,
        screenshots = $3, reopened_at = NOW(), reopen_count = reopen_count + 1
        WHERE id = $4
      `;
      const result = await this.pool.query(query, [
        timestamp, context || {}, screenshots || [], id
      ]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to reopen existing log: ${error.message}`);
    }
  }

  async deleteById(id) {
    try {
      const query = 'DELETE FROM logs WHERE id = $1';
      const result = await this.pool.query(query, [id]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to delete log by ID: ${error.message}`);
    }
  }

  async deleteByApplicationId(applicationId) {
    try {
      const query = 'DELETE FROM logs WHERE application_id = $1';
      const result = await this.pool.query(query, [applicationId]);
      return result.rowCount;
    } catch (error) {
      throw new Error(`Failed to delete logs by application ID: ${error.message}`);
    }
  }

  async deleteClosedLogs(applicationId) {
    try {
      const query = 'DELETE FROM logs WHERE application_id = $1 AND state = \'closed\'';
      const result = await this.pool.query(query, [applicationId]);
      return result.rowCount;
    } catch (error) {
      throw new Error(`Failed to delete closed logs: ${error.message}`);
    }
  }

  async findSimilarMessages(applicationId) {
    try {
      const query = `
        SELECT id, message, context FROM logs
        WHERE application_id = $1 AND state NOT IN ('closed')
        AND created_at > NOW() - INTERVAL '7 days'
      `;
      const result = await this.pool.query(query, [applicationId]);
      return result.rows.map(row => this.transformRow(row));
    } catch (error) {
      throw new Error(`Failed to find similar messages: ${error.message}`);
    }
  }

  async getStatistics(applicationId) {
    try {
      const query = `
        SELECT
          state,
          COUNT(*) as count,
          MIN(timestamp) as oldest,
          MAX(timestamp) as newest
        FROM logs
        WHERE application_id = $1
        GROUP BY state
      `;
      const result = await this.pool.query(query, [applicationId]);
      return result.rows.reduce((acc, row) => {
        acc[row.state] = {
          count: parseInt(row.count),
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
      context: row.context || {},
      screenshots: row.screenshots || [],
      state: row.state,
      llmMessage: row.llm_message,
      gitCommit: row.git_commit,
      statistics: row.statistics || null,
      reopenCount: row.reopen_count,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      reopenedAt: row.reopened_at,
      revertedAt: row.reverted_at,
      revertReason: row.revert_reason,
      embedding: row.embedding,
      embeddingModel: row.embedding_model,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export default LogRepository;
