import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// POST /log - Accept log entries (requires API key)
app.post('/log', authenticateApiKey, (req, res) => {
  try {
    const { applicationId, timestamp, message, context } = req.body;
  
    if (!applicationId || !message) {
      return res.status(400).json({ error: 'applicationId and message are required' });
    }

    const logEntry = {
      applicationId,
      timestamp: timestamp || new Date().toISOString(),
      message,
      context: context || {}
    };

    const logFilePath = getLogFilePath(applicationId);
    const logLine = JSON.stringify(logEntry) + '\n';
  
    fs.appendFileSync(logFilePath, logLine);
  
    res.status(200).json({ success: true, logged: logEntry });
  } catch (error) {
    console.error('Error writing log:', error);
    res.status(500).json({ error: 'Failed to write log' });
  }
});

// GET /log/:applicationId - Retrieve logs for an application (requires API key)
app.get('/log/:applicationId', authenticateApiKey, (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);
  
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'No logs found for this application' });
    }
  
    const logData = fs.readFileSync(logFilePath, 'utf8');
    const logs = logData
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return { error: 'Invalid log entry', raw: line };
        }
      });
  
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

// DELETE /log/:applicationId - Clear logs for an application (requires API key)
app.delete('/log/:applicationId', authenticateApiKey, (req, res) => {
  try {
    const { applicationId } = req.params;
    const logFilePath = getLogFilePath(applicationId);
  
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
      res.json({ success: true, message: `Logs cleared for ${applicationId}` });
    } else {
      res.status(404).json({ error: 'No logs found for this application' });
    }
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({ error: 'Failed to clear logs' });
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