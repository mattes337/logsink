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

// Helper to read logs safely
const readLogs = (logFilePath) => {
  if (!fs.existsSync(logFilePath)) return [];
  return lockfile.lock(logFilePath, { retries: 3 })
    .then(release => {
      const logs = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
      return release().then(() => Array.isArray(logs) ? logs : []);
    })
    .catch(() => []);
};

// Helper to write logs safely
const writeLogs = (logFilePath, logs) => {
  const now = Date.now();
  const cleanedLogs = logs.filter(entry => {
    if (entry.state !== 'closed') return true;
    const ts = new Date(entry.timestamp).getTime();
    return (now - ts) < 24 * 60 * 60 * 1000;
  });
  return lockfile.lock(logFilePath, { retries: 3 })
    .then(release => {
      fs.writeFileSync(logFilePath, JSON.stringify(cleanedLogs, null, 2));
      return release();
    });
};

// POST /log - Accept log entries (requires API key)
app.post('/log', authenticateApiKey, (req, res) => {
  const { applicationId, timestamp, message, context } = req.body;
  if (!applicationId || !message) {
    return res.status(400).json({ error: 'applicationId and message are required' });
  }
  const entryId = uuidv4();
  let newContext = context || {};
  // Hilfsfunktion: rekursiv Screenshots finden und ersetzen
  function replaceScreenshots(obj, screenshots = []) {
    if (Array.isArray(obj)) {
      return obj.map(item => replaceScreenshots(item, screenshots));
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
            const imgFilename = `${applicationId}-img-${entryId}-${screenshots.length + 1}.` + ext;
            const imgPath = path.join(IMAGES_DIR, imgFilename);
            fs.writeFileSync(imgPath, Buffer.from(base64Data, 'base64'));
            screenshots.push(imgFilename);
            newObj[key] = imgFilename;
            continue;
          }
        }
        newObj[key] = replaceScreenshots(obj[key], screenshots);
      }
      return newObj;
    }
    return obj;
  }
  // Screenshots werden gesammelt und URLs ersetzt
  const screenshots = [];
  newContext = replaceScreenshots(newContext, screenshots);
  const logEntry = {
    id: entryId,
    applicationId,
    timestamp: timestamp || new Date().toISOString(),
    message,
    context: newContext,
    screenshots,
    state: 'open'
  };
  const logFilePath = getLogFilePath(applicationId);
  readLogs(logFilePath)
    .then(logs => {
      logs.push(logEntry);
      return writeLogs(logFilePath, logs);
    })
    .then(() => {
      res.status(200).json({ success: true, logged: logEntry });
    })
    .catch(error => {
      console.error('Error writing log:', error);
      res.status(500).json({ error: 'Failed to write log' });
    });
});

// GET /log/:applicationId - Retrieve all logs for an application (requires API key)
app.get('/log/:applicationId', authenticateApiKey, (req, res) => {
  const { applicationId } = req.params;
  const logFilePath = getLogFilePath(applicationId);
  if (!fs.existsSync(logFilePath)) {
    return res.status(404).json({ error: 'No logs found for this application' });
  }
  readLogs(logFilePath)
    .then(logs => {
      res.json({
        applicationId,
        totalLogs: logs.length,
        logs
      });
    })
    .catch(error => {
      console.error('Error reading logs:', error);
      res.status(500).json({ error: 'Failed to read logs' });
    });
});

// GET /log/:applicationId - Retrieve only open logs for an application (requires API key)
app.get('/log/:applicationId/open', authenticateApiKey, (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);

    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }

    const logs = readLogs(logFilePath).filter(entry => entry.state === 'open');
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

// GET /log/:applicationId/done - Retrieve all done items
app.get('/log/:applicationId/done', authenticateApiKey, (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);

    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }

    const logs = readLogs(logFilePath).filter(entry => entry.state === 'done');
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

// POST /log/:applicationId/:entryId - Set entry to open again, add rejectReason to context
app.post('/log/:applicationId/:entryId', authenticateApiKey, (req, res) => {
  const { applicationId, entryId } = req.params;
  const { rejectReason } = req.body;
  const logFilePath = getLogFilePath(applicationId);
  let release;
  try {
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    release = lockfile.lockSync(logFilePath, { retries: 3 });
    let logs = readLogs(logFilePath);
    let updated = false;
    logs = logs.map(entry => {
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
    if (!updated) {
      return res.status(404).json({ error: 'Log entry not found or already open' });
    }
    writeLogs(logFilePath, logs);
    res.json({ success: true, entryId });
  } catch (error) {
    console.error('Error reopening log entry:', error);
    res.status(500).json({ error: 'Failed to reopen log entry' });
  } finally {
    if (release) release();
  }
});

// PUT /log/:applicationId/:entryId - Set state to done for one entry, add message from LLM
app.put('/log/:applicationId/:entryId', authenticateApiKey, (req, res) => {
  const { applicationId, entryId } = req.params;
  const { message, error } = req.body;
  const logFilePath = getLogFilePath(applicationId);
  let release;
  try {
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    release = lockfile.lockSync(logFilePath, { retries: 3 });
    let logs = readLogs(logFilePath);
    let updated = false;
    logs = logs.map(entry => {
      if (entry.id === entryId && entry.state === 'open') {
        updated = true;
        return { ...entry, state: 'done', llmMessage: message || error || '' };
      }
      return entry;
    });
    if (!updated) {
      return res.status(404).json({ error: 'Log entry not found or not open' });
    }
    writeLogs(logFilePath, logs);
    res.json({ success: true, entryId });
  } catch (error) {
    console.error('Error updating log entry:', error);
    res.status(500).json({ error: 'Failed to update log entry' });
  } finally {
    if (release) release();
  }
});

// DELETE /log/:applicationId - Remove all closed items from the file
app.delete('/log/:applicationId', authenticateApiKey, (req, res) => {
  const { applicationId } = req.params;
  const logFilePath = getLogFilePath(applicationId);
  let release;
  try {
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    release = lockfile.lockSync(logFilePath, { retries: 3 });
    let logs = readLogs(logFilePath);
    const initialLength = logs.length;
    logs = logs.filter(entry => entry.state !== 'closed');
    writeLogs(logFilePath, logs);
    res.json({ success: true, message: `Removed ${initialLength - logs.length} closed items for ${applicationId}` });
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({ error: 'Failed to clear logs' });
  } finally {
    if (release) release();
  }
});

// DELETE /log/:applicationId/:entryId - Set state to closed for entry
app.delete('/log/:applicationId/:entryId', authenticateApiKey, (req, res) => {
  const { applicationId, entryId } = req.params;
  const logFilePath = getLogFilePath(applicationId);
  let release;
  try {
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
    release = lockfile.lockSync(logFilePath, { retries: 3 });
    let logs = readLogs(logFilePath);
    let found = false;
    logs = logs.map(entry => {
      if (entry.id === entryId && entry.state !== 'closed') {
        found = true;
        // Alle zugehörigen Screenshots löschen
        if (Array.isArray(entry.screenshots)) {
          for (const imgFilename of entry.screenshots) {
            const imgPath = path.join(IMAGES_DIR, imgFilename);
            if (fs.existsSync(imgPath)) {
              try { fs.unlinkSync(imgPath); } catch {}
            }
          }
        }
        return { ...entry, state: 'closed' };
      }
      return entry;
    });
    if (!found) {
      return res.status(404).json({ error: 'Log entry not found or already closed' });
    }
    writeLogs(logFilePath, logs);
    res.json({ success: true, message: `Log entry ${entryId} set to closed for ${applicationId}` });
  } catch (error) {
    console.error('Error closing log entry:', error);
    res.status(500).json({ error: 'Failed to close log entry' });
  } finally {
    if (release) release();
  }
});


// Endpoint zum Ausliefern von Bildern
app.get('/log/:applicationId/img/:filename', (req, res) => {
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
  console.log(`🔐 API Key: ${API_KEY.substring(0, 4)}...`);
  console.log(`
Available endpoints:
  POST   /log                          - Send log entries (requires API key)
  GET    /log/:applicationId           - Retrieve all logs (requires API key)
  GET    /log/:applicationId/open      - Retrieve open logs (requires API key)
  GET    /log/:applicationId/done      - Retrieve done logs (requires API key)
  POST   /log/:applicationId/:entryId  - Reject the implementation (requires API key)
  PUT    /log/:applicationId/:entryId  - Mark log entry as done (requires API key)
  DELETE /log/:applicationId           - Remove all closed items (requires API key)
  DELETE /log/:applicationId/:entryId  - Set log entry to closed (requires API key)
  GET    /health                       - Health check (no auth)


Authentication:
  Include API key in header: X-API-Key: ${API_KEY}
  Or as Bearer token: Authorization: Bearer ${API_KEY}
  `);
});