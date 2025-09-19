import express from 'express';
import config from '../config/index.js';
import fs from 'fs';
import path from 'path';

// Factory function to create routes with injected services
export default function createLogRoutes(logService) {
  const router = express.Router();

// API Key authentication middleware
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey || apiKey !== config.server.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
};

// POST /log - Accept log entries (requires API key)
router.post('/log', authenticateApiKey, async (req, res) => {
  try {
    const result = await logService.createLogEntry(req.body);
    
    if (!result.success) {
      if (result.blocked) {
        return res.status(403).json({
          error: 'Log entry blocked by blacklist',
          reason: result.reason,
          pattern: result.pattern
        });
      }
      return res.status(400).json({ error: 'Failed to create log entry' });
    }
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error creating log entry:', error);
    res.status(500).json({ error: 'Failed to create log entry' });
  }
});

// GET /log/:applicationId - Retrieve all logs for an application (requires API key)
router.get('/log/:applicationId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const result = await logService.getAllLogs(applicationId);
    res.json(result);
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// GET /log/:applicationId/pending - Retrieve pending logs
router.get('/log/:applicationId/pending', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const result = await logService.getLogsByState(applicationId, 'pending');
    res.json(result);
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// GET /log/:applicationId/open - Retrieve open and revert logs
router.get('/log/:applicationId/open', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const result = await logService.getLogsByState(applicationId, 'open');
    res.json(result);
  } catch (error) {
    console.error('Error reading open logs:', error);
    res.status(500).json({ error: 'Failed to read open logs' });
  }
});

// GET /log/:applicationId/done - Retrieve all done items
router.get('/log/:applicationId/done', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const result = await logService.getLogsByState(applicationId, 'done');
    res.json(result);
  } catch (error) {
    console.error('Error reading done logs:', error);
    res.status(500).json({ error: 'Failed to read done logs' });
  }
});

// GET /log/:applicationId/in-progress - Retrieve all in-progress items
router.get('/log/:applicationId/in-progress', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const result = await logService.getLogsByState(applicationId, 'in_progress');
    res.json(result);
  } catch (error) {
    console.error('Error reading in-progress logs:', error);
    res.status(500).json({ error: 'Failed to read in-progress logs' });
  }
});

// PATCH /log/:applicationId/:entryId/revert - Set state to revert
router.patch('/log/:applicationId/:entryId/revert', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const { revertReason } = req.body;
    
    const result = await logService.updateLogState(applicationId, entryId, 'revert', { revertReason });

    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Log entry not found or not in done state' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error updating log entry to revert:', error);
    res.status(500).json({ error: 'Failed to update log entry to revert' });
  }
});



// PATCH /log/:applicationId/:entryId/in-progress - Set state to in_progress
router.patch('/log/:applicationId/:entryId/in-progress', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;

    const result = await logService.updateLogState(applicationId, entryId, 'in_progress');

    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Log entry not found or not in open/revert state' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error updating log entry to in_progress:', error);
    res.status(500).json({ error: 'Failed to update log entry to in_progress' });
  }
});

// POST /log/:applicationId/:entryId - Set entry to open again, add rejectReason to context
router.post('/log/:applicationId/:entryId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const { rejectReason } = req.body;
    
    const result = await logService.updateLogState(applicationId, entryId, 'open', { rejectReason });

    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Log entry not found or already open' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error reopening log entry:', error);
    res.status(500).json({ error: 'Failed to reopen log entry' });
  }
});

// PUT /log/:applicationId/:entryId - Set state to done for one entry, add message from LLM and metadata
router.put('/log/:applicationId/:entryId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const { message, error, git_commit, statistics } = req.body;

    const result = await logService.updateLogState(applicationId, entryId, 'done', {
      message,
      error,
      git_commit,
      statistics
    });
    
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Log entry not found or not in open/in_progress state' });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error updating log entry to done:', error);
    res.status(500).json({ error: 'Failed to update log entry to done' });
  }
});

// DELETE /log/:applicationId - Delete all items from the application
router.delete('/log/:applicationId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const result = await logService.deleteAllLogs(applicationId);
    res.json(result);
  } catch (error) {
    console.error('Error deleting all logs:', error);
    res.status(500).json({ error: 'Failed to delete logs' });
  }
});

// DELETE /log/:applicationId/closed - Remove all closed items from the application
router.delete('/log/:applicationId/closed', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const result = await logService.deleteClosedLogs(applicationId);
    res.json(result);
  } catch (error) {
    console.error('Error clearing closed logs:', error);
    res.status(500).json({ error: 'Failed to clear closed logs' });
  }
});

// DELETE /log/:applicationId/:entryId - Set state to closed for entry
router.delete('/log/:applicationId/:entryId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;

    const result = await logService.updateLogState(applicationId, entryId, 'closed');
    
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Log entry not found or already closed' });
    }
    
    res.json({ 
      success: true, 
      message: `Log entry ${entryId} set to closed for ${applicationId}` 
    });
  } catch (error) {
    console.error('Error closing log entry:', error);
    res.status(500).json({ error: 'Failed to close log entry' });
  }
});

// GET /log/:applicationId/img/:filename - Serve images
router.get('/log/:applicationId/img/:filename', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, filename } = req.params;
    
    const imgPath = await logService.getImage(applicationId, filename);

    if (!imgPath) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Set content type based on file extension
    const ext = path.extname(filename).substring(1).toLowerCase();
    const mimeTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      tiff: 'image/tiff',
      ico: 'image/x-icon'
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    fs.createReadStream(imgPath).pipe(res);
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// GET /log/:applicationId/statistics - Get statistics for application
router.get('/log/:applicationId/statistics', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const stats = await logService.getStatistics(applicationId);
    res.json({ applicationId, statistics: stats });
  } catch (error) {
    console.error('Error getting statistics:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// AI-powered endpoints (if Gemini is available)

// POST /log/:applicationId/:entryId/analyze - Analyze log entry with AI
router.post('/log/:applicationId/:entryId/analyze', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const analysis = await logService.analyzeLog(applicationId, entryId);
    res.json({ analysis });
  } catch (error) {
    console.error('Error analyzing log:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /log/:applicationId/:entryId/suggest - Get AI solution suggestions
router.post('/log/:applicationId/:entryId/suggest', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const suggestion = await logService.suggestSolution(applicationId, entryId);
    res.json({ suggestion });
  } catch (error) {
    console.error('Error suggesting solution:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /log/:applicationId/summary - Generate AI summary of logs
router.post('/log/:applicationId/summary', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const summary = await logService.generateSummary(applicationId);
    res.json({ summary });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /log/:applicationId/:entryId/plan - Set implementation plan for an issue
router.patch('/log/:applicationId/:entryId/plan', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const { plan } = req.body;

    if (!plan) {
      return res.status(400).json({ error: 'Plan is required' });
    }

    const result = await logService.updatePlan(applicationId, entryId, plan);

    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Log entry not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error updating plan:', error);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// PATCH /log/:applicationId/:entryId/issue-fields - Update issue-specific fields
router.patch('/log/:applicationId/:entryId/issue-fields', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const { plan, type, effort, llmOutput } = req.body;

    const fields = {};
    if (plan !== undefined) fields.plan = plan;
    if (type !== undefined) fields.type = type;
    if (effort !== undefined) fields.effort = effort;
    if (llmOutput !== undefined) fields.llmOutput = llmOutput;

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'At least one field (plan, type, effort, llmOutput) is required' });
    }

    const result = await logService.updateIssueFields(applicationId, entryId, fields);

    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Log entry not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error updating issue fields:', error);
    res.status(500).json({ error: 'Failed to update issue fields' });
  }
});

  return router;
}
