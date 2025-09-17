# LogSink v2.0

An advanced logging server with database storage, AI analysis, blacklist filtering, and automated cleanup capabilities.

## 🚀 Features

### Core Features
- **Database Storage** - SQLite database for reliable log persistence
- **REST API** - Comprehensive API for log management
- **Screenshot Support** - Base64 image processing and storage
- **State Management** - Advanced workflow (open → in_progress → done → revert/closed)
- **API Authentication** - Secure API key-based authentication

### Advanced Features
- **🤖 AI Analysis** - Google Gemini integration for log analysis and suggestions
- **🚫 Blacklist Filtering** - Pattern-based filtering to ignore unwanted logs
- **🧹 Automated Cleanup** - Background service for duplicate detection and removal
- **📊 Statistics** - Detailed analytics and reporting
- **🔄 Migration Tools** - Easy migration from v1.x file-based logs
- **🐳 Docker Support** - Production-ready containerization

## 🏗️ Architecture

```
src/
├── config/          # Configuration and database setup
├── repositories/    # Data access layer
├── services/        # Business logic (AI, blacklist, cleanup)
├── routes/          # API route handlers
├── scripts/         # Migration and utility scripts
└── server.js        # Main application entry point
```

## 🚀 Quick Start

### Using Docker (Recommended)

1. **Clone and configure**:
   ```bash
   git clone <repository>
   cd logsink
   export API_KEY="your-secure-api-key-here"
   ```

2. **Start the server**:
   ```bash
   docker-compose up -d
   ```

3. **Check health**:
   ```bash
   curl http://localhost:1234/health
   ```

### Manual Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set environment variables**:
   ```bash
   export API_KEY="your-secure-api-key-here"
   export GEMINI_API_KEY="your-gemini-api-key"  # Optional
   ```

3. **Migrate existing logs** (if upgrading from v1.x):
   ```bash
   npm run migrate
   ```

4. **Start the server**:
   ```bash
   npm start
   ```

## 📝 API Usage

### Authentication
All endpoints require API key authentication:
```bash
# Header method
X-API-Key: your-api-key

# Bearer token method
Authorization: Bearer your-api-key
```

### Core Log Operations

#### Create Log Entry
```bash
curl -X POST http://localhost:1234/log \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "applicationId": "my-app",
    "message": "Database connection failed",
    "context": {
      "error": "Connection timeout",
      "database": "users_db"
    }
  }'
```

#### Get Logs by State
```bash
# Get open issues (includes reverts)
curl -H "X-API-Key: your-api-key" \
  http://localhost:1234/log/my-app/open

# Get completed issues
curl -H "X-API-Key: your-api-key" \
  http://localhost:1234/log/my-app/done
```

#### Update Log State
```bash
# Mark as done
curl -X PUT http://localhost:1234/log/my-app/{entryId} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "message": "Fixed database connection pool",
    "git_commit": "abc123def"
  }'
```

### Blacklist Management

#### Add Blacklist Pattern
```bash
curl -X POST http://localhost:1234/blacklist \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "pattern": "debug log",
    "patternType": "substring",
    "reason": "Too noisy for production"
  }'
```

### AI-Powered Features (Requires Gemini API)

#### Analyze Log Entry
```bash
curl -X POST http://localhost:1234/log/my-app/{entryId}/analyze \
  -H "X-API-Key: your-api-key"
```

## ⚙️ Configuration

### Environment Variables

#### Core Settings
- `API_KEY` - **Required** API key for authentication
- `PORT` - Server port (default: 1234)
- `NODE_ENV` - Environment (development/production)

#### AI Features
- `GEMINI_API_KEY` - Google Gemini API key
- `GEMINI_ENABLED` - Enable AI features (default: true if API key provided)

#### Blacklist
- `BLACKLIST_ENABLED` - Enable blacklist filtering (default: true)

#### Cleanup
- `CLEANUP_ENABLED` - Enable automated cleanup (default: true)
- `CLEANUP_INTERVAL` - Cron schedule (default: "0 2 * * *" - daily at 2 AM)

## 🔄 Migration from v1.x

If you're upgrading from the file-based v1.x version:

1. **Run migration**:
   ```bash
   npm run migrate
   ```

2. **Verify migration**:
   ```bash
   curl -H "X-API-Key: your-api-key" \
     http://localhost:1234/log/your-app-id
   ```

## 📊 Log States & Workflow

```
┌─────────┐    ┌──────────────┐    ┌──────┐
│  open   │───▶│ in_progress  │───▶│ done │
└─────────┘    └──────────────┘    └──────┘
     ▲                                 │
     │                                 ▼
     │         ┌────────┐         ┌─────────┐
     └─────────│ revert │         │ closed  │
               └────────┘         └─────────┘
```

## 🔍 API Documentation

- **OpenAPI Spec**: `GET /openapi.json`
- **Health Check**: `GET /health`

## 📄 License

MIT License