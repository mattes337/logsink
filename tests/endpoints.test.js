import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import express from 'express';
import sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the server components
import config from '../src/config/index.js';
import databaseManager from '../src/config/database.js';
import LogService from '../src/services/LogService.js';
import BlacklistService from '../src/services/BlacklistService.js';
import CleanupService from '../src/services/CleanupService.js';
import EmbeddingService from '../src/services/EmbeddingService.js';
import BackgroundProcessor from '../src/services/BackgroundProcessor.js';
import createLogRoutes from '../src/routes/logRoutes.js';
import createBlacklistRoutes from '../src/routes/blacklistRoutes.js';
import createCleanupRoutes from '../src/routes/cleanupRoutes.js';
import createEmbeddingRoutes from '../src/routes/embeddingRoutes.js';

describe('LogSink Complete Endpoint Tests', function() {
  let app;
  let logService;
  let blacklistService;
  let cleanupService;
  let embeddingService;
  let backgroundProcessor;
  const testApiKey = 'test-api-key-123';
  
  // Mock embedding data
  const mockEmbedding = new Array(768).fill(0).map(() => Math.random());
  
  before(async function() {
    this.timeout(15000);

    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = testApiKey;
    process.env.GEMINI_EMBEDDING_ENABLED = 'true';
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    // Force config reload with test values
    config.server.apiKey = testApiKey;
    config.embedding.enabled = true;
    config.embedding.apiKey = 'test-gemini-key';

    // Initialize database with test configuration
    await databaseManager.initialize();

    // Initialize services
    blacklistService = new BlacklistService();
    cleanupService = new CleanupService();
    embeddingService = new EmbeddingService();
    backgroundProcessor = new BackgroundProcessor();
    logService = new LogService(blacklistService, null, embeddingService);

    // Initialize services first
    blacklistService.initialize();
    cleanupService.initialize();
    embeddingService.initialize();
    backgroundProcessor.initialize();
    logService.initialize();

    // Mock embedding service methods after initialization
    sinon.stub(embeddingService, 'generateEmbedding').resolves(mockEmbedding);
    sinon.stub(embeddingService, 'isAvailable').returns(true);
    sinon.stub(embeddingService, 'saveEmbedding').resolves(true);

    // Create Express app with test configuration
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Add routes
    app.use('/', createLogRoutes(logService));
    app.use('/', createBlacklistRoutes(blacklistService));
    app.use('/', createCleanupRoutes(cleanupService));
    app.use('/', createEmbeddingRoutes(logService, backgroundProcessor));

    // Health check
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        features: {
          database: true,
          blacklist: config.blacklist.enabled,
          cleanup: config.cleanup.enabled,
          gemini: config.gemini.enabled && !!config.gemini.apiKey,
          embeddings: config.embedding.enabled && !!config.embedding.apiKey
        }
      });
    });
  });

  after(async function() {
    // Restore stubs
    sinon.restore();
    
    // Close database connections
    try {
      const pool = databaseManager.getPool();
      if (pool) {
        await pool.end();
      }
    } catch (error) {
      console.log('Error closing database:', error.message);
    }
  });

  beforeEach(async function() {
    // Clean up test data before each test
    try {
      const pool = databaseManager.getPool();
      if (pool) {
        await pool.query('DELETE FROM duplicates WHERE original_log_id IN (SELECT id FROM logs WHERE application_id LIKE \'test-%\')');
        await pool.query('DELETE FROM logs WHERE application_id LIKE \'test-%\'');
        await pool.query('DELETE FROM blacklist WHERE application_id LIKE \'test-%\' OR pattern LIKE \'test-%\'');
      }
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('Health Check Endpoint', function() {
    it('should return health status without authentication', async function() {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).to.have.property('status', 'ok');
      expect(response.body).to.have.property('version', '2.1.0');
      expect(response.body.features).to.have.property('database', true);
      expect(response.body.features).to.have.property('embeddings');
    });
  });

  describe('Authentication', function() {
    it('should reject requests without API key', async function() {
      await request(app)
        .post('/log')
        .send({ applicationId: 'test', message: 'test' })
        .expect(401);
    });

    it('should reject requests with invalid API key', async function() {
      await request(app)
        .post('/log')
        .set('X-API-Key', 'invalid-key')
        .send({ applicationId: 'test', message: 'test' })
        .expect(401);
    });

    it('should accept requests with valid API key in header', async function() {
      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({ applicationId: 'test-app', message: 'test message' })
        .expect(200);

      expect(response.body).to.have.property('success', true);
    });

    it('should accept requests with valid API key as Bearer token', async function() {
      const response = await request(app)
        .post('/log')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ applicationId: 'test-app', message: 'test message' })
        .expect(200);

      expect(response.body).to.have.property('success', true);
    });
  });

  describe('Log Creation and Basic Functionality', function() {
    it('should create a new log entry with required fields', async function() {
      const logData = {
        applicationId: 'test-app-1',
        message: 'Test error message',
        context: { error: 'Database connection failed', severity: 'high' }
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('logged');
      expect(response.body).to.have.property('deduplicated', false);
      expect(response.body).to.have.property('action', 'created_new');

      const log = response.body.logged;
      expect(log).to.have.property('id');
      expect(log).to.have.property('applicationId', 'test-app-1');
      expect(log).to.have.property('message', 'Test error message');
      expect(log).to.have.property('state', 'pending'); // Should be pending when embeddings enabled
      expect(log).to.have.property('reopenCount', 0);
      expect(log.context).to.deep.equal(logData.context);
    });

    it('should create log entry with custom timestamp', async function() {
      const customTimestamp = '2024-01-15T10:30:00.000Z';
      const logData = {
        applicationId: 'test-app-2',
        message: 'Custom timestamp test',
        timestamp: customTimestamp
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(200);

      expect(response.body.logged).to.have.property('timestamp', customTimestamp);
    });

    it('should reject log entry without required applicationId', async function() {
      const logData = {
        message: 'Test message without app ID'
      };

      await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(500); // Should fail validation
    });

    it('should reject log entry without required message', async function() {
      const logData = {
        applicationId: 'test-app-3'
      };

      await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(500); // Should fail validation
    });

    it('should handle log entry with screenshots in context', async function() {
      const logData = {
        applicationId: 'test-app-4',
        message: 'Error with screenshot',
        context: {
          screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          error: 'UI rendering issue'
        }
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body.logged.screenshots).to.be.an('array');
    });

    it('should retrieve all logs for an application', async function() {
      // Create multiple logs first
      const logs = [
        { applicationId: 'test-app-5', message: 'First log' },
        { applicationId: 'test-app-5', message: 'Second log' },
        { applicationId: 'test-app-5', message: 'Third log' }
      ];

      for (const log of logs) {
        await request(app)
          .post('/log')
          .set('X-API-Key', testApiKey)
          .send(log);
      }

      const response = await request(app)
        .get('/log/test-app-5')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('applicationId', 'test-app-5');
      expect(response.body).to.have.property('totalLogs', 3);
      expect(response.body.logs).to.be.an('array').with.length(3);
    });

    it('should return empty array for application with no logs', async function() {
      const response = await request(app)
        .get('/log/nonexistent-app')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('applicationId', 'nonexistent-app');
      expect(response.body).to.have.property('totalLogs', 0);
      expect(response.body.logs).to.be.an('array').with.length(0);
    });
  });

  describe('Log State Management', function() {
    let testLogId;
    const testAppId = 'test-state-app';

    beforeEach(async function() {
      // Create a test log for state management tests
      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: testAppId,
          message: 'Log for state testing',
          context: { test: 'state-management' }
        });

      testLogId = response.body.logged.id;

      // Move from pending to open state for testing
      await request(app)
        .patch(`/log/${testAppId}/${testLogId}/open`)
        .set('X-API-Key', testApiKey);
    });

    it('should transition log from open to in-progress', async function() {
      const response = await request(app)
        .patch(`/log/${testAppId}/${testLogId}/in-progress`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('state', 'in_progress');
    });

    it('should transition log from in-progress to done with metadata', async function() {
      // First move to in-progress
      await request(app)
        .patch(`/log/${testAppId}/${testLogId}/in-progress`)
        .set('X-API-Key', testApiKey);

      const updateData = {
        message: 'Issue resolved successfully',
        git_commit: 'abc123def456',
        statistics: { linesChanged: 42, filesModified: 3 }
      };

      const response = await request(app)
        .put(`/log/${testAppId}/${testLogId}`)
        .set('X-API-Key', testApiKey)
        .send(updateData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('state', 'done');
    });

    it('should revert a done log with reason', async function() {
      // Move to done state first
      await request(app)
        .patch(`/log/${testAppId}/${testLogId}/in-progress`)
        .set('X-API-Key', testApiKey);

      await request(app)
        .put(`/log/${testAppId}/${testLogId}`)
        .set('X-API-Key', testApiKey)
        .send({ message: 'Completed' });

      const revertData = {
        revertReason: 'Fix caused regression in production'
      };

      const response = await request(app)
        .patch(`/log/${testAppId}/${testLogId}/revert`)
        .set('X-API-Key', testApiKey)
        .send(revertData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('state', 'revert');
    });

    it('should retrieve logs by state - open', async function() {
      const response = await request(app)
        .get(`/log/${testAppId}/open`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('applicationId', testAppId);
      expect(response.body.logs).to.be.an('array');
      expect(response.body.logs.some(log => log.id === testLogId)).to.be.true;
    });

    it('should retrieve logs by state - in-progress', async function() {
      // Move log to in-progress
      await request(app)
        .patch(`/log/${testAppId}/${testLogId}/in-progress`)
        .set('X-API-Key', testApiKey);

      const response = await request(app)
        .get(`/log/${testAppId}/in-progress`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body.logs).to.be.an('array');
      expect(response.body.logs.some(log => log.id === testLogId && log.state === 'in_progress')).to.be.true;
    });

    it('should retrieve logs by state - done', async function() {
      // Move log to done
      await request(app)
        .patch(`/log/${testAppId}/${testLogId}/in-progress`)
        .set('X-API-Key', testApiKey);

      await request(app)
        .put(`/log/${testAppId}/${testLogId}`)
        .set('X-API-Key', testApiKey)
        .send({ message: 'Completed' });

      const response = await request(app)
        .get(`/log/${testAppId}/done`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body.logs).to.be.an('array');
      expect(response.body.logs.some(log => log.id === testLogId && log.state === 'done')).to.be.true;
    });

    it('should get application statistics', async function() {
      const response = await request(app)
        .get(`/log/${testAppId}/statistics`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('applicationId', testAppId);
      expect(response.body).to.have.property('statistics');
      expect(response.body.statistics).to.have.property('open');
      expect(response.body.statistics).to.have.property('in_progress');
      expect(response.body.statistics).to.have.property('done');
      expect(response.body.statistics).to.have.property('revert');
      expect(response.body.statistics).to.have.property('total');
    });
  });

  describe('Blacklist Management', function() {
    it('should add a new blacklist pattern', async function() {
      const pattern = {
        pattern: 'test-spam-pattern',
        patternType: 'substring',
        applicationId: 'test-blacklist-app',
        reason: 'Test spam filtering'
      };

      const response = await request(app)
        .post('/blacklist')
        .set('X-API-Key', testApiKey)
        .send(pattern)
        .expect(201);

      expect(response.body).to.have.property('success', true);
      expect(response.body.entry).to.have.property('pattern', 'test-spam-pattern');
      expect(response.body.entry).to.have.property('patternType', 'substring');
      expect(response.body.entry).to.have.property('applicationId', 'test-blacklist-app');
    });

    it('should add regex blacklist pattern', async function() {
      const pattern = {
        pattern: '^ERROR:\\s+\\d+',
        patternType: 'regex',
        reason: 'Filter error codes'
      };

      const response = await request(app)
        .post('/blacklist')
        .set('X-API-Key', testApiKey)
        .send(pattern)
        .expect(201);

      expect(response.body).to.have.property('success', true);
      expect(response.body.entry).to.have.property('patternType', 'regex');
    });

    it('should reject blacklist pattern without required pattern field', async function() {
      const pattern = {
        patternType: 'substring',
        reason: 'Missing pattern'
      };

      await request(app)
        .post('/blacklist')
        .set('X-API-Key', testApiKey)
        .send(pattern)
        .expect(400);
    });

    it('should reject blacklist pattern with invalid pattern type', async function() {
      const pattern = {
        pattern: 'test-pattern',
        patternType: 'invalid-type',
        reason: 'Invalid type test'
      };

      await request(app)
        .post('/blacklist')
        .set('X-API-Key', testApiKey)
        .send(pattern)
        .expect(400);
    });

    it('should retrieve all blacklist patterns', async function() {
      // Add a few patterns first
      const patterns = [
        { pattern: 'test-pattern-1', patternType: 'substring' },
        { pattern: 'test-pattern-2', patternType: 'exact' },
        { pattern: 'test-pattern-3', patternType: 'regex' }
      ];

      for (const pattern of patterns) {
        await request(app)
          .post('/blacklist')
          .set('X-API-Key', testApiKey)
          .send(pattern);
      }

      const response = await request(app)
        .get('/blacklist')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('patterns');
      expect(response.body.patterns).to.be.an('array');
      expect(response.body.patterns.length).to.be.at.least(3);
    });

    it('should test if message would be blacklisted', async function() {
      // Add a blacklist pattern
      await request(app)
        .post('/blacklist')
        .set('X-API-Key', testApiKey)
        .send({
          pattern: 'test-blocked-message',
          patternType: 'substring'
        });

      const testData = {
        message: 'This contains test-blocked-message content'
      };

      const response = await request(app)
        .post('/blacklist/test')
        .set('X-API-Key', testApiKey)
        .send(testData)
        .expect(200);

      expect(response.body).to.have.property('isBlacklisted', true);
      expect(response.body).to.have.property('matchedPattern', 'test-blocked-message');
    });

    it('should block log entry matching blacklist pattern', async function() {
      // Add a blacklist pattern
      await request(app)
        .post('/blacklist')
        .set('X-API-Key', testApiKey)
        .send({
          pattern: 'blocked-error',
          patternType: 'substring',
          reason: 'Known spam pattern'
        });

      const logData = {
        applicationId: 'test-blacklist-app',
        message: 'This is a blocked-error message that should be filtered'
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(403);

      expect(response.body).to.have.property('error', 'Log entry blocked by blacklist');
      expect(response.body).to.have.property('pattern', 'blocked-error');
      expect(response.body).to.have.property('reason', 'Known spam pattern');
    });

    it('should update existing blacklist pattern', async function() {
      // Create a pattern first
      const createResponse = await request(app)
        .post('/blacklist')
        .set('X-API-Key', testApiKey)
        .send({
          pattern: 'test-update-pattern',
          patternType: 'substring'
        });

      const patternId = createResponse.body.entry.id;

      const updateData = {
        pattern: 'test-updated-pattern',
        patternType: 'exact',
        reason: 'Updated reason'
      };

      const response = await request(app)
        .put(`/blacklist/${patternId}`)
        .set('X-API-Key', testApiKey)
        .send(updateData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
    });

    it('should delete blacklist pattern', async function() {
      // Create a pattern first
      const createResponse = await request(app)
        .post('/blacklist')
        .set('X-API-Key', testApiKey)
        .send({
          pattern: 'test-delete-pattern',
          patternType: 'substring'
        });

      const patternId = createResponse.body.entry.id;

      const response = await request(app)
        .delete(`/blacklist/${patternId}`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
    });

    it('should get blacklist statistics', async function() {
      const response = await request(app)
        .get('/blacklist/statistics')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('totalPatterns');
      expect(response.body).to.have.property('byType');
      expect(response.body).to.have.property('byApplication');
    });

    it('should refresh blacklist cache', async function() {
      const response = await request(app)
        .post('/blacklist/refresh')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('message', 'Blacklist cache refreshed');
    });
  });

  describe('Embedding Functionality and Deduplication', function() {
    let testLogId1, testLogId2;
    const embeddingTestApp = 'test-embedding-app';

    beforeEach(async function() {
      // Mock similar embeddings for deduplication testing
      const similarEmbedding = new Array(768).fill(0).map((_, i) => i < 100 ? 0.8 : Math.random() * 0.1);
      embeddingService.generateEmbedding.resolves(similarEmbedding);
    });

    it('should create log with pending state when embeddings enabled', async function() {
      const logData = {
        applicationId: embeddingTestApp,
        message: 'Database connection timeout error',
        context: { database: 'users_db', timeout: 5000 }
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(200);

      expect(response.body.logged).to.have.property('state', 'pending');
      testLogId1 = response.body.logged.id;
    });

    it('should get embedding status', async function() {
      const response = await request(app)
        .get('/embedding/status')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('enabled');
      expect(response.body).to.have.property('model');
      expect(response.body).to.have.property('pendingLogs');
    });

    it('should get pending embeddings count', async function() {
      // Create a pending log first
      await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: embeddingTestApp,
          message: 'Pending embedding test'
        });

      const response = await request(app)
        .get('/embedding/pending')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('pendingCount');
      expect(response.body).to.have.property('pendingLogs');
    });

    it('should force process pending embeddings', async function() {
      // Mock background processor
      sinon.stub(backgroundProcessor, 'isRunning').value(false);
      sinon.stub(backgroundProcessor, 'forceProcessing').resolves();

      const response = await request(app)
        .post('/embedding/process')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('message', 'Background processing started');
    });

    it('should process specific log embedding', async function() {
      // Create a pending log
      const logResponse = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: embeddingTestApp,
          message: 'Specific embedding test'
        });

      const logId = logResponse.body.logged.id;

      // Mock background processor method
      sinon.stub(backgroundProcessor, 'processLogById').resolves({
        success: true,
        message: 'Log processed successfully'
      });

      const response = await request(app)
        .post(`/embedding/process/${logId}`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('logId', logId);
    });

    it('should search logs by text', async function() {
      // Create some logs with embeddings first
      const logs = [
        { message: 'Database connection error', context: { db: 'users' } },
        { message: 'Authentication failure', context: { user: 'admin' } },
        { message: 'Database timeout issue', context: { db: 'products' } }
      ];

      for (const log of logs) {
        await request(app)
          .post('/log')
          .set('X-API-Key', testApiKey)
          .send({
            applicationId: embeddingTestApp,
            ...log
          });
      }

      // Mock search results
      const mockSearchResults = [
        {
          id: 'mock-id-1',
          message: 'Database connection error',
          similarity_score: 0.95,
          state: 'open'
        }
      ];
      sinon.stub(logService, 'searchByText').resolves(mockSearchResults);

      const searchData = {
        text: 'database connection',
        limit: 5
      };

      const response = await request(app)
        .post(`/embedding/search/${embeddingTestApp}`)
        .set('X-API-Key', testApiKey)
        .send(searchData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('applicationId', embeddingTestApp);
      expect(response.body).to.have.property('searchText', 'database connection');
      expect(response.body).to.have.property('results');
      expect(response.body.results).to.be.an('array');
    });

    it('should find similar logs', async function() {
      // Create a log with embedding first
      const logResponse = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: embeddingTestApp,
          message: 'Original error message'
        });

      const logId = logResponse.body.logged.id;

      // Mock similar logs
      const mockSimilarLogs = [
        {
          id: 'similar-1',
          message: 'Similar error message',
          similarity_score: 0.92,
          state: 'done'
        }
      ];
      sinon.stub(logService, 'findSimilarLogs').resolves(mockSimilarLogs);

      const response = await request(app)
        .get(`/embedding/similar/${embeddingTestApp}/${logId}`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('applicationId', embeddingTestApp);
      expect(response.body).to.have.property('logId', logId);
      expect(response.body).to.have.property('similarLogs');
      expect(response.body.similarLogs).to.be.an('array');
    });

    it('should handle deduplication based on message similarity', async function() {
      // Create first log
      const firstLog = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: embeddingTestApp,
          message: 'Database connection failed'
        });

      // Move first log to done state
      const firstLogId = firstLog.body.logged.id;
      await request(app)
        .patch(`/log/${embeddingTestApp}/${firstLogId}/open`)
        .set('X-API-Key', testApiKey);

      await request(app)
        .patch(`/log/${embeddingTestApp}/${firstLogId}/in-progress`)
        .set('X-API-Key', testApiKey);

      await request(app)
        .put(`/log/${embeddingTestApp}/${firstLogId}`)
        .set('X-API-Key', testApiKey)
        .send({ message: 'Fixed connection issue' });

      // Create second log with same message (should reopen first)
      const secondLog = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: embeddingTestApp,
          message: 'Database connection failed'
        });

      expect(secondLog.body).to.have.property('deduplicated', true);
      expect(secondLog.body).to.have.property('action', 'reopened_existing');
      expect(secondLog.body.logged.id).to.equal(firstLogId);
      expect(secondLog.body.logged).to.have.property('reopenCount', 1);
    });
  });

  describe('Cleanup Service Endpoints', function() {
    it('should get cleanup status', async function() {
      const response = await request(app)
        .get('/cleanup/status')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('enabled');
      expect(response.body).to.have.property('isRunning');
      expect(response.body).to.have.property('schedule');
      expect(response.body).to.have.property('statistics');
    });

    it('should get cleanup configuration', async function() {
      const response = await request(app)
        .get('/cleanup/config')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('enabled');
      expect(response.body).to.have.property('interval');
      expect(response.body).to.have.property('duplicateThreshold');
      expect(response.body).to.have.property('maxAge');
      expect(response.body).to.have.property('batchSize');
    });

    it('should trigger manual cleanup', async function() {
      // Mock cleanup service
      sinon.stub(cleanupService, 'isRunning').value(false);
      sinon.stub(cleanupService, 'forceCleanup').resolves();

      const response = await request(app)
        .post('/cleanup/run')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('message', 'Cleanup process started in background');
    });

    it('should reject cleanup when already running', async function() {
      // Mock cleanup service as running
      sinon.stub(cleanupService, 'isRunning').value(true);

      const response = await request(app)
        .post('/cleanup/run')
        .set('X-API-Key', testApiKey)
        .expect(409);

      expect(response.body).to.have.property('error', 'Cleanup is already running');
    });
  });

  describe('AI-Powered Endpoints', function() {
    let aiTestLogId;
    const aiTestApp = 'test-ai-app';

    beforeEach(async function() {
      // Create a test log for AI operations
      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: aiTestApp,
          message: 'Complex error requiring AI analysis',
          context: {
            stackTrace: 'Error at line 42\n  at function foo()\n  at main()',
            errorCode: 'ERR_CONNECTION_REFUSED'
          }
        });

      aiTestLogId = response.body.logged.id;

      // Move to open state
      await request(app)
        .patch(`/log/${aiTestApp}/${aiTestLogId}/open`)
        .set('X-API-Key', testApiKey);
    });

    it('should analyze log entry with AI', async function() {
      // Mock AI analysis
      const mockAnalysis = {
        summary: 'Connection refused error detected',
        severity: 'high',
        suggestedActions: ['Check network connectivity', 'Verify service status'],
        rootCause: 'Network configuration issue'
      };
      sinon.stub(logService, 'analyzeLog').resolves(mockAnalysis);

      const response = await request(app)
        .post(`/log/${aiTestApp}/${aiTestLogId}/analyze`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('analysis');
      expect(response.body.analysis).to.deep.equal(mockAnalysis);
    });

    it('should get AI suggestions for log entry', async function() {
      // Mock AI suggestions
      const mockSuggestions = {
        fixes: [
          'Restart the database service',
          'Check firewall settings',
          'Verify connection string'
        ],
        confidence: 0.85,
        estimatedTime: '15 minutes'
      };
      sinon.stub(logService, 'getSuggestions').resolves(mockSuggestions);

      const response = await request(app)
        .post(`/log/${aiTestApp}/${aiTestLogId}/suggest`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('suggestions');
      expect(response.body.suggestions).to.deep.equal(mockSuggestions);
    });

    it('should generate AI summary for application logs', async function() {
      // Create multiple logs for summary
      const logs = [
        'Database connection timeout',
        'Authentication service down',
        'Cache invalidation error'
      ];

      for (const message of logs) {
        await request(app)
          .post('/log')
          .set('X-API-Key', testApiKey)
          .send({
            applicationId: aiTestApp,
            message
          });
      }

      // Mock AI summary
      const mockSummary = {
        overview: 'Multiple infrastructure issues detected',
        patterns: ['Database connectivity', 'Service availability'],
        recommendations: ['Implement health checks', 'Add monitoring'],
        affectedSystems: ['Database', 'Authentication', 'Cache']
      };
      sinon.stub(logService, 'generateSummary').resolves(mockSummary);

      const response = await request(app)
        .post(`/log/${aiTestApp}/summary`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('summary');
      expect(response.body.summary).to.deep.equal(mockSummary);
    });

    it('should handle AI service unavailable gracefully', async function() {
      // Mock AI service error
      sinon.stub(logService, 'analyzeLog').rejects(new Error('AI service unavailable'));

      const response = await request(app)
        .post(`/log/${aiTestApp}/${aiTestLogId}/analyze`)
        .set('X-API-Key', testApiKey)
        .expect(500);

      expect(response.body).to.have.property('error', 'AI service unavailable');
    });
  });

  describe('Error Handling and Edge Cases', function() {
    it('should handle invalid log ID in state transitions', async function() {
      const invalidLogId = 'invalid-log-id-12345';

      await request(app)
        .patch(`/log/test-app/${invalidLogId}/in-progress`)
        .set('X-API-Key', testApiKey)
        .expect(404);
    });

    it('should handle invalid state transitions', async function() {
      // Create a log in done state
      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: 'test-edge-app',
          message: 'Test invalid transition'
        });

      const logId = response.body.logged.id;

      // Move to open, then in-progress, then done
      await request(app)
        .patch(`/log/test-edge-app/${logId}/open`)
        .set('X-API-Key', testApiKey);

      await request(app)
        .patch(`/log/test-edge-app/${logId}/in-progress`)
        .set('X-API-Key', testApiKey);

      await request(app)
        .put(`/log/test-edge-app/${logId}`)
        .set('X-API-Key', testApiKey)
        .send({ message: 'Completed' });

      // Try invalid transition from done to in-progress
      const invalidResponse = await request(app)
        .patch(`/log/test-edge-app/${logId}/in-progress`)
        .set('X-API-Key', testApiKey)
        .expect(400);

      expect(invalidResponse.body).to.have.property('error');
    });

    it('should handle malformed JSON in request body', async function() {
      await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);
    });

    it('should handle very large context objects', async function() {
      const largeContext = {
        data: 'x'.repeat(1000000), // 1MB of data
        nested: {
          deep: {
            object: {
              with: {
                many: {
                  levels: 'test'
                }
              }
            }
          }
        }
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: 'test-large-app',
          message: 'Large context test',
          context: largeContext
        })
        .expect(200);

      expect(response.body).to.have.property('success', true);
    });

    it('should handle concurrent log creation', async function() {
      const promises = [];
      const concurrentCount = 10;

      for (let i = 0; i < concurrentCount; i++) {
        promises.push(
          request(app)
            .post('/log')
            .set('X-API-Key', testApiKey)
            .send({
              applicationId: 'test-concurrent-app',
              message: `Concurrent log ${i}`,
              context: { index: i }
            })
        );
      }

      const responses = await Promise.all(promises);

      responses.forEach((response, index) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('success', true);
        expect(response.body.logged.context.index).to.equal(index);
      });
    });
  });
});
