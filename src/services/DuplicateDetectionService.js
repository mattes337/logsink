import config from '../config/index.js';
import databaseManager from '../config/database.js';
import EmbeddingService from './EmbeddingService.js';
import GeminiService from './GeminiService.js';

class DuplicateDetectionService {
  constructor() {
    this.pool = null;
    this.embeddingService = new EmbeddingService();
    this.geminiService = new GeminiService();
    this.isInitialized = false;
  }

  initialize() {
    this.pool = databaseManager.getPool();
    this.embeddingService.initialize();
    this.geminiService.initialize();
    this.isInitialized = true;
    console.log('DuplicateDetectionService initialized');
  }

  /**
   * Main duplicate detection method that implements the enhanced strategy:
   * 1. Check for exact title/content matches (immediate rejection)
   * 2. Generate embedding and check for high similarity (0.95+ threshold)
   * 3. Use Gemini for edge cases with medium similarity
   */
  async detectDuplicate(logData) {
    if (!this.isInitialized) {
      throw new Error('DuplicateDetectionService not initialized');
    }

    const { applicationId, message, context } = logData;
    
    // Step 1: Check for exact matches (title/content)
    if (config.duplicateDetection.exactMatchEnabled) {
      const exactMatch = await this.findExactMatch(applicationId, message, context);
      if (exactMatch) {
        // For exact matches that are rejected as obsolete, we don't record in duplicates table
        // since no new log entry is created
        return {
          isDuplicate: true,
          method: 'exact_match',
          originalId: exactMatch.id,
          similarity: 1.0,
          action: 'rejected_obsolete'
        };
      }
    }

    // Step 2: Embedding-based similarity detection
    if (config.duplicateDetection.embeddingEnabled && this.embeddingService.isAvailable()) {
      const embeddingResult = await this.checkEmbeddingSimilarity(applicationId, message, context);
      if (embeddingResult) {
        return embeddingResult;
      }
    }

    // No duplicate found
    return {
      isDuplicate: false,
      method: 'none',
      originalId: null,
      similarity: 0,
      action: 'create_new'
    };
  }

  /**
   * Check for exact matches in title and/or content
   */
  async findExactMatch(applicationId, message, context) {
    try {
      // Check for exact message match
      const messageQuery = `
        SELECT id, message, context, state, timestamp
        FROM logs
        WHERE application_id = $1 
          AND message = $2
          AND state NOT IN ('closed', 'revert')
        ORDER BY timestamp DESC
        LIMIT 1
      `;
      
      const messageResult = await this.pool.query(messageQuery, [applicationId, message]);
      if (messageResult.rows.length > 0) {
        return messageResult.rows[0];
      }

      // Check for exact content match (message + context combination)
      if (context && Object.keys(context).length > 0) {
        const contextStr = JSON.stringify(context);
        const contentQuery = `
          SELECT id, message, context, state, timestamp
          FROM logs
          WHERE application_id = $1 
            AND (message = $2 OR context::text = $3)
            AND state NOT IN ('closed', 'revert')
          ORDER BY timestamp DESC
          LIMIT 1
        `;
        
        const contentResult = await this.pool.query(contentQuery, [applicationId, message, contextStr]);
        if (contentResult.rows.length > 0) {
          return contentResult.rows[0];
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding exact match:', error);
      return null;
    }
  }

  /**
   * Check for embedding-based similarity
   */
  async checkEmbeddingSimilarity(applicationId, message, context) {
    try {
      // Generate embedding for the new log
      const text = this.formatTextForEmbedding({ message, application_id: applicationId, context });
      const embedding = await this.embeddingService.generateEmbedding(text);

      // Find similar logs using embedding
      const similarLogs = await this.embeddingService.findSimilarLogs(
        embedding,
        applicationId,
        config.duplicateDetection.maxCandidatesForEmbedding,
        config.duplicateDetection.embeddingMediumThreshold
      );

      if (similarLogs.length === 0) {
        return null;
      }

      // Check for high similarity (immediate rejection)
      const highSimilarityLog = similarLogs.find(log => 
        log.similarity_score >= config.duplicateDetection.embeddingHighThreshold
      );

      if (highSimilarityLog) {
        await this.recordDuplicate(
          highSimilarityLog.id, 
          null, 
          highSimilarityLog.similarity_score, 
          'embedding_high'
        );
        return {
          isDuplicate: true,
          method: 'embedding_high',
          originalId: highSimilarityLog.id,
          similarity: highSimilarityLog.similarity_score,
          action: 'rejected_obsolete'
        };
      }

      // Check for medium similarity - use Gemini for final decision
      if (config.duplicateDetection.geminiEnabled && this.geminiService.isAvailable()) {
        const mediumSimilarityLogs = similarLogs
          .filter(log => log.similarity_score >= config.duplicateDetection.embeddingMediumThreshold)
          .slice(0, config.duplicateDetection.maxCandidatesForGemini);

        if (mediumSimilarityLogs.length > 0) {
          const geminiResult = await this.checkGeminiSimilarity(
            { message, applicationId, context },
            mediumSimilarityLogs
          );
          if (geminiResult) {
            return geminiResult;
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error checking embedding similarity:', error);
      return null;
    }
  }

  /**
   * Use Gemini for sophisticated duplicate detection on edge cases
   */
  async checkGeminiSimilarity(logEntry, candidateLogs) {
    try {
      const similarities = await this.geminiService.detectDuplicates(logEntry, candidateLogs);
      
      for (let i = 0; i < similarities.length && i < candidateLogs.length; i++) {
        const similarity = similarities[i];
        const candidate = candidateLogs[i];
        
        if (similarity >= config.duplicateDetection.geminiThreshold) {
          await this.recordDuplicate(candidate.id, null, similarity, 'gemini');
          return {
            isDuplicate: true,
            method: 'gemini',
            originalId: candidate.id,
            similarity: similarity,
            action: 'rejected_obsolete'
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error checking Gemini similarity:', error);
      return null;
    }
  }

  /**
   * Record duplicate detection in the database
   */
  async recordDuplicate(originalLogId, duplicateLogId, similarity, method) {
    try {
      const query = `
        INSERT INTO duplicates (original_log_id, duplicate_log_id, similarity_score, detection_method)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (original_log_id, duplicate_log_id) DO UPDATE SET
          similarity_score = EXCLUDED.similarity_score,
          detection_method = EXCLUDED.detection_method,
          detected_at = NOW()
      `;
      
      await this.pool.query(query, [originalLogId, duplicateLogId, similarity, method]);
    } catch (error) {
      console.error('Error recording duplicate:', error);
    }
  }

  /**
   * Format text for embedding generation
   */
  formatTextForEmbedding(log) {
    const parts = [
      `Message: ${log.message}`,
      `Application: ${log.application_id}`
    ];

    if (log.context && Object.keys(log.context).length > 0) {
      const contextStr = JSON.stringify(log.context, null, 2);
      parts.push(`Context: ${contextStr}`);
    }

    return parts.join('\n');
  }

  /**
   * Get duplicate detection statistics
   */
  async getStats() {
    try {
      const query = `
        SELECT 
          detection_method,
          COUNT(*) as count,
          AVG(similarity_score) as avg_similarity,
          MAX(similarity_score) as max_similarity,
          MIN(similarity_score) as min_similarity
        FROM duplicates
        WHERE detected_at > NOW() - INTERVAL '30 days'
        GROUP BY detection_method
        ORDER BY count DESC
      `;
      
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error getting duplicate detection stats:', error);
      return [];
    }
  }
}

export default DuplicateDetectionService;
