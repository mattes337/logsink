# LogSink API Usage Examples

This document provides REST/curl examples for all LogSink API endpoints. All endpoints require authentication via the `X-API-Key` header.

## Authentication

All requests (except `/health` and `/openapi.json`) require an API key:

```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/endpoint
```

## Health Check

### Check service health
```bash
curl http://localhost:3000/health
```

## Log Management

### Create a new log entry
```bash
curl -X POST http://localhost:3000/log \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "applicationId": "my-app",
    "message": "User login failed",
    "context": {
      "userId": "12345",
      "ip": "192.168.1.1",
      "userAgent": "Mozilla/5.0..."
    }
  }'
```

### Create a new log entry with issue management fields
```bash
curl -X POST http://localhost:3000/log \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "applicationId": "my-app",
    "message": "Database connection timeout in authentication service",
    "context": {
      "service": "auth-service",
      "error_code": "DB_TIMEOUT",
      "severity": "critical"
    },
    "type": "bugfix",
    "effort": "high",
    "plan": "# Implementation Plan\n\n1. Investigate connection pool settings\n2. Add retry logic\n3. Implement circuit breaker pattern",
    "llmOutput": "Complete LLM analysis output..."
  }'
```

**Enhanced Duplicate Detection**: The system now automatically detects and rejects duplicate issues using:

⚠️ **CRITICAL BUSINESS RULE**: Never merges new issues with closed issues. Duplicate detection only matches against open issues (excluding 'closed' and 'revert' states) to ensure bugs and requirements can re-appear without being incorrectly merged with historical closed issues.

- **Exact Match Detection**: Identical titles/content are immediately rejected as obsolete (open issues only)
- **Embedding Similarity**: High similarity (≥0.95) issues are rejected automatically (open issues only)
- **AI-Powered Analysis**: Medium similarity issues (0.85-0.94) use Gemini for sophisticated duplicate detection (open issues only)

Response for duplicate issues:
```json
{
  "success": true,
  "logged": { /* original issue data */ },
  "deduplicated": true,
  "action": "rejected_obsolete",
  "duplicateInfo": {
    "method": "exact_match|embedding_high|gemini",
    "similarity": 1.0,
    "originalId": "uuid-of-original-issue"
  }
}
```

### Get all logs for an application
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/my-app
```

### Get open/revert logs
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/my-app/open
```

### Get done logs
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/my-app/done
```

### Get pending logs
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/my-app/pending
```

### Get in-progress logs
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/my-app/in-progress
```



### Set log entry to in-progress
```bash
curl -X PATCH http://localhost:3000/log/my-app/ENTRY_ID/in-progress \
  -H "X-API-Key: YOUR_API_KEY"
```

### Set log entry to done
```bash
curl -X PUT http://localhost:3000/log/my-app/ENTRY_ID \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "message": "Issue resolved by updating authentication logic",
    "git_commit": "abc123def",
    "statistics": {
      "timeToResolve": "45 minutes",
      "linesChanged": 23
    }
  }'
```

### Revert log entry
```bash
curl -X PATCH http://localhost:3000/log/my-app/ENTRY_ID/revert \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "revertReason": "Solution caused regression in payment system"
  }'
```

### Reopen log entry
```bash
curl -X POST http://localhost:3000/log/my-app/ENTRY_ID \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "rejectReason": "Issue still occurring after deployment"
  }'
```

### Close log entry
```bash
curl -X DELETE http://localhost:3000/log/my-app/ENTRY_ID \
  -H "X-API-Key: YOUR_API_KEY"
```

## Issue Management

### Set implementation plan
```bash
curl -X PATCH http://localhost:3000/log/my-app/ENTRY_ID/plan \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "plan": "# Updated Implementation Plan\n\n1. **Phase 1**: Investigate root cause\n   - Check database logs\n   - Review connection pool metrics\n\n2. **Phase 2**: Implement solution\n   - Increase connection timeout\n   - Add retry mechanism\n\n3. **Phase 3**: Testing\n   - Load testing\n   - Monitor production metrics"
  }'
```

### Update issue fields
```bash
curl -X PATCH http://localhost:3000/log/my-app/ENTRY_ID/issue-fields \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "type": "feature",
    "effort": "critical",
    "plan": "# Feature Implementation Plan\n\n1. Design new authentication flow\n2. Implement OAuth2 integration\n3. Add comprehensive testing",
    "llmOutput": "Detailed LLM analysis and recommendations..."
  }'
```

### Delete all logs for an application
```bash
curl -X DELETE http://localhost:3000/log/my-app \
  -H "X-API-Key: YOUR_API_KEY"
```

### Delete all closed logs for an application
```bash
curl -X DELETE http://localhost:3000/log/my-app/closed \
  -H "X-API-Key: YOUR_API_KEY"
```

### Get log statistics
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/my-app/statistics
```

### Serve log images
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/my-app/img/screenshot.png
```

## AI-Powered Features (Gemini)

### Analyze log entry with AI
```bash
curl -X POST http://localhost:3000/log/my-app/ENTRY_ID/analyze \
  -H "X-API-Key: YOUR_API_KEY"
```

### Get AI solution suggestions
```bash
curl -X POST http://localhost:3000/log/my-app/ENTRY_ID/suggest \
  -H "X-API-Key: YOUR_API_KEY"
```

### Generate AI summary of logs
```bash
curl -X POST http://localhost:3000/log/my-app/summary \
  -H "X-API-Key: YOUR_API_KEY"
```

## Blacklist Management

### Get all blacklist patterns
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/blacklist
```

### Get blacklist patterns for specific application
```bash
curl -H "X-API-Key: YOUR_API_KEY" "http://localhost:3000/blacklist?applicationId=my-app"
```

### Add blacklist pattern
```bash
curl -X POST http://localhost:3000/blacklist \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "pattern": "spam message",
    "patternType": "substring",
    "applicationId": "my-app",
    "reason": "Known spam pattern"
  }'
```

### Update blacklist pattern
```bash
curl -X PUT http://localhost:3000/blacklist/1 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "pattern": "updated spam pattern",
    "patternType": "regex",
    "applicationId": "my-app",
    "reason": "Updated regex pattern"
  }'
```

### Delete blacklist pattern
```bash
curl -X DELETE http://localhost:3000/blacklist/1 \
  -H "X-API-Key: YOUR_API_KEY"
```

### Clear all blacklist patterns
```bash
curl -X DELETE http://localhost:3000/blacklist \
  -H "X-API-Key: YOUR_API_KEY"
```

### Test if message would be blacklisted
```bash
curl -X POST http://localhost:3000/blacklist/test \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "message": "Test message to check",
    "applicationId": "my-app"
  }'
```

### Get blacklist statistics
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/blacklist/statistics
```

### Refresh blacklist cache
```bash
curl -X POST http://localhost:3000/blacklist/refresh \
  -H "X-API-Key: YOUR_API_KEY"
```

## Cleanup Management

### Get cleanup status
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/cleanup/status
```

### Force run cleanup
```bash
curl -X POST http://localhost:3000/cleanup/run \
  -H "X-API-Key: YOUR_API_KEY"
```

### Get cleanup configuration
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/cleanup/config
```

## Embedding/Vector Search

### Find similar logs
```bash
curl -H "X-API-Key: YOUR_API_KEY" "http://localhost:3000/embedding/similar/my-app/ENTRY_ID?limit=5"
```

### Search logs by text
```bash
curl -X POST http://localhost:3000/embedding/search/my-app \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "text": "authentication error",
    "limit": 10
  }'
```

### Get embedding processing status
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/embedding/status
```

### Force process pending embeddings
```bash
curl -X POST http://localhost:3000/embedding/process \
  -H "X-API-Key: YOUR_API_KEY"
```

### Process specific log embedding
```bash
curl -X POST http://localhost:3000/embedding/process/LOG_ID \
  -H "X-API-Key: YOUR_API_KEY"
```

### Get pending embeddings count
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/embedding/pending
```

### Get duplicate detection statistics
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/duplicate-stats
```

Response:
```json
{
  "success": true,
  "stats": [
    {
      "detection_method": "exact_match",
      "count": 15,
      "avg_similarity": 1.0,
      "max_similarity": 1.0,
      "min_similarity": 1.0
    },
    {
      "detection_method": "embedding_high",
      "count": 8,
      "avg_similarity": 0.97,
      "max_similarity": 0.99,
      "min_similarity": 0.95
    },
    {
      "detection_method": "gemini",
      "count": 3,
      "avg_similarity": 0.92,
      "max_similarity": 0.94,
      "min_similarity": 0.90
    }
  ]
}
```

## API Documentation

### Get OpenAPI specification
```bash
curl http://localhost:3000/openapi.json
```

## Common Patterns

### Complete workflow example (Embedding-based Lifecycle)
```bash
# 1. Create a log entry with issue management fields (starts in pending for embedding)
ENTRY_ID=$(curl -X POST http://localhost:3000/log \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "applicationId": "my-app",
    "message": "Database connection failed",
    "type": "bugfix",
    "effort": "high"
  }' | jq -r '.logged.id')

# 2. Wait for background processor to embed and move to open state
# (This happens automatically every 10 seconds, or force it:)
curl -X POST http://localhost:3000/embedding/process \
  -H "X-API-Key: YOUR_API_KEY"

# 3. Fetch open issues (after embedding is complete)
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/my-app/open

# 4. Check if plan exists, if not create one
curl -X PATCH http://localhost:3000/log/my-app/$ENTRY_ID/plan \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "plan": "# Database Fix Plan\n\n1. Check connection pool\n2. Update timeout settings\n3. Test thoroughly"
  }'

# 5. Set to in-progress
curl -X PATCH http://localhost:3000/log/my-app/$ENTRY_ID/in-progress \
  -H "X-API-Key: YOUR_API_KEY"

# 6. Get AI analysis
curl -X POST http://localhost:3000/log/my-app/$ENTRY_ID/analyze \
  -H "X-API-Key: YOUR_API_KEY"

# 7. Update with LLM output
curl -X PATCH http://localhost:3000/log/my-app/$ENTRY_ID/issue-fields \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "llmOutput": "AI analysis suggests connection pool exhaustion. Recommend increasing max connections and implementing connection retry logic."
  }'

# 8. Mark as done
curl -X PUT http://localhost:3000/log/my-app/$ENTRY_ID \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "message": "Fixed connection pool configuration",
    "git_commit": "abc123"
  }'
```

### Bulk operations example
```bash
# Get all open issues
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/log/my-app/open

# Force cleanup old entries
curl -X POST http://localhost:3000/cleanup/run \
  -H "X-API-Key: YOUR_API_KEY"

# Clear completed logs
curl -X DELETE http://localhost:3000/log/my-app/closed \
  -H "X-API-Key: YOUR_API_KEY"
```

## Issue Management Field Reference

### Issue Lifecycle States
The lifecycle follows this flow:
```
create → (pending - embedding only) → (open) → start progress → (in_progress) → set done → (done)
                                                  ↓
                                               closed
```

**State Descriptions:**
- `pending` - Initial state for embedding processing ONLY (automatic background process)
- `open` - Issue is ready for development work (automatically set after embedding completes)
- `in_progress` - Issue is actively being worked on
- `done` - Issue has been completed
- `closed` - Issue has been archived
- `revert` - Issue was completed but reverted due to problems

**Key Transitions:**
- All issues start in `pending` state for embedding processing
- Background processor automatically moves from `pending` → `open` after embedding is complete
- Agents should fetch from `/open` endpoint, not `/pending`
- If an open issue has no plan, create one using PATCH `/plan` endpoint
- Can only move to `in_progress` from `open` or `revert` states

### Issue Types
- `bugfix` - Bug fixes and error corrections
- `feature` - New features and enhancements
- `documentation` - Documentation updates and improvements

### Effort Levels
- `low` - Simple changes, minimal impact
- `medium` - Standard development work
- `high` - Complex changes requiring significant effort
- `critical` - Urgent, high-priority work

### Plan Format
The `plan` field accepts markdown text for structured implementation plans:
```markdown
# Implementation Plan

## Phase 1: Analysis
- Investigate root cause
- Review existing code

## Phase 2: Implementation
- Make necessary changes
- Add error handling

## Phase 3: Testing
- Unit tests
- Integration tests
- Manual testing
```

### LLM Output
The `llmOutput` field stores complete AI analysis results, recommendations, and generated content for future reference.

## Error Handling

All endpoints return appropriate HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (invalid field values, enum validation failures)
- `401` - Unauthorized (invalid API key)
- `403` - Forbidden (blacklisted)
- `404` - Not Found
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

Error responses include a JSON object with an `error` field:
```json
{
  "error": "Invalid type value. Must be one of: bugfix, feature, documentation"
}
```