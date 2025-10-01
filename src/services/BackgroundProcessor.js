import cron from 'node-cron';
import EmbeddingService from './EmbeddingService.js';
import config from '../config/index.js';

class BackgroundProcessor {
  constructor() {
    this.embeddingService = new EmbeddingService();
    this.isRunning = false;
    this.cronJob = null;
    this.processingQueue = new Set();
    this.stats = {
      lastRun: null,
      logsProcessed: 0,
      embeddings_generated: 0,
      logs_merged: 0,
      errors: 0
    };
  }

  initialize() {
    this.embeddingService.initialize();
    
    if (config.embedding.enabled) {
      this.scheduleProcessing();
      console.log('Background processor initialized for embeddings');
    } else {
      console.log('Background processor disabled (embeddings not enabled)');
    }
  }

  scheduleProcessing() {
    if (this.cronJob) {
      this.cronJob.destroy();
    }

    // Run every 2 minutes to process pending embeddings
    this.cronJob = cron.schedule('*/10 * * * * *', async () => {
      await this.processEmbeddings();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });
  }

  async processEmbeddings() {
    if (this.isRunning || !this.embeddingService.isAvailable()) {
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      console.log('Starting background embedding processing...');
      
      // Reset stats for this run
      this.stats.logsProcessed = 0;
      this.stats.embeddings_generated = 0;
      this.stats.logs_merged = 0;
      this.stats.errors = 0;
      
      // Get pending logs that need embeddings
      const pendingLogs = await this.embeddingService.getPendingEmbeddings(20);
      
      for (const log of pendingLogs) {
        if (this.processingQueue.has(log.id)) {
          continue; // Skip if already being processed
        }
        
        this.processingQueue.add(log.id);
        
        try {
          await this.processLogEmbedding(log);
          this.stats.logsProcessed++;
        } catch (error) {
          console.error(`Failed to process log ${log.id}:`, error);
          this.stats.errors++;
          // Keep log in pending state if embedding fails
          // Will retry on next background processing run
        } finally {
          this.processingQueue.delete(log.id);
        }
      }
      
      this.stats.lastRun = new Date().toISOString();
      const duration = Date.now() - startTime;
      
      if (pendingLogs.length > 0) {
        console.log(`Background processing completed in ${duration}ms:`, {
          logsProcessed: this.stats.logsProcessed,
          embeddingsGenerated: this.stats.embeddings_generated,
          logsMerged: this.stats.logs_merged,
          errors: this.stats.errors
        });
      }
      
    } catch (error) {
      console.error('Background processing failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async processLogEmbedding(log) {
    try {
      console.log(`[BackgroundProcessor] Processing log ${log.id}: "${log.message}"`);

      // Generate embedding for the log
      const text = this.embeddingService.formatTextForEmbedding(log);
      const embedding = await this.embeddingService.generateEmbedding(text);
      this.stats.embeddings_generated++;
      console.log(`[BackgroundProcessor] Generated embedding for log ${log.id}`);

      // Find similar logs
      const similarLogs = await this.embeddingService.findSimilarLogs(
        embedding,
        log.application_id,
        5,
        config.embedding.similarityThreshold
      );

      console.log(`[BackgroundProcessor] Found ${similarLogs.length} similar logs for ${log.id} (threshold: ${config.embedding.similarityThreshold})`);
      if (similarLogs.length > 0) {
        console.log(`[BackgroundProcessor] Similar logs:`, similarLogs.map(l => ({
          id: l.id,
          message: l.message.substring(0, 50),
          state: l.state,
          similarity: l.similarity_score
        })));
      }

      // Check if we should merge with an existing log
      const mergeCandidate = this.findBestMergeCandidate(similarLogs);

      if (mergeCandidate) {
        console.log(`[BackgroundProcessor] Merge candidate found for ${log.id}:`, {
          candidateId: mergeCandidate.id,
          candidateMessage: mergeCandidate.message.substring(0, 50),
          candidateState: mergeCandidate.state,
          similarity: mergeCandidate.similarity_score,
          threshold: config.embedding.similarityThreshold
        });

        // Merge the pending log into the existing one
        const merged = await this.embeddingService.mergeLogs(
          log.id,
          mergeCandidate.id,
          `Similarity score: ${mergeCandidate.similarity_score.toFixed(3)}`
        );

        if (merged) {
          this.stats.logs_merged++;
          console.log(`Merged log ${log.id} into ${mergeCandidate.id} (similarity: ${mergeCandidate.similarity_score.toFixed(3)})`);
          return;
        }
      } else {
        console.log(`[BackgroundProcessor] No merge candidate found for ${log.id}`);
      }

      // No merge candidate found, save embedding and move to open state
      await this.embeddingService.saveEmbedding(log.id, embedding);

      // Automatically move from pending to open after embedding is complete
      await this.embeddingService.updateLogState(log.id, 'open');
      console.log(`Log ${log.id} embedded and moved to open state`);

    } catch (error) {
      console.error(`Failed to process embedding for log ${log.id}:`, error);
      throw error;
    }
  }

  findBestMergeCandidate(similarLogs) {
    if (!similarLogs || similarLogs.length === 0) {
      console.log(`[BackgroundProcessor] No similar logs to check for merging`);
      return null;
    }

    console.log(`[BackgroundProcessor] Checking ${similarLogs.length} similar logs for merge candidates`);
    console.log(`[BackgroundProcessor] Merge threshold: ${config.embedding.similarityThreshold}`);

    // Find the most similar log that's in a state we can merge with
    const mergeableStates = ['pending', 'open', 'in_progress', 'done'];

    for (const log of similarLogs) {
      console.log(`[BackgroundProcessor] Evaluating log ${log.id}:`, {
        state: log.state,
        similarity: log.similarity_score,
        threshold: config.embedding.similarityThreshold,
        isMergeableState: mergeableStates.includes(log.state),
        meetsThreshold: log.similarity_score >= config.embedding.similarityThreshold
      });

      if (mergeableStates.includes(log.state) &&
          log.similarity_score >= config.embedding.similarityThreshold) {
        console.log(`[BackgroundProcessor] Selected log ${log.id} as merge candidate`);
        return log;
      }
    }

    console.log(`[BackgroundProcessor] No suitable merge candidate found`);
    return null;
  }

  async forceProcessing() {
    if (this.isRunning) {
      throw new Error('Background processing is already running');
    }
    
    return this.processEmbeddings();
  }

  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      queueSize: this.processingQueue.size,
      enabled: config.embedding.enabled
    };
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.destroy();
      this.cronJob = null;
    }
    console.log('Background processor stopped');
  }

  // Manual processing trigger for specific log
  async processLogById(logId) {
    if (!this.embeddingService.isAvailable()) {
      throw new Error('Embedding service not available');
    }

    if (this.processingQueue.has(logId)) {
      throw new Error('Log is already being processed');
    }

    try {
      this.processingQueue.add(logId);
      
      // Get the log
      const result = await this.embeddingService.pool.query(
        'SELECT id, application_id, message, context, timestamp FROM logs WHERE id = $1 AND state = $2',
        [logId, 'pending']
      );
      
      if (result.rows.length === 0) {
        throw new Error('Log not found or not in pending state');
      }
      
      const log = result.rows[0];
      await this.processLogEmbedding(log);
      
      return { success: true, message: 'Log processed successfully' };
      
    } finally {
      this.processingQueue.delete(logId);
    }
  }

  // Get processing status for a specific log
  isLogBeingProcessed(logId) {
    return this.processingQueue.has(logId);
  }
}

export default BackgroundProcessor;
