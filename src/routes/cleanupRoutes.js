import express from 'express';
import config from '../config/index.js';

// Factory function to create routes with injected services
export default function createCleanupRoutes(cleanupService) {
  const router = express.Router();

// API Key authentication middleware
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey || apiKey !== config.server.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
};

// GET /cleanup/status - Get cleanup service status and statistics
router.get('/cleanup/status', authenticateApiKey, async (req, res) => {
  try {
    const stats = cleanupService.getStats();
    res.json({
      enabled: config.cleanup.enabled,
      isRunning: cleanupService.isRunning,
      schedule: config.cleanup.interval,
      statistics: stats
    });
  } catch (error) {
    console.error('Error getting cleanup status:', error);
    res.status(500).json({ error: 'Failed to get cleanup status' });
  }
});

// POST /cleanup/run - Force run cleanup process
router.post('/cleanup/run', authenticateApiKey, async (req, res) => {
  try {
    if (cleanupService.isRunning) {
      return res.status(409).json({ error: 'Cleanup is already running' });
    }

    // Run cleanup in background
    cleanupService.forceCleanup().catch(error => {
      console.error('Background cleanup failed:', error);
    });
    
    res.json({ 
      success: true, 
      message: 'Cleanup process started in background' 
    });
  } catch (error) {
    console.error('Error starting cleanup:', error);
    res.status(500).json({ error: 'Failed to start cleanup process' });
  }
});

// GET /cleanup/config - Get cleanup configuration
router.get('/cleanup/config', authenticateApiKey, async (req, res) => {
  try {
    res.json({
      enabled: config.cleanup.enabled,
      interval: config.cleanup.interval,
      duplicateThreshold: config.cleanup.duplicateThreshold,
      maxAge: config.cleanup.maxAge,
      batchSize: config.cleanup.batchSize
    });
  } catch (error) {
    console.error('Error getting cleanup config:', error);
    res.status(500).json({ error: 'Failed to get cleanup configuration' });
  }
});

  return router;
}
