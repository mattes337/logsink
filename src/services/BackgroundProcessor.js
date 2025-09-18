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
    this.cronJob = cron.schedule('*/2 * * * *', async () => {
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
          // Move log to open state if embedding fails
          await this.embeddingService.updateLogState(log.id, 'open');
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
      // Generate embedding for the log
      const text = this.embeddingService.formatTextForEmbedding(log);
      const embedding = await this.embeddingService.generateEmbedding(text);
      this.stats.embeddings_generated++;
      
      // Find similar logs
      const similarLogs = await this.embeddingService.findSimilarLogs(
        embedding, 
        log.application_id, 
        5, 
        config.embedding.similarityThreshold
      );
      
      // Check if we should merge with an existing log
      const mergeCandidate = this.findBestMergeCandidate(similarLogs);
      
      if (mergeCandidate) {
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
      }
      
      // No merge candidate found, save embedding and set to open
      await this.embeddingService.saveEmbedding(log.id, embedding);
      await this.embeddingService.updateLogState(log.id, 'open');
      
    } catch (error) {
      console.error(`Failed to process embedding for log ${log.id}:`, error);
      throw error;
    }
  }

  findBestMergeCandidate(similarLogs) {
    if (!similarLogs || similarLogs.length === 0) {
      return null;
    }
    
    // Find the most similar log that's in a state we can merge with
    const mergeableStates = ['open', 'in_progress', 'done'];
    
    for (const log of similarLogs) {
      if (mergeableStates.includes(log.state) && 
          log.similarity_score >= config.embedding.similarityThreshold) {
        return log;
      }
    }
    
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
