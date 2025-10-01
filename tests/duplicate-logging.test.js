const { expect } = require('chai');
const sinon = require('sinon');
const DuplicateDetectionService = require('../src/services/DuplicateDetectionService');
const LogService = require('../src/services/LogService');
const config = require('../src/config');

describe('Enhanced Duplicate Detection Logging', function() {
  let duplicateDetectionService;
  let logService;
  let mockPool;
  let embeddingServiceStub;
  let geminiServiceStub;
  let consoleLogStub;

  beforeEach(async function() {
    // Mock database pool
    mockPool = {
      query: sinon.stub()
    };

    // Mock embedding service
    embeddingServiceStub = {
      isAvailable: sinon.stub().returns(true),
      generateEmbedding: sinon.stub(),
      findSimilarLogs: sinon.stub()
    };

    // Mock Gemini service
    geminiServiceStub = {
      isAvailable: sinon.stub().returns(true),
      detectDuplicates: sinon.stub()
    };

    // Stub console.log to capture output
    consoleLogStub = sinon.stub(console, 'log');

    // Initialize services
    duplicateDetectionService = new DuplicateDetectionService(
      mockPool,
      embeddingServiceStub,
      geminiServiceStub
    );
    await duplicateDetectionService.initialize();

    // Mock LogRepository
    const mockLogRepo = {
      findById: sinon.stub().resolves({
        id: 'original-id',
        message: 'Original error message',
        context: { error: 'original' },
        state: 'open',
        timestamp: new Date('2024-01-01T10:00:00Z')
      }),
      create: sinon.stub()
    };

    logService = new LogService(mockLogRepo, duplicateDetectionService);

    // Enable all detection methods in config
    config.duplicateDetection = {
      exactMatchEnabled: true,
      embeddingEnabled: true,
      embeddingHighThreshold: 0.95,
      embeddingMediumThreshold: 0.85,
      geminiEnabled: true,
      geminiThreshold: 0.90,
      maxCandidatesForEmbedding: 50,
      maxCandidatesForGemini: 5
    };
  });

  afterEach(function() {
    sinon.restore();
  });

  describe('Exact Match Logging', function() {
    it('should log detailed information for combined message match', async function() {
      const newIssue = {
        applicationId: 'test-app',
        message: 'User report: bug',
        context: {
          message: 'Device details page needs firmware info',
          service: 'auth',
          error: 'timeout'
        }
      };

      // Mock exact match found - same combined message (message + context.message)
      mockPool.query.onFirstCall().resolves({
        rows: [{
          id: 'original-id',
          message: 'User report: bug',
          context: {
            message: 'Device details page needs firmware info',
            service: 'auth',
            error: 'timeout'
          },
          state: 'open',
          timestamp: new Date('2024-01-01T10:00:00Z')
        }]
      });

      await logService.createLog(newIssue);

      // Verify enhanced logging was called
      expect(consoleLogStub.called).to.be.true;

      // Check for key log messages
      const logOutput = consoleLogStub.args.map(args => args.join(' ')).join('\n');

      expect(logOutput).to.include('DUPLICATE ISSUE REJECTED');
      expect(logOutput).to.include('Detection Method: Exact Match (100% identical)');
      expect(logOutput).to.include('Similarity Score: 100.0%');
      expect(logOutput).to.include('Original Issue ID: original-id');
      expect(logOutput).to.include('Match Type: combined_message');
      expect(logOutput).to.include('NEW ISSUE (rejected)');
      expect(logOutput).to.include('ORIGINAL ISSUE (matched)');
      expect(logOutput).to.include('User report: bug');
    });

    it('should NOT match when combined messages differ', async function() {
      const newIssue = {
        applicationId: 'test-app',
        message: 'User report: bug',
        context: {
          message: 'Different detailed message',
          service: 'auth'
        }
      };

      // Mock no match - different combined message
      mockPool.query.onFirstCall().resolves({
        rows: [{
          id: 'original-id',
          message: 'User report: bug',
          context: {
            message: 'Original detailed message',
            service: 'auth'
          },
          state: 'open',
          timestamp: new Date('2024-01-01T10:00:00Z')
        }]
      });

      // Mock embedding service (no exact match, so it will try embedding)
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([]);

      await logService.createLog(newIssue);

      const logOutput = consoleLogStub.args.map(args => args.join(' ')).join('\n');

      // Should NOT be rejected as duplicate since combined messages differ
      expect(logOutput).to.not.include('DUPLICATE ISSUE REJECTED');
    });
  });

  describe('Embedding Similarity Logging', function() {
    it('should log detailed information for high embedding similarity', async function() {
      const newIssue = {
        applicationId: 'test-app',
        message: 'DB timeout error',
        context: { service: 'auth' }
      };

      // Mock no exact match
      mockPool.query.resolves({ rows: [] });

      // Mock embedding similarity
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([{
        id: 'similar-id',
        message: 'Database connection timeout',
        context: { service: 'auth' },
        similarity_score: 0.97,
        state: 'open',
        timestamp: new Date('2024-01-01T10:00:00Z')
      }]);

      // Mock recordDuplicate
      mockPool.query.onCall(2).resolves();

      await logService.createLog(newIssue);

      const logOutput = consoleLogStub.args.map(args => args.join(' ')).join('\n');
      
      expect(logOutput).to.include('DUPLICATE ISSUE REJECTED');
      expect(logOutput).to.include('Detection Method: High Embedding Similarity');
      expect(logOutput).to.include('Similarity Score: 97.0%');
      expect(logOutput).to.include('Match Type: embedding_similarity');
      expect(logOutput).to.include('DB timeout error');
      expect(logOutput).to.include('Database connection timeout');
    });
  });

  describe('Gemini AI Logging', function() {
    it('should log detailed information for Gemini AI detection', async function() {
      const newIssue = {
        applicationId: 'test-app',
        message: 'Connection issue with database',
        context: { service: 'auth' }
      };

      // Mock no exact match
      mockPool.query.resolves({ rows: [] });

      // Mock medium embedding similarity
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([{
        id: 'similar-id',
        message: 'Database timeout problem',
        context: { service: 'auth' },
        similarity_score: 0.87,
        state: 'open',
        timestamp: new Date('2024-01-01T10:00:00Z')
      }]);

      // Mock Gemini detection
      geminiServiceStub.detectDuplicates.resolves([0.92]);

      // Mock recordDuplicate
      mockPool.query.onCall(2).resolves();

      await logService.createLog(newIssue);

      const logOutput = consoleLogStub.args.map(args => args.join(' ')).join('\n');
      
      expect(logOutput).to.include('DUPLICATE ISSUE REJECTED');
      expect(logOutput).to.include('Detection Method: Gemini AI Semantic Analysis');
      expect(logOutput).to.include('Similarity Score: 92.0%');
      expect(logOutput).to.include('Match Type: gemini_ai_analysis');
      expect(logOutput).to.include('Connection issue with database');
      expect(logOutput).to.include('Database timeout problem');
    });
  });

  describe('Context Display', function() {
    it('should properly format and display context objects', async function() {
      const newIssue = {
        applicationId: 'test-app',
        message: 'Error occurred',
        context: {
          service: 'auth',
          error: 'timeout',
          details: { code: 500, retry: true }
        }
      };

      // Mock exact match
      mockPool.query.onFirstCall().resolves({
        rows: [{
          id: 'original-id',
          message: 'Error occurred',
          context: {
            service: 'auth',
            error: 'timeout',
            details: { code: 500, retry: true }
          },
          state: 'open',
          timestamp: new Date('2024-01-01T10:00:00Z')
        }]
      });

      await logService.createLog(newIssue);

      const logOutput = consoleLogStub.args.map(args => args.join(' ')).join('\n');
      
      expect(logOutput).to.include('service: auth');
      expect(logOutput).to.include('error: timeout');
      expect(logOutput).to.include('details:');
    });
  });
});

