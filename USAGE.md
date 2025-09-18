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

## API Documentation

### Get OpenAPI specification
```bash
curl http://localhost:3000/openapi.json
```

## Common Patterns

### Complete workflow example
```bash
# 1. Create a log entry
ENTRY_ID=$(curl -X POST http://localhost:3000/log \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "applicationId": "my-app",
    "message": "Database connection failed"
  }' | jq -r '.id')

# 2. Set to in-progress
curl -X PATCH http://localhost:3000/log/my-app/$ENTRY_ID/in-progress \
  -H "X-API-Key: YOUR_API_KEY"

# 3. Get AI analysis
curl -X POST http://localhost:3000/log/my-app/$ENTRY_ID/analyze \
  -H "X-API-Key: YOUR_API_KEY"

# 4. Mark as done
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

## Error Handling

All endpoints return appropriate HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized (invalid API key)
- `403` - Forbidden (blacklisted)
- `404` - Not Found
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

Error responses include a JSON object with an `error` field:
```json
{
  "error": "Invalid or missing API key"
}
```