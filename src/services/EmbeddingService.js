import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/index.js';
import databaseManager from '../config/database.js';

class EmbeddingService {
  constructor() {
    this.genAI = null;
    this.model = null;
    this.isInitialized = false;
    this.pool = null;
  }

  initialize() {
    if (!config.embedding.enabled) {
      console.log('Embedding service is disabled');
      return;
    }

    if (!config.embedding.apiKey) {
      console.warn('Gemini API key not provided, embedding features will be disabled');
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(config.embedding.apiKey);
      this.model = this.genAI.getGenerativeModel({ 
        model: config.embedding.model
      });
      this.pool = databaseManager.getPool();
      this.isInitialized = true;
      console.log(`Embedding service initialized with model: ${config.embedding.model}`);
    } catch (error) {
      console.error('Failed to initialize Embedding service:', error);
      throw error;
    }
  }

  isAvailable() {
    return this.isInitialized && config.embedding.enabled;
  }

  async generateEmbedding(text) {
    if (!this.isAvailable()) {
      throw new Error('Embedding service is not available');
    }

    try {
      const result = await this.model.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw new Error(`Embedding API error: ${error.message}`);
    }
  }

  async saveEmbedding(logId, embedding, model = null) {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const embeddingModel = model || config.embedding.model;
      const query = `
        UPDATE logs 
        SET embedding = $1, embedding_model = $2 
        WHERE id = $3
      `;
      
      await this.pool.query(query, [JSON.stringify(embedding), embeddingModel, logId]);
      return true;
    } catch (error) {
      console.error('Failed to save embedding:', error);
      return false;
    }
  }

  async findSimilarLogs(embedding, applicationId, limit = 10, threshold = null) {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const similarityThreshold = threshold || config.embedding.similarityThreshold;
      
      const query = `
        SELECT 
          id, 
          application_id, 
          message, 
          state, 
          timestamp,
          context,
          screenshots,
          1 - (embedding <=> $1::vector) as similarity_score
        FROM logs 
        WHERE application_id = $2 
          AND embedding IS NOT NULL 
          AND state != 'pending'
          AND 1 - (embedding <=> $1::vector) >= $3
        ORDER BY embedding <=> $1::vector
        LIMIT $4
      `;
      
      const result = await this.pool.query(query, [
        JSON.stringify(embedding), 
        applicationId, 
        similarityThreshold, 
        limit
      ]);
      
      return result.rows.map(row => ({
        ...row,
        similarity_score: parseFloat(row.similarity_score)
      }));
    } catch (error) {
      console.error('Failed to find similar logs:', error);
      return [];
    }
  }

  async getPendingEmbeddings(limit = 50) {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const query = `
        SELECT id, application_id, message, context, timestamp
        FROM logs 
        WHERE state = 'pending' AND embedding IS NULL
        ORDER BY created_at ASC
        LIMIT $1
      `;
      
      const result = await this.pool.query(query, [limit]);
      return result.rows;
    } catch (error) {
      console.error('Failed to get pending embeddings:', error);
      return [];
    }
  }

  async updateLogState(logId, newState) {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const query = `UPDATE logs SET state = $1 WHERE id = $2`;
      await this.pool.query(query, [newState, logId]);
      return true;
    } catch (error) {
      console.error('Failed to update log state:', error);
      return false;
    }
  }

  async mergeLogs(sourceLogId, targetLogId, mergeReason = 'Similar content detected') {
    if (!this.isAvailable()) {
      return false;
    }

    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get both logs
      const sourceResult = await client.query('SELECT * FROM logs WHERE id = $1', [sourceLogId]);
      const targetResult = await client.query('SELECT * FROM logs WHERE id = $1', [targetLogId]);

      if (sourceResult.rows.length === 0 || targetResult.rows.length === 0) {
        throw new Error('One or both logs not found');
      }

      const sourceLog = sourceResult.rows[0];
      const targetLog = targetResult.rows[0];

      // Merge context and screenshots
      const mergedContext = { 
        ...targetLog.context, 
        ...sourceLog.context,
        merged_from: sourceLogId,
        merge_reason: mergeReason,
        merge_timestamp: new Date().toISOString()
      };
      
      // Ensure screenshots are arrays before spreading
      const targetScreenshots = Array.isArray(targetLog.screenshots) ? targetLog.screenshots : [];
      const sourceScreenshots = Array.isArray(sourceLog.screenshots) ? sourceLog.screenshots : [];

      const mergedScreenshots = [
        ...targetScreenshots,
        ...sourceScreenshots
      ];

      // Update target log with merged data
      const updateQuery = `
        UPDATE logs 
        SET 
          context = $1,
          screenshots = $2,
          reopen_count = reopen_count + 1,
          updated_at = NOW()
        WHERE id = $3
      `;
      
      await client.query(updateQuery, [
        JSON.stringify(mergedContext),
        JSON.stringify(mergedScreenshots),
        targetLogId
      ]);

      // Record the merge in duplicates table
      const duplicateQuery = `
        INSERT INTO duplicates (original_log_id, duplicate_log_id, similarity_score)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `;
      
      await client.query(duplicateQuery, [targetLogId, sourceLogId, 0.95]);

      // Delete the source log
      await client.query('DELETE FROM logs WHERE id = $1', [sourceLogId]);

      await client.query('COMMIT');
      console.log(`Successfully merged log ${sourceLogId} into ${targetLogId}`);
      return true;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to merge logs:', error);
      return false;
    } finally {
      client.release();
    }
  }

  formatTextForEmbedding(log) {
    // Create a comprehensive text representation for embedding
    const parts = [
      `Message: ${log.message}`,
      `Application: ${log.application_id}`
    ];

    if (log.context && Object.keys(log.context).length > 0) {
      // Extract meaningful context information
      const contextStr = JSON.stringify(log.context, null, 2);
      parts.push(`Context: ${contextStr}`);
    }

    return parts.join('\n');
  }

  calculateCosineSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }
}

export default EmbeddingService;
