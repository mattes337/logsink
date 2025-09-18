import { v4 as uuidv4 } from 'uuid';
import LogRepository from '../repositories/LogRepository.js';
import BlacklistService from './BlacklistService.js';
import GeminiService from './GeminiService.js';
import EmbeddingService from './EmbeddingService.js';
import config from '../config/index.js';
import fs from 'fs';
import path from 'path';

class LogService {
  constructor(blacklistService = null, geminiService = null, embeddingService = null) {
    this.logRepo = new LogRepository();
    this.blacklistService = blacklistService || new BlacklistService();
    this.geminiService = geminiService || new GeminiService();
    this.embeddingService = embeddingService || new EmbeddingService();
  }

  initialize() {
    this.logRepo.initialize();
    if (!this.blacklistService.initialized) {
      this.blacklistService.initialize();
    }
    if (!this.geminiService.initialized) {
      this.geminiService.initialize();
    }
    if (!this.embeddingService.isInitialized) {
      this.embeddingService.initialize();
    }

    // Ensure images directory exists
    if (!fs.existsSync(config.storage.imagesDir)) {
      fs.mkdirSync(config.storage.imagesDir, { recursive: true });
    }
  }

  async createLogEntry(logData) {
    const { applicationId, timestamp, message, context } = logData;
    
    if (!applicationId || !message) {
      throw new Error('applicationId and message are required');
    }

    // Check blacklist first
    const blacklistResult = await this.blacklistService.isBlacklisted(message, applicationId);
    if (blacklistResult.isBlacklisted) {
      console.log(`Log entry blocked by blacklist: ${blacklistResult.matchedPattern}`);
      return {
        success: false,
        blocked: true,
        reason: blacklistResult.reason,
        pattern: blacklistResult.matchedPattern
      };
    }

    const entryId = uuidv4();
    let processedContext = context || {};
    const screenshots = [];

    // Process screenshots in context
    processedContext = this.processScreenshots(processedContext, screenshots, applicationId, entryId);

    // Check for existing duplicate
    const existingEntry = await this.logRepo.findDuplicateCandidate(
      applicationId,
      message,
      processedContext
    );

    let resultEntry;
    let deduplicated = false;

    if (existingEntry && existingEntry.state === 'done') {
      // Reopen existing entry
      const mergedContext = { ...existingEntry.context, ...processedContext };
      const existingScreenshots = Array.isArray(existingEntry.screenshots) ? existingEntry.screenshots : [];
      const mergedScreenshots = [...existingScreenshots, ...screenshots];

      await this.logRepo.reopenExisting(
        existingEntry.id,
        timestamp || new Date().toISOString(),
        mergedContext,
        mergedScreenshots
      );

      resultEntry = await this.logRepo.findById(existingEntry.id);
      deduplicated = true;
    } else {
      // Create new entry
      // Use 'pending' state if embeddings are enabled, otherwise 'open'
      const initialState = config.embedding.enabled ? 'pending' : 'open';

      const logEntry = {
        id: entryId,
        applicationId,
        timestamp: timestamp || new Date().toISOString(),
        message,
        context: processedContext,
        screenshots,
        state: initialState,
        reopenCount: 0
      };

      resultEntry = await this.logRepo.create(logEntry);
    }

    return {
      success: true,
      logged: resultEntry,
      deduplicated,
      action: deduplicated ? 'reopened_existing' : 'created_new'
    };
  }

  processScreenshots(context, screenshots, applicationId, entryId) {
    return this.replaceScreenshots(context, screenshots, applicationId, entryId);
  }

  replaceScreenshots(obj, screenshots = [], applicationId, entryId) {
    if (Array.isArray(obj)) {
      return obj.map(item => this.replaceScreenshots(item, screenshots, applicationId, entryId));
    } else if (obj && typeof obj === 'object') {
      const newObj = {};
      for (const key of Object.keys(obj)) {
        if (
          typeof obj[key] === 'string' &&
          obj[key].startsWith('data:image/')
        ) {
          const match = obj[key].match(/^data:image\/(\w+);base64,(.+)$/);
          if (match) {
            const ext = match[1];
            const base64Data = match[2];
            
            // Validate image size
            const imageSize = (base64Data.length * 3) / 4;
            if (imageSize > config.storage.maxImageSize) {
              console.warn(`Image too large (${imageSize} bytes), skipping`);
              newObj[key] = '[Image too large]';
              continue;
            }
            
            // Validate image type
            if (!config.storage.allowedImageTypes.includes(ext.toLowerCase())) {
              console.warn(`Image type ${ext} not allowed, skipping`);
              newObj[key] = '[Image type not allowed]';
              continue;
            }
            
            const imgFilename = `${applicationId}-img-${entryId}-${screenshots.length + 1}.${ext}`;
            const imgPath = path.join(config.storage.imagesDir, imgFilename);
            
            try {
              fs.writeFileSync(imgPath, Buffer.from(base64Data, 'base64'));
              screenshots.push(imgFilename);
              newObj[key] = imgFilename;
            } catch (error) {
              console.error(`Failed to save image ${imgFilename}:`, error);
              newObj[key] = '[Image save failed]';
            }
            continue;
          }
        }
        newObj[key] = this.replaceScreenshots(obj[key], screenshots, applicationId, entryId);
      }
      return newObj;
    }
    return obj;
  }

  async getAllLogs(applicationId) {
    try {
      const logs = await this.logRepo.findByApplicationId(applicationId);
      return {
        applicationId,
        totalLogs: logs.length,
        logs
      };
    } catch (error) {
      throw new Error(`Failed to get logs: ${error.message}`);
    }
  }

  async getLogsByState(applicationId, state) {
    try {
      let logs;

      if (state === 'open') {
        logs = await this.logRepo.findOpenAndRevert(applicationId);
      } else {
        logs = await this.logRepo.findByState(applicationId, state);
      }

      return {
        applicationId,
        totalLogs: logs.length,
        logs
      };
    } catch (error) {
      throw new Error(`Failed to get logs by state: ${error.message}`);
    }
  }

  async updateLogState(applicationId, entryId, newState, metadata = {}) {
    try {
      const log = await this.logRepo.findById(entryId);
      if (!log || log.applicationId !== applicationId) {
        return { success: false, error: 'Log entry not found' };
      }

      let success = false;
      let updatedEntry = null;

      switch (newState) {
        case 'in_progress':
          if (log.state === 'open' || log.state === 'revert') {
            success = await this.logRepo.updateToInProgress(entryId);
          }
          break;

        case 'done':
          if (log.state === 'open' || log.state === 'in_progress') {
            success = await this.logRepo.updateToDone(
              entryId,
              metadata.message || metadata.error || '',
              metadata.git_commit || null,
              metadata.statistics || null
            );
          }
          break;

        case 'revert':
          if (log.state === 'done') {
            success = await this.logRepo.updateToRevert(entryId, metadata.revertReason || null);
          }
          break;

        case 'open':
          if (log.state !== 'open') {
            const newContext = { ...log.context, rejectReason: metadata.rejectReason };
            success = await this.logRepo.updateToOpen(entryId, newContext);
          }
          break;

        case 'closed':
          if (log.state !== 'closed') {
            // Delete associated screenshots
            if (Array.isArray(log.screenshots)) {
              this.deleteScreenshots(log.screenshots);
            }
            success = await this.logRepo.updateState(entryId, 'closed');
          }
          break;

        default:
          return { success: false, error: 'Invalid state' };
      }

      if (success) {
        updatedEntry = await this.logRepo.findById(entryId);
      }

      return { 
        success, 
        entryId, 
        state: newState,
        entry: updatedEntry
      };
    } catch (error) {
      throw new Error(`Failed to update log state: ${error.message}`);
    }
  }

  async deleteLog(applicationId, entryId) {
    try {
      const log = await this.logRepo.findById(entryId);
      if (!log || log.applicationId !== applicationId) {
        return { success: false, error: 'Log entry not found' };
      }

      // Delete associated screenshots
      if (Array.isArray(log.screenshots)) {
        this.deleteScreenshots(log.screenshots);
      }

      const success = await this.logRepo.deleteById(entryId);
      return {
        success,
        message: `Log entry ${entryId} deleted for ${applicationId}`
      };
    } catch (error) {
      throw new Error(`Failed to delete log: ${error.message}`);
    }
  }

  async deleteAllLogs(applicationId) {
    try {
      // Get all logs to delete screenshots
      const logs = await this.logRepo.findByApplicationId(applicationId);

      // Delete all screenshots
      for (const log of logs) {
        if (Array.isArray(log.screenshots)) {
          this.deleteScreenshots(log.screenshots);
        }
      }

      const removedCount = await this.logRepo.deleteByApplicationId(applicationId);
      return { 
        success: true, 
        message: `Deleted all ${removedCount} items for ${applicationId}` 
      };
    } catch (error) {
      throw new Error(`Failed to delete all logs: ${error.message}`);
    }
  }

  async deleteClosedLogs(applicationId) {
    try {
      // Get closed logs to delete screenshots
      const closedLogs = await this.logRepo.findByState(applicationId, 'closed');

      // Delete screenshots
      for (const log of closedLogs) {
        if (Array.isArray(log.screenshots)) {
          this.deleteScreenshots(log.screenshots);
        }
      }

      const removedCount = await this.logRepo.deleteClosedLogs(applicationId);
      return {
        success: true,
        message: `Removed ${removedCount} closed items for ${applicationId}`
      };
    } catch (error) {
      throw new Error(`Failed to delete closed logs: ${error.message}`);
    }
  }

  deleteScreenshots(screenshots) {
    if (!Array.isArray(screenshots)) {
      console.warn('deleteScreenshots called with non-array:', screenshots);
      return;
    }

    for (const imgFilename of screenshots) {
      const imgPath = path.join(config.storage.imagesDir, imgFilename);
      if (fs.existsSync(imgPath)) {
        try {
          fs.unlinkSync(imgPath);
        } catch (err) {
          console.error(`Failed to delete image ${imgFilename}:`, err);
        }
      }
    }
  }

  async getImage(applicationId, filename) {
    try {
      const imgPath = path.join(config.storage.imagesDir, filename);
      
      if (!fs.existsSync(imgPath)) {
        return null;
      }

      // Verify the image belongs to the application
      if (!filename.startsWith(`${applicationId}-img-`)) {
        return null;
      }

      return imgPath;
    } catch (error) {
      throw new Error(`Failed to get image: ${error.message}`);
    }
  }

  async getStatistics(applicationId) {
    try {
      return await this.logRepo.getStatistics(applicationId);
    } catch (error) {
      throw new Error(`Failed to get statistics: ${error.message}`);
    }
  }

  // AI-powered features
  async analyzeLog(applicationId, entryId) {
    if (!this.geminiService.isAvailable()) {
      throw new Error('AI analysis not available');
    }

    try {
      const log = await this.logRepo.findById(entryId);
      if (!log || log.applicationId !== applicationId) {
        throw new Error('Log entry not found');
      }

      return await this.geminiService.analyzeLogEntry(log);
    } catch (error) {
      throw new Error(`Failed to analyze log: ${error.message}`);
    }
  }

  async suggestSolution(applicationId, entryId) {
    if (!this.geminiService.isAvailable()) {
      throw new Error('AI suggestions not available');
    }

    try {
      const log = await this.logRepo.findById(entryId);
      if (!log || log.applicationId !== applicationId) {
        throw new Error('Log entry not found');
      }

      return await this.geminiService.suggestSolution(log);
    } catch (error) {
      throw new Error(`Failed to suggest solution: ${error.message}`);
    }
  }

  async generateSummary(applicationId) {
    if (!this.geminiService.isAvailable()) {
      throw new Error('AI summary not available');
    }

    try {
      const logs = await this.logRepo.findByApplicationId(applicationId);
      return await this.geminiService.generateLogSummary(logs);
    } catch (error) {
      throw new Error(`Failed to generate summary: ${error.message}`);
    }
  }

  // Embedding-powered features
  async findSimilarLogs(applicationId, entryId, limit = 10) {
    if (!this.embeddingService.isAvailable()) {
      throw new Error('Embedding service not available');
    }

    try {
      const log = await this.logRepo.findById(entryId);
      if (!log || log.applicationId !== applicationId) {
        throw new Error('Log entry not found');
      }

      if (!log.embedding) {
        throw new Error('Log has no embedding - similarity search not available');
      }

      const embedding = JSON.parse(log.embedding);
      return await this.embeddingService.findSimilarLogs(embedding, applicationId, limit);
    } catch (error) {
      throw new Error(`Failed to find similar logs: ${error.message}`);
    }
  }

  async searchByText(applicationId, searchText, limit = 10) {
    if (!this.embeddingService.isAvailable()) {
      throw new Error('Embedding service not available');
    }

    try {
      const embedding = await this.embeddingService.generateEmbedding(searchText);
      return await this.embeddingService.findSimilarLogs(embedding, applicationId, limit, 0.5);
    } catch (error) {
      throw new Error(`Failed to search by text: ${error.message}`);
    }
  }
}

export default LogService;
