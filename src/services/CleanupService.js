import cron from 'node-cron';
import LogRepository from '../repositories/LogRepository.js';
import config from '../config/index.js';
import fs from 'fs';
import path from 'path';

class CleanupService {
  constructor() {
    this.logRepo = new LogRepository();
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
      console.log('Processing detected duplicates...');

      // Query the duplicates table for already-detected duplicates
      // that haven't been merged yet (both logs still exist)
      const pool = this.logRepo.pool;
      const query = `
        SELECT
          d.original_log_id,
          d.duplicate_log_id,
          d.similarity_score,
          d.detection_method,
          l1.state as original_state,
          l2.state as duplicate_state
        FROM duplicates d
        INNER JOIN logs l1 ON d.original_log_id = l1.id
        INNER JOIN logs l2 ON d.duplicate_log_id = l2.id
        WHERE l1.state NOT IN ('closed', 'revert')
          AND l2.state NOT IN ('closed', 'revert')
        ORDER BY d.detected_at ASC
      `;

      const result = await pool.query(query);
      const duplicatePairs = result.rows;

      console.log(`Found ${duplicatePairs.length} duplicate pairs to process`);

      // Process each duplicate pair
      for (const pair of duplicatePairs) {
        try {
          // Fetch the full log entries
          const originalLog = await this.logRepo.findById(pair.original_log_id);
          const duplicateLog = await this.logRepo.findById(pair.duplicate_log_id);

          if (!originalLog || !duplicateLog) {
            console.log(`Skipping duplicate pair - one or both logs no longer exist`);
            continue;
          }

          // Skip if either log is now closed/reverted
          if (['closed', 'revert'].includes(originalLog.state) ||
              ['closed', 'revert'].includes(duplicateLog.state)) {
            continue;
          }

          this.stats.duplicatesFound++;

          // Merge the duplicate into the original
          await this.mergeDuplicateLog(pair.original_log_id, duplicateLog);
          this.stats.duplicatesRemoved++;

          console.log(`Merged duplicate ${pair.duplicate_log_id} into ${pair.original_log_id} (${pair.detection_method}, similarity: ${pair.similarity_score})`);

        } catch (error) {
          console.error(`Failed to process duplicate pair ${pair.original_log_id} / ${pair.duplicate_log_id}:`, error);
        }
      }

    } catch (error) {
      console.error('Failed to remove duplicates:', error);
      throw error;
    }
  }

  async mergeDuplicateLog(keepId, duplicateLog) {
    try {
      // Get the log to keep
      const keepLog = await this.logRepo.findById(keepId);
      if (!keepLog) return;

      // Ensure screenshots are arrays before merging
      const keepScreenshots = Array.isArray(keepLog.screenshots) ? keepLog.screenshots : [];
      const duplicateScreenshots = Array.isArray(duplicateLog.screenshots) ? duplicateLog.screenshots : [];

      // Merge context and screenshots
      const mergedContext = { ...duplicateLog.context, ...keepLog.context };
      const mergedScreenshots = [...keepScreenshots, ...duplicateScreenshots];

      // Update the kept log with merged data including screenshots
      await this.logRepo.updateToOpen(keepId, mergedContext, mergedScreenshots);

      // Delete the duplicate log
      await this.logRepo.deleteById(duplicateLog.id);

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
        const logs = await this.logRepo.findByApplicationId(applicationId);

        for (const log of logs) {
          if (log.state === 'closed' && log.timestamp < cutoffIso) {
            await this.logRepo.deleteById(log.id);
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
        const logs = await this.logRepo.findByApplicationId(applicationId);
        for (const log of logs) {
          // Ensure screenshots is an array before iterating
          if (Array.isArray(log.screenshots)) {
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
    try {
      const pool = this.logRepo.pool;
      const result = await pool.query('SELECT DISTINCT application_id FROM logs');
      return result.rows.map(row => row.application_id);
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
