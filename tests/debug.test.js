import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import express from 'express';

// Import the server components
import config from '../src/config/index.js';
import databaseManager from '../src/config/database.js';
import LogService from '../src/services/LogService.js';
import BlacklistService from '../src/services/BlacklistService.js';
import createLogRoutes from '../src/routes/logRoutes.js';

describe('Debug Authentication', function() {
  let app;
  let logService;
  let blacklistService;
  const testApiKey = 'test-api-key-123';

  before(async function() {
    this.timeout(15000);
    
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = testApiKey;
    
    // Force config reload with test values
    config.server.apiKey = testApiKey;
    
    console.log('Config API Key:', config.server.apiKey);
    console.log('Test API Key:', testApiKey);
    
    // Initialize database
    await databaseManager.initialize();

    // Initialize services
    blacklistService = new BlacklistService();
    logService = new LogService(blacklistService);

    blacklistService.initialize();
    logService.initialize();

    // Create Express app
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Add routes
    app.use('/', createLogRoutes(logService));

    // Health check
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.1.0'
      });
    });
  });

  after(async function() {
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

  it('should return health status without authentication', async function() {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body).to.have.property('status', 'ok');
  });

  it('should reject requests without API key', async function() {
    await request(app)
      .post('/log')
      .send({ applicationId: 'test', message: 'test' })
      .expect(401);
  });

  it('should accept requests with valid API key in header', async function() {
    console.log('Sending request with API key:', testApiKey);
    
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
