import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import express from 'express';
import sinon from 'sinon';

// Import the server components
import config from '../src/config/index.js';
import databaseManager from '../src/config/database.js';
import LogService from '../src/services/LogService.js';
import BlacklistService from '../src/services/BlacklistService.js';
import EmbeddingService from '../src/services/EmbeddingService.js';
import BackgroundProcessor from '../src/services/BackgroundProcessor.js';
import createLogRoutes from '../src/routes/logRoutes.js';
import createBlacklistRoutes from '../src/routes/blacklistRoutes.js';
import createEmbeddingRoutes from '../src/routes/embeddingRoutes.js';

// Import repositories for mocking
import LogRepository from '../src/repositories/LogRepository.js';
import BlacklistRepository from '../src/repositories/BlacklistRepository.js';

describe('LogSink Core Functionality Tests', function() {
  let app;
  let logService;
  let blacklistService;
  let embeddingService;
  let backgroundProcessor;
  const testApiKey = 'test-api-key-123';

  // Mock embedding data
  const mockEmbedding = new Array(768).fill(0).map(() => Math.random());

  // Mock data storage
  let mockLogs = new Map();
  let mockBlacklist = new Map();
  let mockDuplicates = new Map();
  let logIdCounter = 1;
  let blacklistIdCounter = 1;

  before(async function() {
    this.timeout(15000);

    // Override config for testing
    config.server.apiKey = testApiKey;
    config.embedding.enabled = true;
    config.embedding.apiKey = 'test-gemini-key';

    // Mock database manager
    sinon.stub(databaseManager, 'initialize').resolves();
    sinon.stub(databaseManager, 'getPool').returns({
      query: sinon.stub().resolves({ rows: [] }),
      connect: sinon.stub().resolves({
        query: sinon.stub().resolves({ rows: [] }),
        release: sinon.stub()
      }),
      end: sinon.stub().resolves()
    });

    // Mock LogRepository methods
    sinon.stub(LogRepository.prototype, 'create').callsFake(async (logData) => {
      const id = logData.id || `test-log-${logIdCounter++}`;
      const log = {
        ...logData,
        id,
        application_id: logData.applicationId, // Ensure consistent naming
        created_at: new Date(),
        updated_at: new Date()
      };
      mockLogs.set(id, log);
      return log;
    });

    sinon.stub(LogRepository.prototype, 'findDuplicateCandidate').callsFake(async (applicationId, message, context) => {
      for (const log of mockLogs.values()) {
        if (log.application_id === applicationId && log.message === message && log.state === 'done') {
          return log;
        }
      }
      return null;
    });

    sinon.stub(LogRepository.prototype, 'reopenExisting').callsFake(async (id, timestamp, context, screenshots) => {
      const log = mockLogs.get(id);
      if (!log) return false;
      log.state = 'open';
      log.timestamp = timestamp;
      log.context = context;
      log.screenshots = screenshots;
      log.reopened_at = new Date();
      log.reopen_count = (log.reopen_count || 0) + 1;
      log.updated_at = new Date();
      return true;
    });

    sinon.stub(LogRepository.prototype, 'findByApplicationId').callsFake(async (applicationId) => {
      return Array.from(mockLogs.values()).filter(log => log.application_id === applicationId);
    });

    sinon.stub(LogRepository.prototype, 'findById').callsFake(async (id) => {
      return mockLogs.get(id) || null;
    });

    sinon.stub(LogRepository.prototype, 'updateState').callsFake(async (id, state) => {
      const log = mockLogs.get(id);
      if (!log) return false;
      log.state = state;
      log.updated_at = new Date();
      return true;
    });

    sinon.stub(LogRepository.prototype, 'updateToInProgress').callsFake(async (id) => {
      const log = mockLogs.get(id);
      if (!log) return false;
      log.state = 'in_progress';
      log.started_at = new Date();
      log.updated_at = new Date();
      return true;
    });

    sinon.stub(LogRepository.prototype, 'updateToDone').callsFake(async (id, llmMessage, gitCommit, statistics) => {
      const log = mockLogs.get(id);
      if (!log) return false;
      log.state = 'done';
      log.llm_message = llmMessage;
      log.git_commit = gitCommit;
      log.statistics = statistics;
      log.completed_at = new Date();
      log.updated_at = new Date();
      return true;
    });

    sinon.stub(LogRepository.prototype, 'updateToOpen').callsFake(async (id, context) => {
      const log = mockLogs.get(id);
      if (!log) return false;
      log.state = 'open';
      log.context = context || {};
      log.updated_at = new Date();
      return true;
    });

    sinon.stub(LogRepository.prototype, 'updateToRevert').callsFake(async (id, revertReason) => {
      const log = mockLogs.get(id);
      if (!log) return false;
      log.state = 'revert';
      log.revert_reason = revertReason;
      log.reverted_at = new Date();
      log.updated_at = new Date();
      return true;
    });

    sinon.stub(LogRepository.prototype, 'getStatistics').callsFake(async (applicationId) => {
      const logs = Array.from(mockLogs.values()).filter(log => log.application_id === applicationId);
      const stats = { open: 0, in_progress: 0, done: 0, revert: 0, pending: 0 };
      logs.forEach(log => {
        if (stats[log.state] !== undefined) stats[log.state]++;
      });
      stats.total = logs.length;
      return stats;
    });

    // Mock BlacklistRepository methods
    sinon.stub(BlacklistRepository.prototype, 'findAll').callsFake(async () => {
      return Array.from(mockBlacklist.values());
    });

    sinon.stub(BlacklistRepository.prototype, 'create').callsFake(async (data) => {
      const id = blacklistIdCounter++;
      const entry = { id, ...data, created_at: new Date(), updated_at: new Date() };
      mockBlacklist.set(id, entry);
      return entry;
    });

    // Initialize services
    blacklistService = new BlacklistService();
    embeddingService = new EmbeddingService();
    backgroundProcessor = new BackgroundProcessor();
    logService = new LogService(blacklistService, null, embeddingService);

    // Initialize services (skip actual initialization)
    sinon.stub(blacklistService, 'initialize').returns();
    sinon.stub(embeddingService, 'initialize').returns();
    sinon.stub(backgroundProcessor, 'initialize').returns();
    sinon.stub(logService, 'initialize').returns();

    // Mock embedding service methods
    sinon.stub(embeddingService, 'generateEmbedding').resolves(mockEmbedding);
    sinon.stub(embeddingService, 'isAvailable').returns(true);
    sinon.stub(embeddingService, 'saveEmbedding').resolves(true);
    sinon.stub(embeddingService, 'getPendingEmbeddings').resolves([]);

    // Mock background processor methods
    sinon.stub(backgroundProcessor, 'getStats').returns({
      lastRun: null,
      logsProcessed: 0,
      embeddings_generated: 0,
      logs_merged: 0,
      errors: 0,
      isRunning: false,
      queueSize: 0,
      enabled: true,
      model: 'text-embedding-004',
      pendingLogs: 0
    });

    // Mock blacklist service methods
    sinon.stub(blacklistService, 'refreshCache').resolves();
    sinon.stub(blacklistService, 'ensureCacheValid').resolves();
    sinon.stub(blacklistService, 'isBlacklisted').resolves(false);

    // Don't mock LogService.updateLogState - let it use the mocked repository methods

    // Create Express app
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Add routes
    app.use('/', createLogRoutes(logService));
    app.use('/', createBlacklistRoutes(blacklistService));
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
  });

  beforeEach(async function() {
    // Clean up mock data before each test
    mockLogs.clear();
    mockBlacklist.clear();
    mockDuplicates.clear();
    logIdCounter = 1;
    blacklistIdCounter = 1;
  });

  describe('Health Check', function() {
    it('should return health status without authentication', async function() {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).to.have.property('status', 'ok');
      expect(response.body).to.have.property('version', '2.1.0');
      expect(response.body.features).to.have.property('database', true);
    });
  });

  describe('Issue Creation and Basic Functionality', function() {
    it('should create a new issue with required fields', async function() {
      const issueData = {
        applicationId: 'test-app-1',
        message: 'Database connection failed',
        context: { error: 'Connection timeout', severity: 'high' }
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(issueData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('logged');
      expect(response.body).to.have.property('deduplicated', false);
      expect(response.body).to.have.property('action', 'created_new');
      
      const issue = response.body.logged;
      expect(issue).to.have.property('id');
      expect(issue).to.have.property('applicationId', 'test-app-1');
      expect(issue).to.have.property('message', 'Database connection failed');
      expect(issue).to.have.property('state', 'pending'); // Should be pending when embeddings enabled
      expect(issue).to.have.property('reopenCount', 0);
      expect(issue.context).to.deep.equal(issueData.context);
    });

    it('should handle issue deduplication correctly', async function() {
      const issueData = {
        applicationId: 'test-app-2',
        message: 'Duplicate error message',
        context: { error: 'Same error' }
      };

      // Create first issue
      const firstResponse = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(issueData)
        .expect(200);

      const firstIssueId = firstResponse.body.logged.id;

      // Move first issue to done state
      await request(app)
        .post(`/log/test-app-2/${firstIssueId}`)
        .set('X-API-Key', testApiKey)
        .send({ rejectReason: 'Setting to open' });

      await request(app)
        .patch(`/log/test-app-2/${firstIssueId}/in-progress`)
        .set('X-API-Key', testApiKey);

      await request(app)
        .put(`/log/test-app-2/${firstIssueId}`)
        .set('X-API-Key', testApiKey)
        .send({ message: 'Fixed the issue' });

      // Create second issue with same message (should reopen first)
      const secondResponse = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(issueData)
        .expect(200);
      expect(secondResponse.body).to.have.property('deduplicated', true);
      expect(secondResponse.body).to.have.property('action', 'reopened_existing');
      expect(secondResponse.body.logged.id).to.equal(firstIssueId);
      expect(secondResponse.body.logged).to.have.property('reopen_count', 1);
    });

    it('should retrieve issues by application', async function() {
      // Create multiple issues
      const issues = [
        { applicationId: 'test-app-3', message: 'First issue' },
        { applicationId: 'test-app-3', message: 'Second issue' },
        { applicationId: 'test-app-3', message: 'Third issue' }
      ];

      for (const issue of issues) {
        await request(app)
          .post('/log')
          .set('X-API-Key', testApiKey)
          .send(issue);
      }

      const response = await request(app)
        .get('/log/test-app-3')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('applicationId', 'test-app-3');
      expect(response.body).to.have.property('totalLogs', 3);
      expect(response.body.logs).to.be.an('array').with.length(3);
    });

    it('should handle issue state transitions correctly', async function() {
      // Create an issue
      const issueResponse = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: 'test-app-4',
          message: 'State transition test',
          context: { test: 'state-management' }
        });
      
      const issueId = issueResponse.body.logged.id;
      
      // Move to open state first
      await request(app)
        .post(`/log/test-app-4/${issueId}`)
        .set('X-API-Key', testApiKey)
        .send({ rejectReason: 'Setting to open' })
        .expect(200);

      // Transition to in-progress
      const inProgressResponse = await request(app)
        .patch(`/log/test-app-4/${issueId}/in-progress`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(inProgressResponse.body).to.have.property('success', true);
      expect(inProgressResponse.body).to.have.property('state', 'in_progress');

      // Transition to done
      const doneResponse = await request(app)
        .put(`/log/test-app-4/${issueId}`)
        .set('X-API-Key', testApiKey)
        .send({
          message: 'Issue resolved successfully',
          git_commit: 'abc123def456'
        })
        .expect(200);

      expect(doneResponse.body).to.have.property('success', true);
      expect(doneResponse.body).to.have.property('state', 'done');
    });

    it('should get application statistics', async function() {
      // Create some issues in different states
      const issueResponse = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send({
          applicationId: 'test-app-5',
          message: 'Statistics test issue'
        });

      const response = await request(app)
        .get('/log/test-app-5/statistics')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('applicationId', 'test-app-5');
      expect(response.body).to.have.property('statistics');
      expect(response.body.statistics).to.have.property('open');
      expect(response.body.statistics).to.have.property('in_progress');
      expect(response.body.statistics).to.have.property('done');
      expect(response.body.statistics).to.have.property('revert');
      expect(response.body.statistics).to.have.property('total');
    });
  });

  describe('Embedding Functionality', function() {
    it('should create issue with pending state when embeddings enabled', async function() {
      const issueData = {
        applicationId: 'test-embedding-app',
        message: 'Database connection timeout error',
        context: { database: 'users_db', timeout: 5000 }
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(issueData)
        .expect(200);

      expect(response.body.logged).to.have.property('state', 'pending');
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
  });
});
