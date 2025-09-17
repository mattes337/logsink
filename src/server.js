import express from 'express';
import config from './config/index.js';
import databaseManager from './config/database.js';
import LogService from './services/LogService.js';
import BlacklistService from './services/BlacklistService.js';
import CleanupService from './services/CleanupService.js';
import createLogRoutes from './routes/logRoutes.js';
import createBlacklistRoutes from './routes/blacklistRoutes.js';
import createCleanupRoutes from './routes/cleanupRoutes.js';

const app = express();

// Initialize database
try {
  databaseManager.initialize();
  console.log('✅ Database initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize database:', error);
  process.exit(1);
}

// Initialize services
const blacklistService = new BlacklistService();
const cleanupService = new CleanupService();
const logService = new LogService(blacklistService);

blacklistService.initialize();
cleanupService.initialize();
logService.initialize();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', config.cors.origin);
  res.header('Access-Control-Allow-Methods', config.cors.methods);
  res.header('Access-Control-Allow-Headers', config.cors.headers);
  next();
});

// Request logging middleware
if (config.logging.level === 'debug') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// Routes with injected services
app.use('/', createLogRoutes(logService));
app.use('/', createBlacklistRoutes(blacklistService));
app.use('/', createCleanupRoutes(cleanupService));

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: {
      database: true,
      blacklist: config.blacklist.enabled,
      cleanup: config.cleanup.enabled,
      gemini: config.gemini.enabled && !!config.gemini.apiKey
    }
  });
});

// OpenAPI specification endpoint (no auth required)
app.get('/openapi.json', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const openApiSpec = {
    openapi: '3.0.0',
    info: {
      title: 'LogSink API v2',
      version: '2.0.0',
      description: 'Enhanced API for managing application logs with database storage, blacklist filtering, AI analysis, and automated cleanup'
    },
    servers: [
      {
        url: baseUrl,
        description: 'Current server'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key'
        }
      },
      schemas: {
        LogEntry: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            applicationId: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            message: { type: 'string' },
            context: { type: 'object' },
            screenshots: { type: 'array', items: { type: 'string' } },
            state: { type: 'string', enum: ['open', 'in_progress', 'done', 'closed', 'revert'] },
            llmMessage: { type: 'string' },
            gitCommit: { type: 'string', nullable: true },
            statistics: { type: 'object', nullable: true },
            reopenCount: { type: 'integer' },
            startedAt: { type: 'string', format: 'date-time', nullable: true },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
            reopenedAt: { type: 'string', format: 'date-time', nullable: true },
            revertedAt: { type: 'string', format: 'date-time', nullable: true },
            revertReason: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        BlacklistEntry: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            pattern: { type: 'string' },
            patternType: { type: 'string', enum: ['exact', 'substring', 'regex'] },
            applicationId: { type: 'string', nullable: true },
            reason: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          security: [],
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      timestamp: { type: 'string', format: 'date-time' },
                      version: { type: 'string' },
                      features: { type: 'object' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/log': {
        post: {
          summary: 'Create a new log entry',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['applicationId', 'message'],
                  properties: {
                    applicationId: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    message: { type: 'string' },
                    context: { type: 'object' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Log entry created successfully' },
            '403': { description: 'Log entry blocked by blacklist' },
            '500': { description: 'Server error' }
          }
        }
      },
      '/blacklist': {
        get: {
          summary: 'Get all blacklist patterns',
          parameters: [
            {
              name: 'applicationId',
              in: 'query',
              schema: { type: 'string' },
              description: 'Filter by application ID'
            }
          ],
          responses: {
            '200': {
              description: 'List of blacklist patterns',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      patterns: {
                        type: 'array',
                        items: { '$ref': '#/components/schemas/BlacklistEntry' }
                      },
                      total: { type: 'integer' }
                    }
                  }
                }
              }
            }
          }
        },
        post: {
          summary: 'Add a new blacklist pattern',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['pattern'],
                  properties: {
                    pattern: { type: 'string' },
                    patternType: { type: 'string', enum: ['exact', 'substring', 'regex'], default: 'substring' },
                    applicationId: { type: 'string', nullable: true },
                    reason: { type: 'string', nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'Blacklist pattern created' },
            '409': { description: 'Pattern already exists' },
            '500': { description: 'Server error' }
          }
        }
      },
      '/cleanup/status': {
        get: {
          summary: 'Get cleanup service status',
          responses: {
            '200': {
              description: 'Cleanup service status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      enabled: { type: 'boolean' },
                      isRunning: { type: 'boolean' },
                      schedule: { type: 'string' },
                      statistics: { type: 'object' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  res.json(openApiSpec);
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  cleanupService.stop();
  databaseManager.close();
  
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  
  cleanupService.stop();
  databaseManager.close();
  
  process.exit(0);
});

// Start server
const server = app.listen(config.server.port, () => {
  console.log(`🚀 LogSink v2.0 running on http://${config.server.host}:${config.server.port}`);
  console.log(`📊 Database: ${config.database.path}`);
  console.log(`🖼️  Images: ${config.storage.imagesDir}`);
  console.log(`🔐 API Key: ${config.server.apiKey.substring(0, 4)}...`);
  console.log(`🤖 Gemini AI: ${config.gemini.enabled && config.gemini.apiKey ? 'Enabled' : 'Disabled'}`);
  console.log(`🚫 Blacklist: ${config.blacklist.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`🧹 Cleanup: ${config.cleanup.enabled ? `Enabled (${config.cleanup.interval})` : 'Disabled'}`);
  console.log(`
📋 Available endpoints:
  POST   /log                                    - Create log entries
  GET    /log/:applicationId                     - Get all logs
  GET    /log/:applicationId/open                - Get open/revert logs
  GET    /log/:applicationId/done                - Get done logs
  GET    /log/:applicationId/in-progress         - Get in-progress logs
  GET    /log/:applicationId/statistics          - Get log statistics
  POST   /log/:applicationId/:entryId/analyze    - AI analysis (if enabled)
  POST   /log/:applicationId/:entryId/suggest    - AI suggestions (if enabled)
  POST   /log/:applicationId/summary             - AI summary (if enabled)
  
  GET    /blacklist                              - Get blacklist patterns
  POST   /blacklist                              - Add blacklist pattern
  PUT    /blacklist/:id                          - Update blacklist pattern
  DELETE /blacklist/:id                          - Remove blacklist pattern
  POST   /blacklist/test                         - Test blacklist matching
  
  GET    /cleanup/status                         - Get cleanup status
  POST   /cleanup/run                            - Force cleanup
  
  GET    /health                                 - Health check
  GET    /openapi.json                           - API documentation

🔑 Authentication: Include API key in header: X-API-Key: ${config.server.apiKey}
  `);
});

export default app;
