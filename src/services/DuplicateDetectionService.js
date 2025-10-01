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

    const { applicationId, message, context, newLogId } = logData;
    
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
          action: 'rejected_obsolete',
          matchDetails: {
            matchType: exactMatch._matchType,
            originalMessage: exactMatch.message,
            originalContext: exactMatch.context,
            originalState: exactMatch.state,
            originalTimestamp: exactMatch.timestamp
          }
        };
      }
    }

    // Step 2: Embedding-based similarity detection
    if (config.duplicateDetection.embeddingEnabled && this.embeddingService.isAvailable()) {
      const embeddingResult = await this.checkEmbeddingSimilarity(applicationId, message, context, newLogId);
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
   * Combine message and context.message into a single string for comparison
   */
  getCombinedMessage(message, context) {
    const parts = [message];

    // If context has a message field, include it
    if (context && context.message) {
      parts.push(context.message);
    }

    return parts.join(' | ');
  }

  /**
   * Check for exact matches in title and/or content
   * Now compares combined message (message + context.message) to handle cases
   * where the actual message content is in different fields
   */
  async findExactMatch(applicationId, message, context) {
    try {
      // Combine message and context.message for comparison
      const combinedMessage = this.getCombinedMessage(message, context);

      // Find all open logs for this application
      const query = `
        SELECT id, message, context, state, timestamp
        FROM logs
        WHERE application_id = $1
          AND state NOT IN ('closed', 'revert')
        ORDER BY timestamp DESC
      `;

      const result = await this.pool.query(query, [applicationId]);

      // Check each log for a combined message match
      for (const log of result.rows) {
        const logCombinedMessage = this.getCombinedMessage(log.message, log.context);

        if (combinedMessage === logCombinedMessage) {
          log._matchType = 'combined_message';
          return log;
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
  async checkEmbeddingSimilarity(applicationId, message, context, newLogId) {
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
          newLogId,
          highSimilarityLog.similarity_score,
          'embedding_high'
        );
        return {
          isDuplicate: true,
          method: 'embedding_high',
          originalId: highSimilarityLog.id,
          similarity: highSimilarityLog.similarity_score,
          action: 'rejected_obsolete',
          matchDetails: {
            matchType: 'embedding_similarity',
            originalMessage: highSimilarityLog.message,
            originalContext: highSimilarityLog.context,
            originalState: highSimilarityLog.state,
            originalTimestamp: highSimilarityLog.timestamp
          }
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
            mediumSimilarityLogs,
            newLogId
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
  async checkGeminiSimilarity(logEntry, candidateLogs, newLogId) {
    try {
      const similarities = await this.geminiService.detectDuplicates(logEntry, candidateLogs);
      
      for (let i = 0; i < similarities.length && i < candidateLogs.length; i++) {
        const similarity = similarities[i];
        const candidate = candidateLogs[i];

        if (similarity >= config.duplicateDetection.geminiThreshold) {
          await this.recordDuplicate(candidate.id, newLogId, similarity, 'gemini');
          return {
            isDuplicate: true,
            method: 'gemini',
            originalId: candidate.id,
            similarity: similarity,
            action: 'rejected_obsolete',
            matchDetails: {
              matchType: 'gemini_ai_analysis',
              originalMessage: candidate.message,
              originalContext: candidate.context,
              originalState: candidate.state,
              originalTimestamp: candidate.timestamp
            }
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
   * Uses combined message (message + context.message) to ensure both are always considered
   */
  formatTextForEmbedding(log) {
    // Use combined message for better duplicate detection
    const combinedMessage = this.getCombinedMessage(log.message, log.context);

    const parts = [
      `Message: ${combinedMessage}`,
      `Application: ${log.application_id}`
    ];

    // Include other context fields (excluding the message field since it's already in combinedMessage)
    if (log.context && Object.keys(log.context).length > 0) {
      const contextWithoutMessage = { ...log.context };
      delete contextWithoutMessage.message; // Remove message to avoid duplication

      if (Object.keys(contextWithoutMessage).length > 0) {
        const contextStr = JSON.stringify(contextWithoutMessage, null, 2);
        parts.push(`Context: ${contextStr}`);
      }
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
