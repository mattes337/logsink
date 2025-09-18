import express from 'express';
import config from '../config/index.js';

const createEmbeddingRoutes = (logService, backgroundProcessor) => {
  const router = express.Router();

// API Key authentication middleware
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey || apiKey !== config.server.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
};

  // GET /embedding/similar/:applicationId/:entryId - Find similar logs
  router.get('/embedding/similar/:applicationId/:entryId', authenticateApiKey, async (req, res) => {
    try {
      const { applicationId, entryId } = req.params;
      const limit = parseInt(req.query.limit) || 10;

      const similarLogs = await logService.findSimilarLogs(applicationId, entryId, limit);
      
      res.json({
        success: true,
        applicationId,
        entryId,
        similarLogs,
        count: similarLogs.length
      });
    } catch (error) {
      console.error('Error finding similar logs:', error);
      res.status(500).json({ 
        error: 'Failed to find similar logs',
        details: error.message 
      });
    }
  });

  // POST /embedding/search/:applicationId - Search logs by text
  router.post('/embedding/search/:applicationId', authenticateApiKey, async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { text, limit = 10 } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Search text is required' });
      }

      const results = await logService.searchByText(applicationId, text, limit);
      
      res.json({
        success: true,
        applicationId,
        searchText: text,
        results,
        count: results.length
      });
    } catch (error) {
      console.error('Error searching logs by text:', error);
      res.status(500).json({ 
        error: 'Failed to search logs',
        details: error.message 
      });
    }
  });

  // GET /embedding/status - Get background processor status
  router.get('/embedding/status', authenticateApiKey, async (req, res) => {
    try {
      const stats = backgroundProcessor.getStats();
      
      res.json({
        success: true,
        ...stats
      });
    } catch (error) {
      console.error('Error getting embedding status:', error);
      res.status(500).json({ 
        error: 'Failed to get embedding status',
        details: error.message 
      });
    }
  });

  // POST /embedding/process - Force process pending embeddings
  router.post('/embedding/process', authenticateApiKey, async (req, res) => {
    try {
      if (backgroundProcessor.isRunning) {
        return res.status(409).json({ error: 'Background processing is already running' });
      }

      // Run processing in background
      backgroundProcessor.forceProcessing().catch(error => {
        console.error('Background processing failed:', error);
      });
      
      res.json({ 
        success: true, 
        message: 'Background processing started' 
      });
    } catch (error) {
      console.error('Error starting background processing:', error);
      res.status(500).json({ 
        error: 'Failed to start background processing',
        details: error.message 
      });
    }
  });

  // POST /embedding/process/:logId - Process specific log
  router.post('/embedding/process/:logId', authenticateApiKey, async (req, res) => {
    try {
      const { logId } = req.params;

      const result = await backgroundProcessor.processLogById(logId);
      
      res.json({
        success: true,
        logId,
        ...result
      });
    } catch (error) {
      console.error('Error processing specific log:', error);
      res.status(500).json({ 
        error: 'Failed to process log',
        details: error.message 
      });
    }
  });

  // GET /embedding/pending - Get pending logs count
  router.get('/embedding/pending', authenticateApiKey, async (req, res) => {
    try {
      const pendingLogs = await backgroundProcessor.embeddingService.getPendingEmbeddings(1000);
      
      res.json({
        success: true,
        pendingCount: pendingLogs.length,
        pendingLogs: pendingLogs.slice(0, 50) // Return first 50 for preview
      });
    } catch (error) {
      console.error('Error getting pending logs:', error);
      res.status(500).json({ 
        error: 'Failed to get pending logs',
        details: error.message 
      });
    }
  });

  return router;
};

export default createEmbeddingRoutes;
