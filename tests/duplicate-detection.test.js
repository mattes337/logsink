import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import DuplicateDetectionService from '../src/services/DuplicateDetectionService.js';
import EmbeddingService from '../src/services/EmbeddingService.js';
import GeminiService from '../src/services/GeminiService.js';
import config from '../src/config/index.js';

describe('DuplicateDetectionService', function() {
  let duplicateDetectionService;
  let mockPool;
  let embeddingServiceStub;
  let geminiServiceStub;

  beforeEach(function() {
    // Mock database pool
    mockPool = {
      query: sinon.stub()
    };

    // Create service instance
    duplicateDetectionService = new DuplicateDetectionService();
    duplicateDetectionService.pool = mockPool;
    duplicateDetectionService.isInitialized = true;

    // Stub embedding service
    embeddingServiceStub = sinon.createStubInstance(EmbeddingService);
    embeddingServiceStub.isAvailable.returns(true);
    duplicateDetectionService.embeddingService = embeddingServiceStub;

    // Stub gemini service
    geminiServiceStub = sinon.createStubInstance(GeminiService);
    geminiServiceStub.isAvailable.returns(true);
    duplicateDetectionService.geminiService = geminiServiceStub;

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

  describe('Exact Match Detection', function() {
    it('should detect exact message match', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'Database connection failed',
        context: { error: 'timeout' }
      };

      // Mock database response for exact match
      mockPool.query.onFirstCall().resolves({
        rows: [{
          id: 'existing-log-id',
          message: 'Database connection failed',
          context: { error: 'timeout' },
          state: 'open',
          timestamp: '2023-01-01T00:00:00Z'
        }]
      });

      const result = await duplicateDetectionService.detectDuplicate(logData);

      expect(result.isDuplicate).to.be.true;
      expect(result.method).to.equal('exact_match');
      expect(result.originalId).to.equal('existing-log-id');
      expect(result.similarity).to.equal(1.0);
      expect(result.action).to.equal('rejected_obsolete');
    });

    it('should not detect match when no exact match exists', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'New unique error',
        context: { error: 'different' }
      };

      // Mock database response for no exact match
      mockPool.query.onFirstCall().resolves({ rows: [] });
      mockPool.query.onSecondCall().resolves({ rows: [] });

      // Mock embedding service to return no similar logs
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([]);

      const result = await duplicateDetectionService.detectDuplicate(logData);

      expect(result.isDuplicate).to.be.false;
      expect(result.method).to.equal('none');
    });
  });

  describe('Embedding-based Similarity Detection', function() {
    it('should detect high similarity duplicate (>= 0.95)', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'Database timeout error',
        context: { service: 'auth' }
      };

      // Mock no exact match
      mockPool.query.onFirstCall().resolves({ rows: [] });
      mockPool.query.onSecondCall().resolves({ rows: [] });

      // Mock embedding generation and similarity search
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([
        {
          id: 'similar-log-id',
          message: 'Database connection timeout',
          similarity_score: 0.96,
          state: 'open'
        }
      ]);

      const result = await duplicateDetectionService.detectDuplicate(logData);

      expect(result.isDuplicate).to.be.true;
      expect(result.method).to.equal('embedding_high');
      expect(result.originalId).to.equal('similar-log-id');
      expect(result.similarity).to.equal(0.96);
      expect(result.action).to.equal('rejected_obsolete');
    });

    it('should use Gemini for medium similarity (0.85-0.94)', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'Database timeout issue',
        context: { service: 'auth' }
      };

      // Mock no exact match
      mockPool.query.onFirstCall().resolves({ rows: [] });
      mockPool.query.onSecondCall().resolves({ rows: [] });

      // Mock embedding generation and similarity search
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([
        {
          id: 'medium-similar-log-id',
          message: 'Database connection problem',
          similarity_score: 0.88,
          state: 'open'
        }
      ]);

      // Mock Gemini service to return high similarity
      geminiServiceStub.detectDuplicates.resolves([0.92]);

      const result = await duplicateDetectionService.detectDuplicate(logData);

      expect(result.isDuplicate).to.be.true;
      expect(result.method).to.equal('gemini');
      expect(result.originalId).to.equal('medium-similar-log-id');
      expect(result.similarity).to.equal(0.92);
      expect(result.action).to.equal('rejected_obsolete');

      // Verify Gemini was called
      expect(geminiServiceStub.detectDuplicates.calledOnce).to.be.true;
    });

    it('should not detect duplicate when Gemini similarity is below threshold', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'Different error message',
        context: { service: 'auth' }
      };

      // Mock no exact match
      mockPool.query.onFirstCall().resolves({ rows: [] });
      mockPool.query.onSecondCall().resolves({ rows: [] });

      // Mock embedding generation and similarity search
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([
        {
          id: 'medium-similar-log-id',
          message: 'Somewhat similar error',
          similarity_score: 0.87,
          state: 'open'
        }
      ]);

      // Mock Gemini service to return low similarity
      geminiServiceStub.detectDuplicates.resolves([0.75]);

      const result = await duplicateDetectionService.detectDuplicate(logData);

      expect(result.isDuplicate).to.be.false;
      expect(result.method).to.equal('none');

      // Verify Gemini was called but didn't find a duplicate
      expect(geminiServiceStub.detectDuplicates.calledOnce).to.be.true;
    });
  });

  describe('Configuration Handling', function() {
    it('should skip exact match detection when disabled', async function() {
      config.duplicateDetection.exactMatchEnabled = false;

      const logData = {
        applicationId: 'test-app',
        message: 'Test message',
        context: {}
      };

      // Mock embedding service to return no similar logs
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([]);

      const result = await duplicateDetectionService.detectDuplicate(logData);

      // Should not have called database for exact match
      expect(mockPool.query.called).to.be.false;
      expect(result.isDuplicate).to.be.false;
    });

    it('should skip embedding detection when disabled', async function() {
      config.duplicateDetection.embeddingEnabled = false;

      const logData = {
        applicationId: 'test-app',
        message: 'Test message',
        context: {}
      };

      // Mock no exact match
      mockPool.query.onFirstCall().resolves({ rows: [] });
      mockPool.query.onSecondCall().resolves({ rows: [] });

      const result = await duplicateDetectionService.detectDuplicate(logData);

      // Should not have called embedding service
      expect(embeddingServiceStub.generateEmbedding.called).to.be.false;
      expect(result.isDuplicate).to.be.false;
    });

    it('should skip Gemini detection when disabled', async function() {
      config.duplicateDetection.geminiEnabled = false;

      const logData = {
        applicationId: 'test-app',
        message: 'Test message',
        context: {}
      };

      // Mock no exact match
      mockPool.query.onFirstCall().resolves({ rows: [] });
      mockPool.query.onSecondCall().resolves({ rows: [] });

      // Mock medium similarity
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([
        {
          id: 'medium-similar-log-id',
          message: 'Similar message',
          similarity_score: 0.87,
          state: 'open'
        }
      ]);

      const result = await duplicateDetectionService.detectDuplicate(logData);

      // Should not have called Gemini service
      expect(geminiServiceStub.detectDuplicates.called).to.be.false;
      expect(result.isDuplicate).to.be.false;
    });
  });

  describe('Error Handling', function() {
    it('should handle database errors gracefully', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'Test message',
        context: {}
      };

      // Mock database error
      mockPool.query.rejects(new Error('Database connection failed'));

      const result = await duplicateDetectionService.detectDuplicate(logData);

      // Should continue with embedding detection despite database error
      expect(result.isDuplicate).to.be.false;
    });

    it('should handle embedding service errors gracefully', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'Test message',
        context: {}
      };

      // Mock no exact match
      mockPool.query.onFirstCall().resolves({ rows: [] });
      mockPool.query.onSecondCall().resolves({ rows: [] });

      // Mock embedding service error
      embeddingServiceStub.generateEmbedding.rejects(new Error('Embedding API failed'));

      const result = await duplicateDetectionService.detectDuplicate(logData);

      expect(result.isDuplicate).to.be.false;
      expect(result.method).to.equal('none');
    });

    it('should handle Gemini service errors gracefully', async function() {
      const logData = {
        applicationId: 'test-app',
        message: 'Test message',
        context: {}
      };

      // Mock no exact match
      mockPool.query.onFirstCall().resolves({ rows: [] });
      mockPool.query.onSecondCall().resolves({ rows: [] });

      // Mock medium similarity
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([
        {
          id: 'medium-similar-log-id',
          message: 'Similar message',
          similarity_score: 0.87,
          state: 'open'
        }
      ]);

      // Mock Gemini service error
      geminiServiceStub.detectDuplicates.rejects(new Error('Gemini API failed'));

      const result = await duplicateDetectionService.detectDuplicate(logData);

      expect(result.isDuplicate).to.be.false;
      expect(result.method).to.equal('none');
    });
  });

  describe('Business Rule: Never Merge with Closed Issues', function() {
    it('should never match exact duplicates against closed issues', async function() {
      // Mock database query to return no results (closed issues excluded)
      mockPool.query.onFirstCall().resolves({ rows: [] }); // No open exact matches
      mockPool.query.onSecondCall().resolves({ rows: [] }); // No open content matches

      const result = await duplicateDetectionService.detectDuplicate({
        applicationId: 'test-app',
        message: 'Message that exists in closed issue',
        context: { error: 'Same error as closed issue' }
      });

      expect(result.isDuplicate).to.be.false;
      expect(result.method).to.equal('none');

      // Verify the query excludes closed issues
      const queryCall = mockPool.query.getCall(0);
      expect(queryCall.args[0]).to.include("state NOT IN ('closed', 'revert')");
    });

    it('should never match embedding similarity against closed issues', async function() {
      // Mock no exact match
      mockPool.query.onFirstCall().resolves({ rows: [] });
      mockPool.query.onSecondCall().resolves({ rows: [] });

      // Mock embedding service to return only open issues (closed issues excluded by EmbeddingService)
      embeddingServiceStub.generateEmbedding.resolves([0.1, 0.2, 0.3]);
      embeddingServiceStub.findSimilarLogs.resolves([
        {
          id: 'open-issue-123',
          message: 'Similar message',
          state: 'open', // Only open issues should be returned
          similarity_score: 0.96
        }
      ]);

      const result = await duplicateDetectionService.checkEmbeddingSimilarity(
        'test-app',
        'Test message',
        { error: 'Test error' }
      );

      expect(result.isDuplicate).to.be.true;
      expect(result.method).to.equal('embedding_high');

      // Verify that findSimilarLogs was called (which internally excludes closed issues)
      expect(embeddingServiceStub.findSimilarLogs.calledOnce).to.be.true;
    });
  });
});
