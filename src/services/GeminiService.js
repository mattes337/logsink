import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/index.js';

class GeminiService {
  constructor() {
    this.genAI = null;
    this.model = null;
    this.isInitialized = false;
  }

  initialize() {
    if (!config.gemini.enabled) {
      console.log('Gemini API is disabled');
      return;
    }

    if (!config.gemini.apiKey) {
      console.warn('Gemini API key not provided, LLM features will be disabled');
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
      this.model = this.genAI.getGenerativeModel({ 
        model: config.gemini.model,
        generationConfig: {
          maxOutputTokens: config.gemini.maxTokens,
          temperature: config.gemini.temperature,
        }
      });
      this.isInitialized = true;
      console.log(`Gemini API initialized with model: ${config.gemini.model}`);
    } catch (error) {
      console.error('Failed to initialize Gemini API:', error);
      throw error;
    }
  }

  isAvailable() {
    return this.isInitialized && config.gemini.enabled;
  }

  async generateLogSummary(logs) {
    if (!this.isAvailable()) {
      throw new Error('Gemini API is not available');
    }

    const startTime = Date.now();
    try {
      const prompt = this.buildLogSummaryPrompt(logs);
      const promptLength = prompt.length;

      console.log(`[GEMINI API CALL] Operation: generateLogSummary | Logs count: ${logs.length} | Prompt length: ${promptLength} chars`);

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const responseText = response.text();
      const duration = Date.now() - startTime;

      console.log(`[GEMINI API RESPONSE] Operation: generateLogSummary | Duration: ${duration}ms | Response length: ${responseText.length} chars | Model: ${config.gemini.model}`);

      return responseText;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[GEMINI API ERROR] Operation: generateLogSummary | Duration: ${duration}ms | Error: ${error.message}`);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  async analyzeLogEntry(logEntry) {
    if (!this.isAvailable()) {
      throw new Error('Gemini API is not available');
    }

    const startTime = Date.now();
    try {
      const prompt = this.buildLogAnalysisPrompt(logEntry);
      const promptLength = prompt.length;

      console.log(`[GEMINI API CALL] Operation: analyzeLogEntry | Log ID: ${logEntry.id || 'N/A'} | Prompt length: ${promptLength} chars`);

      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();
      const duration = Date.now() - startTime;

      console.log(`[GEMINI API RESPONSE] Operation: analyzeLogEntry | Duration: ${duration}ms | Response length: ${responseText.length} chars | Model: ${config.gemini.model}`);

      return responseText;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[GEMINI API ERROR] Operation: analyzeLogEntry | Duration: ${duration}ms | Error: ${error.message}`);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  async suggestSolution(logEntry) {
    if (!this.isAvailable()) {
      throw new Error('Gemini API is not available');
    }

    const startTime = Date.now();
    try {
      const prompt = this.buildSolutionPrompt(logEntry);
      const promptLength = prompt.length;

      console.log(`[GEMINI API CALL] Operation: suggestSolution | Log ID: ${logEntry.id || 'N/A'} | Prompt length: ${promptLength} chars`);

      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();
      const duration = Date.now() - startTime;

      console.log(`[GEMINI API RESPONSE] Operation: suggestSolution | Duration: ${duration}ms | Response length: ${responseText.length} chars | Model: ${config.gemini.model}`);

      return responseText;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[GEMINI API ERROR] Operation: suggestSolution | Duration: ${duration}ms | Error: ${error.message}`);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  async categorizeLog(logEntry) {
    if (!this.isAvailable()) {
      throw new Error('Gemini API is not available');
    }

    const startTime = Date.now();
    try {
      const prompt = this.buildCategorizationPrompt(logEntry);
      const promptLength = prompt.length;

      console.log(`[GEMINI API CALL] Operation: categorizeLog | Log ID: ${logEntry.id || 'N/A'} | Prompt length: ${promptLength} chars`);

      const result = await this.model.generateContent(prompt);
      const response = result.response;

      // Parse the response to extract category and confidence
      const text = response.text();
      const duration = Date.now() - startTime;
      const parsedResult = this.parseCategorizationResponse(text);

      console.log(`[GEMINI API RESPONSE] Operation: categorizeLog | Duration: ${duration}ms | Response length: ${text.length} chars | Category: ${parsedResult.category} | Confidence: ${parsedResult.confidence} | Model: ${config.gemini.model}`);

      return parsedResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[GEMINI API ERROR] Operation: categorizeLog | Duration: ${duration}ms | Error: ${error.message}`);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  async detectDuplicates(logEntry, candidateLogs) {
    if (!this.isAvailable()) {
      throw new Error('Gemini API is not available');
    }

    const startTime = Date.now();
    try {
      const prompt = this.buildDuplicateDetectionPrompt(logEntry, candidateLogs);
      const promptLength = prompt.length;

      console.log(`[GEMINI API CALL] Operation: detectDuplicates | Log ID: ${logEntry.id || 'N/A'} | Candidates: ${candidateLogs.length} | Prompt length: ${promptLength} chars`);

      const result = await this.model.generateContent(prompt);
      const response = result.response;

      // Parse the response to extract similarity scores
      const text = response.text();
      const duration = Date.now() - startTime;
      const similarities = this.parseDuplicateDetectionResponse(text);

      console.log(`[GEMINI API RESPONSE] Operation: detectDuplicates | Duration: ${duration}ms | Response length: ${text.length} chars | Similarities found: ${similarities.length} | Model: ${config.gemini.model}`);

      return similarities;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[GEMINI API ERROR] Operation: detectDuplicates | Duration: ${duration}ms | Error: ${error.message}`);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  async generateCommitMessage(logEntry, changes) {
    if (!this.isAvailable()) {
      throw new Error('Gemini API is not available');
    }

    const startTime = Date.now();
    try {
      const prompt = this.buildCommitMessagePrompt(logEntry, changes);
      const promptLength = prompt.length;

      console.log(`[GEMINI API CALL] Operation: generateCommitMessage | Log ID: ${logEntry.id || 'N/A'} | Prompt length: ${promptLength} chars`);

      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text().trim();
      const duration = Date.now() - startTime;

      console.log(`[GEMINI API RESPONSE] Operation: generateCommitMessage | Duration: ${duration}ms | Response length: ${responseText.length} chars | Model: ${config.gemini.model}`);

      return responseText;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[GEMINI API ERROR] Operation: generateCommitMessage | Duration: ${duration}ms | Error: ${error.message}`);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  buildLogSummaryPrompt(logs) {
    const logSummaries = logs.map(log => 
      `- ${log.state.toUpperCase()}: ${log.message} (${log.timestamp})`
    ).join('\n');

    return `
Please provide a concise summary of the following application logs:

${logSummaries}

Focus on:
1. Overall status and trends
2. Critical issues that need attention
3. Completed tasks
4. Any patterns or recurring problems

Keep the summary under 200 words and use a professional tone.
`;
  }

  buildLogAnalysisPrompt(logEntry) {
    const contextStr = logEntry.context ? JSON.stringify(logEntry.context, null, 2) : 'None';
    
    return `
Analyze the following log entry and provide insights:

Message: ${logEntry.message}
State: ${logEntry.state}
Application: ${logEntry.applicationId}
Timestamp: ${logEntry.timestamp}
Context: ${contextStr}

Please provide:
1. Severity assessment (Low/Medium/High/Critical)
2. Potential root cause
3. Impact analysis
4. Recommended next steps

Keep the analysis concise and actionable.
`;
  }

  buildSolutionPrompt(logEntry) {
    const contextStr = logEntry.context ? JSON.stringify(logEntry.context, null, 2) : 'None';
    
    return `
Based on the following issue, suggest a solution:

Issue: ${logEntry.message}
Application: ${logEntry.applicationId}
Context: ${contextStr}

Please provide:
1. Step-by-step solution
2. Alternative approaches if applicable
3. Prevention strategies
4. Estimated effort/complexity

Focus on practical, implementable solutions.
`;
  }

  buildCategorizationPrompt(logEntry) {
    return `
Categorize the following log entry into one of these categories:
- ERROR: System errors, exceptions, failures
- WARNING: Potential issues, deprecated usage
- INFO: General information, status updates
- DEBUG: Debugging information
- SECURITY: Security-related issues
- PERFORMANCE: Performance problems
- UI: User interface issues
- API: API-related problems
- DATABASE: Database issues
- NETWORK: Network connectivity problems

Log entry: ${logEntry.message}
Context: ${JSON.stringify(logEntry.context || {}, null, 2)}

Respond in this exact format:
Category: [CATEGORY]
Confidence: [0.0-1.0]
Reason: [brief explanation]
`;
  }

  buildDuplicateDetectionPrompt(logEntry, candidateLogs) {
    const candidates = candidateLogs.map((log, index) => 
      `${index + 1}. ${log.message}`
    ).join('\n');

    return `
Compare the following log entry with potential duplicates and rate similarity:

Target log: ${logEntry.message}

Potential duplicates:
${candidates}

For each candidate, provide a similarity score (0.0-1.0) where:
- 1.0 = Identical or essentially the same issue
- 0.8-0.9 = Very similar, likely the same root cause
- 0.6-0.7 = Similar, possibly related
- 0.0-0.5 = Different issues

Respond in this format:
1: [score] - [brief reason]
2: [score] - [brief reason]
...
`;
  }

  buildCommitMessagePrompt(logEntry, changes) {
    return `
Generate a git commit message for the following resolved issue:

Issue: ${logEntry.message}
Application: ${logEntry.applicationId}
Changes made: ${changes || 'Issue resolved'}

Follow conventional commit format:
type(scope): description

Types: fix, feat, docs, style, refactor, test, chore
Keep under 72 characters for the first line.
`;
  }

  parseCategorizationResponse(text) {
    try {
      const lines = text.split('\n');
      const result = {
        category: 'INFO',
        confidence: 0.5,
        reason: 'Unable to parse response'
      };

      for (const line of lines) {
        if (line.startsWith('Category:')) {
          result.category = line.split(':')[1].trim();
        } else if (line.startsWith('Confidence:')) {
          result.confidence = parseFloat(line.split(':')[1].trim());
        } else if (line.startsWith('Reason:')) {
          result.reason = line.split(':')[1].trim();
        }
      }

      return result;
    } catch (error) {
      console.error('Failed to parse categorization response:', error);
      return {
        category: 'INFO',
        confidence: 0.5,
        reason: 'Parse error'
      };
    }
  }

  parseDuplicateDetectionResponse(text) {
    try {
      const lines = text.split('\n').filter(line => line.trim());
      const similarities = [];

      for (const line of lines) {
        const match = line.match(/^(\d+):\s*([\d.]+)/);
        if (match) {
          const index = parseInt(match[1]) - 1;
          const score = parseFloat(match[2]);
          similarities[index] = score;
        }
      }

      return similarities;
    } catch (error) {
      console.error('Failed to parse duplicate detection response:', error);
      return [];
    }
  }
}

export default GeminiService;
