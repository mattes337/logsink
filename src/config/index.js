import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Config {
  constructor() {
    this.load();
  }

  load() {
    // Server configuration
    this.server = {
      port: process.env.PORT || 1234,
      host: process.env.HOST || 'localhost',
      apiKey: process.env.API_KEY || 'your-secret-api-key'
    };

    // Database configuration
    this.database = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      name: process.env.DB_NAME || 'logsink',
      user: process.env.DB_USER || 'logsink',
      password: process.env.DB_PASSWORD || 'logsink',
      poolMax: parseInt(process.env.DB_POOL_MAX) || 20,
      idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };

    // Storage configuration
    this.storage = {
      imagesDir: process.env.IMAGES_DIR || path.join(__dirname, '../../images'),
      maxImageSize: parseInt(process.env.MAX_IMAGE_SIZE) || 10 * 1024 * 1024, // 10MB
      allowedImageTypes: (process.env.ALLOWED_IMAGE_TYPES || 'jpg,jpeg,png,gif,webp,bmp').split(',')
    };

    // Gemini API configuration
    this.gemini = {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      maxTokens: parseInt(process.env.GEMINI_MAX_TOKENS) || 8192,
      temperature: parseFloat(process.env.GEMINI_TEMPERATURE) || 0.7,
      enabled: process.env.GEMINI_ENABLED !== 'false'
    };

    // Gemini Embedding configuration
    this.embedding = {
      enabled: process.env.GEMINI_EMBEDDING_ENABLED === 'true',
      model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
      similarityThreshold: parseFloat(process.env.GEMINI_SIMILARITY_THRESHOLD) || 0.85,
      apiKey: process.env.GEMINI_API_KEY || ''
    };

    // Cleanup service configuration
    this.cleanup = {
      enabled: process.env.CLEANUP_ENABLED !== 'false',
      interval: process.env.CLEANUP_INTERVAL || '0 2 * * *', // Daily at 2 AM
      duplicateThreshold: parseFloat(process.env.DUPLICATE_THRESHOLD) || 0.85,
      maxAge: parseInt(process.env.CLEANUP_MAX_AGE) || 30 * 24 * 60 * 60 * 1000, // 30 days
      batchSize: parseInt(process.env.CLEANUP_BATCH_SIZE) || 100
    };

    // Blacklist configuration
    this.blacklist = {
      enabled: process.env.BLACKLIST_ENABLED !== 'false',
      autoDelete: process.env.BLACKLIST_AUTO_DELETE === 'true',
      cacheTimeout: parseInt(process.env.BLACKLIST_CACHE_TIMEOUT) || 5 * 60 * 1000 // 5 minutes
    };

    // Logging configuration
    this.logging = {
      level: process.env.LOG_LEVEL || 'info',
      format: process.env.LOG_FORMAT || 'combined',
      file: process.env.LOG_FILE || null
    };

    // CORS configuration
    this.cors = {
      origin: process.env.CORS_ORIGIN || '*',
      methods: process.env.CORS_METHODS || 'GET, POST, PUT, DELETE, PATCH',
      headers: process.env.CORS_HEADERS || 'Content-Type, Authorization, X-API-Key'
    };
  }

  get(key) {
    const keys = key.split('.');
    let value = this;
    for (const k of keys) {
      value = value[k];
      if (value === undefined) {
        return undefined;
      }
    }
    return value;
  }

  set(key, value) {
    const keys = key.split('.');
    const lastKey = keys.pop();
    let obj = this;
    for (const k of keys) {
      if (!obj[k]) {
        obj[k] = {};
      }
      obj = obj[k];
    }
    obj[lastKey] = value;
  }

  validate() {
    const errors = [];

    // Only validate in production
    if (this.isProduction()) {
      if (!this.server.apiKey || this.server.apiKey === 'your-secret-api-key') {
        errors.push('API_KEY must be set to a secure value');
      }
    }

    // Database validation
    if (!this.database.host) {
      errors.push('DB_HOST is required');
    }
    if (!this.database.name) {
      errors.push('DB_NAME is required');
    }
    if (!this.database.user) {
      errors.push('DB_USER is required');
    }
    if (!this.database.password) {
      errors.push('DB_PASSWORD is required');
    }
    if (this.database.port < 1 || this.database.port > 65535) {
      errors.push('DB_PORT must be between 1 and 65535');
    }

    // Disable Gemini if no API key provided
    if (this.gemini.enabled && !this.gemini.apiKey) {
      console.warn('GEMINI_API_KEY not provided, disabling AI features');
      this.gemini.enabled = false;
    }

    if (this.server.port < 1 || this.server.port > 65535) {
      errors.push('PORT must be between 1 and 65535');
    }

    if (this.cleanup.duplicateThreshold < 0 || this.cleanup.duplicateThreshold > 1) {
      errors.push('DUPLICATE_THRESHOLD must be between 0 and 1');
    }

    return errors;
  }

  isDevelopment() {
    return process.env.NODE_ENV === 'development';
  }

  isProduction() {
    return process.env.NODE_ENV === 'production';
  }

  isTest() {
    return process.env.NODE_ENV === 'test';
  }
}

// Singleton instance
const config = new Config();

// Validate configuration on startup
const validationErrors = config.validate();
if (validationErrors.length > 0) {
  console.error('Configuration validation errors:');
  validationErrors.forEach(error => console.error(`  - ${error}`));
  if (config.isProduction()) {
    process.exit(1);
  }
}

export default config;
