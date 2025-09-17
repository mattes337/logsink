import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import express from 'express';
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
import createLogRoutes from '../src/routes/logRoutes.js';
import createBlacklistRoutes from '../src/routes/blacklistRoutes.js';
import createCleanupRoutes from '../src/routes/cleanupRoutes.js';

describe('LogSink v2.0 Integration Tests', function() {
  let app;
  let logService;
  let blacklistService;
  let cleanupService;
  const testApiKey = 'test-api-key-123';
  const testDbPath = path.join(__dirname, '../data/test.db');

  before(async function() {
    this.timeout(10000);
    
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Initialize test database
    databaseManager.initialize(testDbPath);

    // Initialize services
    blacklistService = new BlacklistService();
    cleanupService = new CleanupService();
    logService = new LogService(blacklistService);

    blacklistService.initialize();
    cleanupService.initialize();
    logService.initialize();

    // Create Express app with test configuration
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Add routes
    app.use('/', createLogRoutes(logService));
    app.use('/', createBlacklistRoutes(blacklistService));
    app.use('/', createCleanupRoutes(cleanupService));

    // Health check
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        features: {
          database: true,
          blacklist: true,
          cleanup: true,
          gemini: false
        }
      });
    });
  });

  after(function() {
    // Close database connections first
    try {
      if (databaseManager.db) {
        databaseManager.db.close();
      }
    } catch (error) {
      console.log('Error closing database:', error.message);
    }

    // Clean up test database
    setTimeout(() => {
      try {
        if (fs.existsSync(testDbPath)) {
          fs.unlinkSync(testDbPath);
        }
      } catch (error) {
        console.log('Could not delete test database:', error.message);
      }
    }, 100);
  });

  describe('Health Check', function() {
    it('should return health status', async function() {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).to.have.property('status', 'ok');
      expect(response.body).to.have.property('version', '2.0.0');
      expect(response.body.features).to.have.property('database', true);
    });
  });

  describe('Log Management', function() {
    it('should create a log entry', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'Test log entry',
        context: { test: true }
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body.logged).to.have.property('message', 'Test log entry');
      expect(response.body.logged).to.have.property('applicationId', 'test-app');
    });

    it('should retrieve logs for an application', async function() {
      const response = await request(app)
        .get('/log/test-app')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('applicationId', 'test-app');
      expect(response.body).to.have.property('totalLogs');
      expect(response.body.logs).to.be.an('array');
      expect(response.body.logs.length).to.be.greaterThan(0);
    });

    it('should require API key for protected endpoints', async function() {
      await request(app)
        .post('/log')
        .send({ applicationId: 'test', message: 'test' })
        .expect(401);
    });
  });

  describe('Blacklist Management', function() {
    it('should add a blacklist pattern', async function() {
      const pattern = {
        pattern: 'spam',
        patternType: 'substring',
        reason: 'Spam messages'
      };

      const response = await request(app)
        .post('/blacklist')
        .set('X-API-Key', testApiKey)
        .send(pattern)
        .expect(201);

      expect(response.body).to.have.property('success', true);
      expect(response.body.entry).to.have.property('pattern', 'spam');
    });

    it('should block blacklisted log entries', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'This is a spam message',
        context: { test: true }
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(403);

      expect(response.body).to.have.property('error', 'Log entry blocked by blacklist');
      expect(response.body).to.have.property('pattern', 'spam');
    });

    it('should test blacklist patterns', async function() {
      const testData = {
        message: 'This contains spam content'
      };

      const response = await request(app)
        .post('/blacklist/test')
        .set('X-API-Key', testApiKey)
        .send(testData)
        .expect(200);

      expect(response.body).to.have.property('isBlacklisted', true);
      expect(response.body).to.have.property('matchedPattern', 'spam');
    });

    it('should retrieve blacklist patterns', async function() {
      const response = await request(app)
        .get('/blacklist')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('patterns');
      expect(response.body.patterns).to.be.an('array');
      expect(response.body.patterns.length).to.be.greaterThan(0);
    });
  });

  describe('Cleanup Service', function() {
    it('should get cleanup status', async function() {
      const response = await request(app)
        .get('/cleanup/status')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('enabled');
      expect(response.body).to.have.property('isRunning');
      expect(response.body).to.have.property('statistics');
    });

    it('should trigger manual cleanup', async function() {
      const response = await request(app)
        .post('/cleanup/run')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('message');
    });
  });

  describe('Log State Management', function() {
    let testLogId;

    it('should create a log entry for state testing', async function() {
      const logData = {
        applicationId: 'state-test',
        message: 'Log for state testing',
        context: { stateTest: true }
      };

      const response = await request(app)
        .post('/log')
        .set('X-API-Key', testApiKey)
        .send(logData)
        .expect(200);

      testLogId = response.body.logged.id;
      expect(testLogId).to.be.a('string');
    });

    it('should update log state to in-progress', async function() {
      const response = await request(app)
        .patch(`/log/state-test/${testLogId}/in-progress`)
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('success', true);
    });

    it('should update log state to done', async function() {
      const updateData = {
        message: 'Task completed',
        git_commit: 'abc123'
      };

      const response = await request(app)
        .put(`/log/state-test/${testLogId}`)
        .set('X-API-Key', testApiKey)
        .send(updateData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
    });

    it('should retrieve logs by state', async function() {
      const response = await request(app)
        .get('/log/state-test/done')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body.logs).to.be.an('array');
      expect(response.body.logs.some(log => log.id === testLogId)).to.be.true;
    });
  });

  describe('Statistics', function() {
    it('should get application statistics', async function() {
      const response = await request(app)
        .get('/log/test-app/statistics')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('applicationId', 'test-app');
      expect(response.body).to.have.property('statistics');
      expect(response.body.statistics).to.have.property('open');
    });

    it('should get blacklist statistics', async function() {
      const response = await request(app)
        .get('/blacklist/statistics')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body).to.have.property('totalPatterns');
      expect(response.body).to.have.property('byType');
    });
  });
});
