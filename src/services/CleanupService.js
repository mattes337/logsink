import cron from 'node-cron';
import LogRepository from '../repositories/LogRepository.js';
import GeminiService from './GeminiService.js';
import config from '../config/index.js';
import fs from 'fs';
import path from 'path';

class CleanupService {
  constructor() {
    this.logRepo = new LogRepository();
    this.geminiService = new GeminiService();
    this.isRunning = false;
    this.cronJob = null;
    this.stats = {
      lastRun: null,
      duplicatesFound: 0,
      duplicatesRemoved: 0,
      oldLogsRemoved: 0,
      orphanedImagesRemoved: 0
    };
  }

  initialize() {
    this.logRepo.initialize();
    this.geminiService.initialize();
    
    if (config.cleanup.enabled) {
      this.scheduleCleanup();
      console.log(`Cleanup service scheduled: ${config.cleanup.interval}`);
    } else {
      console.log('Cleanup service is disabled');
    }
  }

  scheduleCleanup() {
    if (this.cronJob) {
      this.cronJob.destroy();
    }

    this.cronJob = cron.schedule(config.cleanup.interval, async () => {
      await this.runCleanup();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });
  }

  async runCleanup() {
    if (this.isRunning) {
      console.log('Cleanup already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      console.log('Starting cleanup process...');
      
      // Reset stats for this run
      this.stats.duplicatesFound = 0;
      this.stats.duplicatesRemoved = 0;
      this.stats.oldLogsRemoved = 0;
      this.stats.orphanedImagesRemoved = 0;
      
      // Run cleanup tasks
      await this.removeDuplicates();
      await this.removeOldLogs();
      await this.cleanupOrphanedImages();
      
      this.stats.lastRun = new Date().toISOString();
      const duration = Date.now() - startTime;
      
      console.log(`Cleanup completed in ${duration}ms:`, {
        duplicatesFound: this.stats.duplicatesFound,
        duplicatesRemoved: this.stats.duplicatesRemoved,
        oldLogsRemoved: this.stats.oldLogsRemoved,
        orphanedImagesRemoved: this.stats.orphanedImagesRemoved
      });
      
    } catch (error) {
      console.error('Cleanup process failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async removeDuplicates() {
    try {
      console.log('Scanning for duplicate logs...');
      
      // Get all applications with logs
      const applications = await this.getApplicationsWithLogs();
      
      for (const applicationId of applications) {
        await this.removeDuplicatesForApplication(applicationId);
      }
      
    } catch (error) {
      console.error('Failed to remove duplicates:', error);
      throw error;
    }
  }

  async removeDuplicatesForApplication(applicationId) {
    try {
      const logs = this.logRepo.findByApplicationId(applicationId);
      const duplicateGroups = new Map();
      
      // Group logs by message similarity
      for (let i = 0; i < logs.length; i++) {
        const log1 = logs[i];
        if (log1.state === 'closed') continue; // Skip already closed logs
        
        for (let j = i + 1; j < logs.length; j++) {
          const log2 = logs[j];
          if (log2.state === 'closed') continue;
          
          const similarity = await this.calculateSimilarity(log1, log2);
          
          if (similarity >= config.cleanup.duplicateThreshold) {
            this.stats.duplicatesFound++;
            
            // Keep the newer log, mark older as duplicate
            const [newer, older] = log1.timestamp > log2.timestamp ? [log1, log2] : [log2, log1];
            
            if (!duplicateGroups.has(newer.id)) {
              duplicateGroups.set(newer.id, []);
            }
            duplicateGroups.get(newer.id).push(older);
          }
        }
      }
      
      // Remove duplicates
      for (const [keepId, duplicates] of duplicateGroups) {
        for (const duplicate of duplicates) {
          await this.mergeDuplicateLog(keepId, duplicate);
          this.stats.duplicatesRemoved++;
        }
      }
      
    } catch (error) {
      console.error(`Failed to remove duplicates for application ${applicationId}:`, error);
    }
  }

  async calculateSimilarity(log1, log2) {
    try {
      // Simple similarity check first
      const message1 = log1.message.toLowerCase();
      const message2 = log2.message.toLowerCase();
      
      // Exact match
      if (message1 === message2) {
        return 1.0;
      }
      
      // Levenshtein distance based similarity
      const distance = this.levenshteinDistance(message1, message2);
      const maxLength = Math.max(message1.length, message2.length);
      const simpleSimilarity = 1 - (distance / maxLength);
      
      // If simple similarity is high enough, return it
      if (simpleSimilarity >= config.cleanup.duplicateThreshold) {
        return simpleSimilarity;
      }
      
      // Use Gemini for more sophisticated comparison if available
      if (this.geminiService.isAvailable()) {
        try {
          const similarities = await this.geminiService.detectDuplicates(log1, [log2]);
          return similarities[0] || simpleSimilarity;
        } catch (error) {
          console.warn('Gemini similarity check failed, using simple method:', error.message);
          return simpleSimilarity;
        }
      }
      
      return simpleSimilarity;
      
    } catch (error) {
      console.error('Failed to calculate similarity:', error);
      return 0;
    }
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  async mergeDuplicateLog(keepId, duplicateLog) {
    try {
      // Get the log to keep
      const keepLog = this.logRepo.findById(keepId);
      if (!keepLog) return;
      
      // Merge context and screenshots
      const mergedContext = { ...duplicateLog.context, ...keepLog.context };
      const mergedScreenshots = [...(keepLog.screenshots || []), ...(duplicateLog.screenshots || [])];
      
      // Update the kept log with merged data
      this.logRepo.updateToOpen(keepId, mergedContext);
      
      // Update screenshots in database (this would need a new method)
      // For now, we'll just delete the duplicate
      
      // Delete the duplicate log
      this.logRepo.deleteById(duplicateLog.id);
      
      console.log(`Merged duplicate log ${duplicateLog.id} into ${keepId}`);
      
    } catch (error) {
      console.error('Failed to merge duplicate log:', error);
    }
  }

  async removeOldLogs() {
    try {
      console.log('Removing old logs...');
      
      const cutoffDate = new Date(Date.now() - config.cleanup.maxAge);
      const cutoffIso = cutoffDate.toISOString();
      
      // This would need a custom query to delete old logs
      // For now, we'll implement a simple version
      const applications = await this.getApplicationsWithLogs();
      
      for (const applicationId of applications) {
        const logs = this.logRepo.findByApplicationId(applicationId);
        
        for (const log of logs) {
          if (log.state === 'closed' && log.timestamp < cutoffIso) {
            this.logRepo.deleteById(log.id);
            this.stats.oldLogsRemoved++;
          }
        }
      }
      
    } catch (error) {
      console.error('Failed to remove old logs:', error);
    }
  }

  async cleanupOrphanedImages() {
    try {
      console.log('Cleaning up orphaned images...');
      
      const imagesDir = config.storage.imagesDir;
      if (!fs.existsSync(imagesDir)) {
        return;
      }
      
      // Get all image files
      const imageFiles = fs.readdirSync(imagesDir);
      
      // Get all referenced images from database
      const applications = await this.getApplicationsWithLogs();
      const referencedImages = new Set();
      
      for (const applicationId of applications) {
        const logs = this.logRepo.findByApplicationId(applicationId);
        for (const log of logs) {
          if (log.screenshots) {
            log.screenshots.forEach(img => referencedImages.add(img));
          }
        }
      }
      
      // Remove orphaned images
      for (const imageFile of imageFiles) {
        if (!referencedImages.has(imageFile)) {
          const imagePath = path.join(imagesDir, imageFile);
          try {
            fs.unlinkSync(imagePath);
            this.stats.orphanedImagesRemoved++;
          } catch (error) {
            console.error(`Failed to delete orphaned image ${imageFile}:`, error);
          }
        }
      }
      
    } catch (error) {
      console.error('Failed to cleanup orphaned images:', error);
    }
  }

  async getApplicationsWithLogs() {
    // This would need a custom query to get distinct application IDs
    // For now, we'll use a simple approach
    try {
      const db = this.logRepo.db;
      const result = db.prepare('SELECT DISTINCT application_id FROM logs').all();
      return result.map(row => row.application_id);
    } catch (error) {
      console.error('Failed to get applications with logs:', error);
      return [];
    }
  }

  async forceCleanup() {
    if (this.isRunning) {
      throw new Error('Cleanup is already running');
    }
    
    console.log('Starting forced cleanup...');
    await this.runCleanup();
  }

  getStats() {
    return { ...this.stats };
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.destroy();
      this.cronJob = null;
    }
    console.log('Cleanup service stopped');
  }
}

export default CleanupService;
