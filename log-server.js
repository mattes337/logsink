import express from 'express';
import lockfile from 'proper-lockfile';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 1234;
const LOGS_DIR = path.join(__dirname, 'logs');
const IMAGES_DIR = path.join(__dirname, 'images');

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}
const API_KEY = process.env.API_KEY || 'your-secret-api-key';

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

app.use(express.json());

// CORS for browser requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  next();
});

// API Key authentication middleware
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
};

// Helper function to get log file path
const getLogFilePath = (applicationId) => {
  return path.join(LOGS_DIR, `${applicationId}.log`);
};

// Helper to perform operation with file locking
const withFileLock = async (logFilePath, operation) => {
  // Ensure file exists
  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, '[]');
  }
  
  let release = null;
  try {
    // Acquire lock with retries
    release = await lockfile.lock(logFilePath, { 
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 2000
      },
      stale: 10000 // Consider lock stale after 10 seconds
    });
    
    // Perform the operation
    const result = await operation();
    
    // Release lock
    await release();
    
    return result;
  } catch (error) {
    // Ensure lock is released even if operation fails
    if (release) {
      try {
        await release();
      } catch (releaseError) {
        console.error('Error releasing lock:', releaseError);
      }
    }
    throw error;
  }
};

// Helper to read logs safely with lock
const readLogsWithLock = async (logFilePath) => {
  return withFileLock(logFilePath, async () => {
    const content = fs.readFileSync(logFilePath, 'utf8');
    try {
      const logs = JSON.parse(content);
      return Array.isArray(logs) ? logs : [];
    } catch {
      return [];
    }
  });
};

// Helper to read and write logs in a single transaction
const modifyLogs = async (logFilePath, modifier) => {
  return withFileLock(logFilePath, async () => {
    // Read current logs
    const content = fs.readFileSync(logFilePath, 'utf8');
    let logs;
    try {
      logs = JSON.parse(content);
      logs = Array.isArray(logs) ? logs : [];
    } catch {
      logs = [];
    }
    
    // Modify logs
    const modifiedLogs = await modifier(logs);
    
    // Clean old closed entries (older than 24 hours)
    const now = Date.now();
    const cleanedLogs = modifiedLogs.filter(entry => {
      if (entry.state !== 'closed') return true;
      const ts = new Date(entry.timestamp).getTime();
      return (now - ts) < 24 * 60 * 60 * 1000;
    });
    
    // Write back
    fs.writeFileSync(logFilePath, JSON.stringify(cleanedLogs, null, 2));
    
    return cleanedLogs;
  });
};

// POST /log - Accept log entries (requires API key)
app.post('/log', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, timestamp, message, context } = req.body;
    if (!applicationId || !message) {
      return res.status(400).json({ error: 'applicationId and message are required' });
    }
    
    const entryId = uuidv4();
    let newContext = context || {};
    
    // Hilfsfunktion: rekursiv Screenshots finden und ersetzen
    function replaceScreenshots(obj, screenshots = [], idForScreenshots) {
      if (Array.isArray(obj)) {
        return obj.map(item => replaceScreenshots(item, screenshots, idForScreenshots));
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
              const imgFilename = `${applicationId}-img-${idForScreenshots}-${screenshots.length + 1}.${ext}`;
              const imgPath = path.join(IMAGES_DIR, imgFilename);
              fs.writeFileSync(imgPath, Buffer.from(base64Data, 'base64'));
              screenshots.push(imgFilename);
              newObj[key] = imgFilename;
              continue;
            }
          }
          newObj[key] = replaceScreenshots(obj[key], screenshots, idForScreenshots);
        }
        return newObj;
      }
      return obj;
    }
    
    const logFilePath = getLogFilePath(applicationId);
    
    let resultEntry;
    let deduplicated = false;
    
    await modifyLogs(logFilePath, (logs) => {
      // Create a combined key for the new entry
      const newCombinedMessage = message + (newContext.message || '');
      
      // Check for existing entry with same combined message that is in a "finished" state
      const existingEntry = logs.find(entry => {
        const existingCombinedMessage = entry.message + (entry.context?.message || '');
        return existingCombinedMessage === newCombinedMessage && 
               entry.applicationId === applicationId &&
               (entry.state === 'done' || entry.state === 'closed');
      });
      
      if (existingEntry && existingEntry.state === 'done') {
        // If there's a done entry with same combined message, reopen it
        deduplicated = true;
        
        // Process screenshots with the existing entry's ID
        const screenshots = [];
        const processedContext = replaceScreenshots(newContext, screenshots, existingEntry.id);
        
        // Update the existing entry to reopen it
        logs = logs.map(entry => {
          if (entry.id === existingEntry.id) {
            resultEntry = {
              ...entry,
              state: 'open',
              timestamp: timestamp || new Date().toISOString(),
              context: { ...entry.context, ...processedContext },
              screenshots: [...(entry.screenshots || []), ...screenshots],
              reopenedAt: new Date().toISOString(),
              reopenCount: (entry.reopenCount || 0) + 1
            };
            return resultEntry;
          }
          return entry;
        });
      } else {
        // Create a new entry if no existing done entry found, or if existing entry is still active
        const screenshots = [];
        const processedContext = replaceScreenshots(newContext, screenshots, entryId);
        
        const logEntry = {
          id: entryId,
          applicationId,
          timestamp: timestamp || new Date().toISOString(),
          message,
          context: processedContext,
          screenshots,
          state: 'open',
          reopenCount: 0
        };
        
        logs.push(logEntry);
        resultEntry = logEntry;
      }
      
      return logs;
    });
    
    res.status(200).json({ 
      success: true, 
      logged: resultEntry,
      deduplicated: deduplicated,
      action: deduplicated ? 'reopened_existing' : 'created_new'
    });
  } catch (error) {
    console.error('Error writing log:', error);
    res.status(500).json({ error: 'Failed to write log' });
  }
});

// GET /log/:applicationId - Retrieve all logs for an application (requires API key)
app.get('/log/:applicationId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    const logs = await readLogsWithLock(logFilePath);
    
    res.json({
      applicationId,
      totalLogs: logs.length,
      logs
    });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// GET /log/:applicationId/open - Retrieve only open logs for an application (requires API key)
app.get('/log/:applicationId/open', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    const logs = await readLogsWithLock(logFilePath);
    const openLogs = logs.filter(entry => entry.state === 'open');
    
    res.json({
      applicationId,
      totalLogs: openLogs.length,
      logs: openLogs
    });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// GET /log/:applicationId/done - Retrieve all done items
app.get('/log/:applicationId/done', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    const logs = await readLogsWithLock(logFilePath);
    const doneLogs = logs.filter(entry => entry.state === 'done');
    
    res.json({
      applicationId,
      totalLogs: doneLogs.length,
      logs: doneLogs
    });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// GET /log/:applicationId/in-progress - Retrieve all in-progress items
app.get('/log/:applicationId/in-progress', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    const logs = await readLogsWithLock(logFilePath);
    const inProgressLogs = logs.filter(entry => entry.state === 'in_progress');
    
    res.json({
      applicationId,
      totalLogs: inProgressLogs.length,
      logs: inProgressLogs
    });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// PATCH /log/:applicationId/:entryId/revert - Set state to revert
app.patch('/log/:applicationId/:entryId/revert', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const { revertReason } = req.body;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    let updated = false;
    let updatedEntry = null;
    
    await modifyLogs(logFilePath, (logs) => {
      return logs.map(entry => {
        if (entry.id === entryId && entry.state === 'done') {
          updated = true;
          updatedEntry = {
            ...entry,
            state: 'revert',
            revertedAt: new Date().toISOString(),
            revertReason: revertReason || null
          };
          return updatedEntry;
        }
        return entry;
      });
    });
    
    if (!updated) {
      return res.status(404).json({ error: 'Log entry not found or not in done state' });
    }
    
    res.json({ success: true, entryId, state: 'revert', entry: updatedEntry });
  } catch (error) {
    console.error('Error updating log entry to revert:', error);
    res.status(500).json({ error: 'Failed to update log entry to revert' });
  }
});

// PATCH /log/:applicationId/:entryId/in-progress - Set state to in_progress
app.patch('/log/:applicationId/:entryId/in-progress', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    let updated = false;
    
    await modifyLogs(logFilePath, (logs) => {
      return logs.map(entry => {
        if (entry.id === entryId && (entry.state === 'open' || entry.state === 'revert')) {
          updated = true;
          return { 
            ...entry, 
            state: 'in_progress',
            startedAt: new Date().toISOString()
          };
        }
        return entry;
      });
    });
    
    if (!updated) {
      return res.status(404).json({ error: 'Log entry not found or not in open/revert state' });
    }
    
    res.json({ success: true, entryId, state: 'in_progress' });
  } catch (error) {
    console.error('Error updating log entry to in_progress:', error);
    res.status(500).json({ error: 'Failed to update log entry to in_progress' });
  }
});

// POST /log/:applicationId/:entryId - Set entry to open again, add rejectReason to context
app.post('/log/:applicationId/:entryId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const { rejectReason } = req.body;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    let updated = false;
    
    await modifyLogs(logFilePath, (logs) => {
      return logs.map(entry => {
        if (entry.id === entryId && entry.state !== 'open') {
          updated = true;
          return {
            ...entry,
            state: 'open',
            context: { ...entry.context, rejectReason }
          };
        }
        return entry;
      });
    });
    
    if (!updated) {
      return res.status(404).json({ error: 'Log entry not found or already open' });
    }
    
    res.json({ success: true, entryId });
  } catch (error) {
    console.error('Error reopening log entry:', error);
    res.status(500).json({ error: 'Failed to reopen log entry' });
  }
});

// PUT /log/:applicationId/:entryId - Set state to done for one entry, add message from LLM
app.put('/log/:applicationId/:entryId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const { message, error } = req.body;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    let updated = false;
    
    await modifyLogs(logFilePath, (logs) => {
      return logs.map(entry => {
        if (entry.id === entryId && entry.state === 'open') {
          updated = true;
          return { ...entry, state: 'done', llmMessage: message || error || '' };
        }
        return entry;
      });
    });
    
    if (!updated) {
      return res.status(404).json({ error: 'Log entry not found or not open' });
    }
    
    res.json({ success: true, entryId });
  } catch (error) {
    console.error('Error updating log entry:', error);
    res.status(500).json({ error: 'Failed to update log entry' });
  }
});

// DELETE /log/:applicationId - Remove all closed items from the file
app.delete('/log/:applicationId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    let removedCount = 0;
    
    await modifyLogs(logFilePath, (logs) => {
      const initialLength = logs.length;
      const filtered = logs.filter(entry => entry.state !== 'closed');
      removedCount = initialLength - filtered.length;
      return filtered;
    });
    
    res.json({ success: true, message: `Removed ${removedCount} closed items for ${applicationId}` });
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// DELETE /log/:applicationId/:entryId - Set state to closed for entry
app.delete('/log/:applicationId/:entryId', authenticateApiKey, async (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const logFilePath = getLogFilePath(applicationId);
    
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    
    let found = false;
    
    await modifyLogs(logFilePath, (logs) => {
      return logs.map(entry => {
        if (entry.id === entryId && entry.state !== 'closed') {
          found = true;
          
          // Delete all associated screenshots
          if (Array.isArray(entry.screenshots)) {
            for (const imgFilename of entry.screenshots) {
              const imgPath = path.join(IMAGES_DIR, imgFilename);
              if (fs.existsSync(imgPath)) {
                try {
                  fs.unlinkSync(imgPath);
                } catch (err) {
                  console.error(`Failed to delete image ${imgFilename}:`, err);
                }
              }
            }
          }
          
          return { ...entry, state: 'closed' };
        }
        return entry;
      });
    });
    
    if (!found) {
      return res.status(404).json({ error: 'Log entry not found or already closed' });
    }
    
    res.json({ success: true, message: `Log entry ${entryId} set to closed for ${applicationId}` });
  } catch (error) {
    console.error('Error closing log entry:', error);
    res.status(500).json({ error: 'Failed to close log entry' });
  }
});

// Endpoint zum Ausliefern von Bildern
app.get('/log/:applicationId/img/:filename', authenticateApiKey, (req, res) => {
  const { filename } = req.params;
  const imgPath = path.join(IMAGES_DIR, filename);
  
  if (!fs.existsSync(imgPath)) {
    return res.status(404).json({ error: 'Image not found' });
  }
  
  // Content-Type anhand der Dateiendung setzen
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
});

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Log server running on http://localhost:${PORT}`);
  console.log(`📁 Logs stored in: ${LOGS_DIR}`);
  console.log(`🖼️ Images stored in: ${IMAGES_DIR}`);
  console.log(`🔐 API Key: ${API_KEY.substring(0, 4)}...`);
  console.log(`
Available endpoints:
  POST   /log                                    - Send log entries (requires API key)
  GET    /log/:applicationId                     - Retrieve all logs (requires API key)
  GET    /log/:applicationId/open                - Retrieve open and revert logs (requires API key)
  GET    /log/:applicationId/in-progress         - Retrieve in-progress logs (requires API key)
  GET    /log/:applicationId/done                - Retrieve done logs (requires API key)
  GET    /log/:applicationId/img/:filename       - Retrieve stored images (requires API key)
  PATCH  /log/:applicationId/:entryId/revert     - Set log entry to revert (requires API key)
  PATCH  /log/:applicationId/:entryId/in-progress - Set log entry to in_progress (requires API key)
  POST   /log/:applicationId/:entryId            - Reject the implementation (requires API key)
  PUT    /log/:applicationId/:entryId            - Mark log entry as done with metadata (requires API key)
  DELETE /log/:applicationId                     - Remove all closed items (requires API key)
  DELETE /log/:applicationId/:entryId            - Set log entry to closed (requires API key)
  GET    /health                                  - Health check (no auth)

Authentication:
  Include API key in header: X-API-Key: ${API_KEY}
  Or as Bearer token: Authorization: Bearer ${API_KEY}
  
State workflow:
  open -> in_progress -> done -> revert -> in_progress -> done
                      -> closed
  `);
});