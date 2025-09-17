import BlacklistRepository from '../repositories/BlacklistRepository.js';
import LogRepository from '../repositories/LogRepository.js';
import config from '../config/index.js';

class BlacklistService {
  constructor() {
    this.blacklistRepo = new BlacklistRepository();
    this.logRepo = new LogRepository();
    this.cache = new Map();
    this.cacheTimeout = config.blacklist.cacheTimeout;
    this.lastCacheUpdate = 0;
  }

  initialize() {
    this.blacklistRepo.initialize();
    this.logRepo.initialize();
    this.refreshCache();
  }

  async refreshCache() {
    try {
      const blacklistEntries = this.blacklistRepo.findAll();
      this.cache.clear();
      
      // Group by application ID for faster lookups
      for (const entry of blacklistEntries) {
        const key = entry.applicationId || 'global';
        if (!this.cache.has(key)) {
          this.cache.set(key, []);
        }
        this.cache.get(key).push(entry);
      }
      
      this.lastCacheUpdate = Date.now();
      console.log(`Blacklist cache refreshed with ${blacklistEntries.length} entries`);
    } catch (error) {
      console.error('Failed to refresh blacklist cache:', error);
      throw error;
    }
  }

  async ensureCacheValid() {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.cacheTimeout) {
      await this.refreshCache();
    }
  }

  async isBlacklisted(message, applicationId = null) {
    if (!config.blacklist.enabled) {
      return { isBlacklisted: false };
    }

    try {
      await this.ensureCacheValid();
      
      // Check global blacklist first
      const globalEntries = this.cache.get('global') || [];
      for (const entry of globalEntries) {
        if (this.matchesPattern(message, entry.pattern, entry.patternType)) {
          return {
            isBlacklisted: true,
            matchedPattern: entry.pattern,
            patternType: entry.patternType,
            reason: entry.reason,
            entryId: entry.id,
            scope: 'global'
          };
        }
      }
      
      // Check application-specific blacklist
      if (applicationId) {
        const appEntries = this.cache.get(applicationId) || [];
        for (const entry of appEntries) {
          if (this.matchesPattern(message, entry.pattern, entry.patternType)) {
            return {
              isBlacklisted: true,
              matchedPattern: entry.pattern,
              patternType: entry.patternType,
              reason: entry.reason,
              entryId: entry.id,
              scope: 'application'
            };
          }
        }
      }
      
      return { isBlacklisted: false };
    } catch (error) {
      console.error('Error checking blacklist:', error);
      // In case of error, allow the message through
      return { isBlacklisted: false, error: error.message };
    }
  }

  matchesPattern(message, pattern, patternType) {
    try {
      switch (patternType) {
        case 'exact':
          return message === pattern;
        
        case 'substring':
          return message.toLowerCase().includes(pattern.toLowerCase());
        
        case 'regex':
          const regex = new RegExp(pattern, 'i');
          return regex.test(message);
        
        default:
          console.warn(`Unknown pattern type: ${patternType}, falling back to substring`);
          return message.toLowerCase().includes(pattern.toLowerCase());
      }
    } catch (error) {
      console.error(`Error matching pattern "${pattern}" of type "${patternType}":`, error);
      return false;
    }
  }

  async addPattern(pattern, patternType = 'substring', applicationId = null, reason = null) {
    try {
      const entry = await this.blacklistRepo.create({
        pattern,
        patternType,
        applicationId,
        reason
      });
      
      // Refresh cache to include new pattern
      await this.refreshCache();
      
      // If auto-delete is enabled, remove existing logs that match this pattern
      if (config.blacklist.autoDelete) {
        await this.removeMatchingLogs(pattern, patternType, applicationId);
      }
      
      return entry;
    } catch (error) {
      console.error('Failed to add blacklist pattern:', error);
      throw error;
    }
  }

  async removePattern(id) {
    try {
      const success = this.blacklistRepo.deleteById(id);
      if (success) {
        await this.refreshCache();
      }
      return success;
    } catch (error) {
      console.error('Failed to remove blacklist pattern:', error);
      throw error;
    }
  }

  async updatePattern(id, updates) {
    try {
      const success = this.blacklistRepo.update(id, updates);
      if (success) {
        await this.refreshCache();
        
        // If auto-delete is enabled and pattern changed, remove matching logs
        if (config.blacklist.autoDelete && (updates.pattern || updates.patternType)) {
          const entry = this.blacklistRepo.findById(id);
          if (entry) {
            await this.removeMatchingLogs(
              entry.pattern, 
              entry.patternType, 
              entry.applicationId
            );
          }
        }
      }
      return success;
    } catch (error) {
      console.error('Failed to update blacklist pattern:', error);
      throw error;
    }
  }

  async getPatterns(applicationId = null) {
    try {
      if (applicationId) {
        return this.blacklistRepo.findByApplicationId(applicationId);
      } else {
        return this.blacklistRepo.findAll();
      }
    } catch (error) {
      console.error('Failed to get blacklist patterns:', error);
      throw error;
    }
  }

  async removeMatchingLogs(pattern, patternType, applicationId = null) {
    try {
      let removedCount = 0;
      
      if (applicationId) {
        // Remove from specific application
        const logs = this.logRepo.findByApplicationId(applicationId);
        for (const log of logs) {
          if (this.matchesPattern(log.message, pattern, patternType)) {
            this.logRepo.deleteById(log.id);
            removedCount++;
          }
        }
      } else {
        // This would require a more complex query to get all logs
        // For now, we'll skip global removal to avoid performance issues
        console.warn('Global log removal not implemented for performance reasons');
      }
      
      console.log(`Removed ${removedCount} logs matching blacklist pattern: ${pattern}`);
      return removedCount;
    } catch (error) {
      console.error('Failed to remove matching logs:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const totalPatterns = this.blacklistRepo.count();
      const patterns = this.blacklistRepo.findAll();
      
      const stats = {
        totalPatterns,
        byType: {},
        byApplication: {},
        global: 0
      };
      
      for (const pattern of patterns) {
        // Count by type
        stats.byType[pattern.patternType] = (stats.byType[pattern.patternType] || 0) + 1;
        
        // Count by application
        if (pattern.applicationId) {
          stats.byApplication[pattern.applicationId] = 
            (stats.byApplication[pattern.applicationId] || 0) + 1;
        } else {
          stats.global++;
        }
      }
      
      return stats;
    } catch (error) {
      console.error('Failed to get blacklist statistics:', error);
      throw error;
    }
  }

  async clearAll() {
    try {
      const removedCount = this.blacklistRepo.deleteAll();
      await this.refreshCache();
      return removedCount;
    } catch (error) {
      console.error('Failed to clear all blacklist patterns:', error);
      throw error;
    }
  }
}

export default BlacklistService;
