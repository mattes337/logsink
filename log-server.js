import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 1234;
const LOGS_DIR = path.join(__dirname, 'logs');
const API_KEY = process.env.API_KEY || 'your-secret-api-key';

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

app.use(express.json());

// CORS for browser requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE');
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
  try {
    const logs = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
};

// Helper to write logs safely
const writeLogs = (logFilePath, logs) => {
  fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
};

// POST /log - Accept log entries (requires API key)
app.post('/log', authenticateApiKey, (req, res) => {
  try {
    const { applicationId, timestamp, message, context } = req.body;

    if (!applicationId || !message) {
      return res.status(400).json({ error: 'applicationId and message are required' });
    }

    const logEntry = {
      id: uuidv4(),
      applicationId,
      timestamp: timestamp || new Date().toISOString(),
      message,
      context: context || {},
      state: 'open'
    };

    const logFilePath = getLogFilePath(applicationId);
    let logs = readLogs(logFilePath);
    logs.push(logEntry);
    writeLogs(logFilePath, logs);
    res.status(200).json({ success: true, logged: logEntry });
  } catch (error) {
    console.error('Error writing log:', error);
    res.status(500).json({ error: 'Failed to write log' });
  }
});

// GET /log/:applicationId - Retrieve only open logs for an application (requires API key)
app.get('/log/:applicationId', authenticateApiKey, (req, res) => {
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

// PUT /log/:applicationId - Set state to done for all open items, add message from LLM
app.put('/log/:applicationId', authenticateApiKey, (req, res) => {
  try {
    const { applicationId } = req.params;
    const { message } = req.body;
    const logFilePath = getLogFilePath(applicationId);

    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }

    let logs = readLogs(logFilePath);
    let updated = false;
    logs = logs.map(entry => {
      if (entry.state === 'open') {
        updated = true;
        return { ...entry, state: 'done', llmMessage: message || '' };
      }
      return entry;
    });
    writeLogs(logFilePath, logs);
    res.json({ success: true, updated });
  } catch (error) {
    console.error('Error updating logs:', error);
    res.status(500).json({ error: 'Failed to update logs' });
  }
});

// DELETE /log/:applicationId - Remove all closed items from the file
app.delete('/log/:applicationId', authenticateApiKey, (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);

    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }

    let logs = readLogs(logFilePath);
    const initialLength = logs.length;
    logs = logs.filter(entry => entry.state !== 'closed');
    writeLogs(logFilePath, logs);
    res.json({ success: true, message: `Removed ${initialLength - logs.length} closed items for ${applicationId}` });
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// DELETE /log/:applicationId/:entryId - Set state to closed for entry
app.delete('/log/:applicationId/:entryId', authenticateApiKey, (req, res) => {
  try {
    const { applicationId, entryId } = req.params;
    const logFilePath = getLogFilePath(applicationId);

    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }

    let logs = readLogs(logFilePath);
    let found = false;
    logs = logs.map(entry => {
      if (entry.id === entryId && entry.state !== 'closed') {
        found = true;
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
  }
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
  POST /log                    - Send log entries (requires API key)
  GET  /log/:applicationId     - Retrieve logs (requires API key)
  DELETE /log/:applicationId   - Clear logs (requires API key)
  GET  /health                 - Health check (no auth)

Authentication:
  Include API key in header: X-API-Key: ${API_KEY}
  Or as Bearer token: Authorization: Bearer ${API_KEY}
  `);
});