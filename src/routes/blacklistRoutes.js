import express from 'express';
import config from '../config/index.js';

// Factory function to create routes with injected services
export default function createBlacklistRoutes(blacklistService) {
  const router = express.Router();

// API Key authentication middleware
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey || apiKey !== config.server.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
};

// GET /blacklist - Get all blacklist patterns
router.get('/blacklist', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.query;
    const patterns = await blacklistService.getPatterns(applicationId);
    res.json({
      patterns,
      total: patterns.length
    });
  } catch (error) {
    console.error('Error getting blacklist patterns:', error);
    res.status(500).json({ error: 'Failed to get blacklist patterns' });
  }
});

// POST /blacklist - Add a new blacklist pattern
router.post('/blacklist', authenticateApiKey, async (req, res) => {
  try {
    const { pattern, patternType = 'substring', applicationId = null, reason = null } = req.body;

    if (!pattern) {
      return res.status(400).json({ error: 'Pattern is required' });
    }

    const validTypes = ['exact', 'substring', 'regex'];
    if (!validTypes.includes(patternType)) {
      return res.status(400).json({
        error: `Invalid pattern type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const entry = await blacklistService.addPattern(pattern, patternType, applicationId, reason);
    res.status(201).json({
      success: true,
      entry
    });
  } catch (error) {
    console.error('Error adding blacklist pattern:', error);
    if (error.message.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to add blacklist pattern' });
    }
  }
});

// PUT /blacklist/:id - Update a blacklist pattern
router.put('/blacklist/:id', authenticateApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { pattern, patternType, applicationId, reason } = req.body;
    
    if (!pattern) {
      return res.status(400).json({ error: 'Pattern is required' });
    }
    
    const validTypes = ['exact', 'substring', 'regex'];
    if (patternType && !validTypes.includes(patternType)) {
      return res.status(400).json({ 
        error: `Invalid pattern type. Must be one of: ${validTypes.join(', ')}` 
      });
    }
    
    const success = await blacklistService.updatePattern(parseInt(id), {
      pattern,
      patternType,
      applicationId,
      reason
    });

    if (!success) {
      return res.status(404).json({ error: 'Blacklist pattern not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating blacklist pattern:', error);
    if (error.message.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update blacklist pattern' });
    }
  }
});

// DELETE /blacklist/:id - Remove a blacklist pattern
router.delete('/blacklist/:id', authenticateApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const success = await blacklistService.removePattern(parseInt(id));
    
    if (!success) {
      return res.status(404).json({ error: 'Blacklist pattern not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing blacklist pattern:', error);
    res.status(500).json({ error: 'Failed to remove blacklist pattern' });
  }
});

// DELETE /blacklist - Clear all blacklist patterns
router.delete('/blacklist', authenticateApiKey, async (req, res) => {
  try {
    const removedCount = await blacklistService.clearAll();
    res.json({
      success: true,
      message: `Removed ${removedCount} blacklist patterns`
    });
  } catch (error) {
    console.error('Error clearing blacklist:', error);
    res.status(500).json({ error: 'Failed to clear blacklist' });
  }
});

// POST /blacklist/test - Test if a message would be blacklisted
router.post('/blacklist/test', authenticateApiKey, async (req, res) => {
  try {
    const { message, applicationId = null } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const result = await blacklistService.isBlacklisted(message, applicationId);
    res.json(result);
  } catch (error) {
    console.error('Error testing blacklist:', error);
    res.status(500).json({ error: 'Failed to test blacklist' });
  }
});

// GET /blacklist/statistics - Get blacklist statistics
router.get('/blacklist/statistics', authenticateApiKey, async (req, res) => {
  try {
    const stats = await blacklistService.getStatistics();
    res.json(stats);
  } catch (error) {
    console.error('Error getting blacklist statistics:', error);
    res.status(500).json({ error: 'Failed to get blacklist statistics' });
  }
});

// POST /blacklist/refresh - Force refresh blacklist cache
router.post('/blacklist/refresh', authenticateApiKey, async (req, res) => {
  try {
    await blacklistService.refreshCache();
    res.json({ success: true, message: 'Blacklist cache refreshed' });
  } catch (error) {
    console.error('Error refreshing blacklist cache:', error);
    res.status(500).json({ error: 'Failed to refresh blacklist cache' });
  }
});

  return router;
}
