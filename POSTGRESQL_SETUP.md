# PostgreSQL Setup Guide for LogSink v2.1

LogSink v2.1 has migrated from SQLite to PostgreSQL for better performance, scalability, and enterprise features.

## Quick Start with Docker Compose

The easiest way to run LogSink with PostgreSQL is using Docker Compose:

```bash
# Clone the repository
git clone https://github.com/your-repo/logsink.git
cd logsink

# Start the services
docker-compose up -d

# Check the logs
docker-compose logs -f
```

This will start both the LogSink application and PostgreSQL database with default configuration.

## Environment Variables

Configure the following environment variables for PostgreSQL:

### Database Configuration
```bash
# PostgreSQL connection settings
DB_HOST=localhost          # Database host
DB_PORT=5432              # Database port
DB_NAME=logsink           # Database name
DB_USER=logsink           # Database user
DB_PASSWORD=logsink       # Database password

# Connection pool settings
DB_POOL_MAX=20            # Maximum connections in pool
DB_IDLE_TIMEOUT=30000     # Idle timeout in milliseconds
DB_CONNECTION_TIMEOUT=2000 # Connection timeout in milliseconds

# SSL settings (optional)
DB_SSL=false              # Enable SSL connections
```

### Application Configuration
```bash
# Server settings
PORT=1234
API_KEY=your-secret-api-key

# Feature toggles
GEMINI_API_KEY=your-gemini-key
GEMINI_ENABLED=false
BLACKLIST_ENABLED=true
CLEANUP_ENABLED=true

# Embedding Configuration (requires GEMINI_API_KEY)
GEMINI_EMBEDDING_ENABLED=false
GEMINI_EMBEDDING_MODEL=text-embedding-004
GEMINI_SIMILARITY_THRESHOLD=0.85
```

## Manual PostgreSQL Setup

If you prefer to set up PostgreSQL manually:

### 1. Install PostgreSQL

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
```

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**Windows:**
Download and install from [PostgreSQL official website](https://www.postgresql.org/download/windows/)

### 2. Install pgvector Extension

LogSink v2.1+ supports vector similarity search using pgvector for intelligent ticket deduplication.

**Ubuntu/Debian:**
```bash
sudo apt install postgresql-16-pgvector
```

**macOS:**
```bash
brew install pgvector
```

**From Source:**
```bash
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
```

### 3. Create Database and User

```sql
-- Connect to PostgreSQL as superuser
sudo -u postgres psql

-- Create database and user
CREATE DATABASE logsink;
CREATE USER logsink WITH PASSWORD 'logsink';
GRANT ALL PRIVILEGES ON DATABASE logsink TO logsink;

-- Exit PostgreSQL
\q
```

### 3. Initialize Schema

```bash
# Run the initialization script
psql -h localhost -U logsink -d logsink -f src/scripts/init-postgres.sql
```

### 4. Configure Environment

Create a `.env` file:
```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=logsink
DB_USER=logsink
DB_PASSWORD=logsink
API_KEY=your-secret-api-key
```

### 5. Install Dependencies and Start

```bash
npm install
npm start
```

## Migration from SQLite (v2.0)

If you're upgrading from LogSink v2.0 with SQLite:

### 1. Backup Your Data
```bash
# Backup your SQLite database
cp data/logsink.db data/logsink.db.backup
```

### 2. Set Up PostgreSQL
Follow the manual setup steps above to create the PostgreSQL database.

### 3. Run Migration Script
```bash
# Install better-sqlite3 for migration (temporary)
npm install better-sqlite3

# Set environment variables for both databases
export SQLITE_DB_PATH=./data/logsink.db
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=logsink
export DB_USER=logsink
export DB_PASSWORD=logsink

# Run migration
npm run migrate:postgres
```

### 4. Verify Migration
```bash
# Check that data was migrated successfully
psql -h localhost -U logsink -d logsink -c "SELECT COUNT(*) FROM logs;"
psql -h localhost -U logsink -d logsink -c "SELECT COUNT(*) FROM blacklist;"
```

## Adding Vector Embeddings to Existing Installation

If you're upgrading from LogSink v2.0 to v2.1+ and want to add vector embedding support:

### 1. Run Embedding Migration
```bash
# Add pgvector support to existing database
npm run migrate:embeddings
```

### 2. Configure Embeddings
Add to your `.env` file:
```bash
GEMINI_EMBEDDING_ENABLED=true
GEMINI_API_KEY=your-gemini-api-key
GEMINI_EMBEDDING_MODEL=text-embedding-004
GEMINI_SIMILARITY_THRESHOLD=0.85
```

### 3. Restart Application
```bash
# Restart to enable background embedding processing
npm start
```

The background processor will automatically:
- Generate embeddings for new tickets (using 'pending' state)
- Find similar existing tickets using vector similarity
- Merge highly similar tickets automatically
- Process existing tickets without embeddings in the background

## Production Deployment

### Docker Compose Production

For production deployment, create a `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=${DB_NAME}
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    restart: unless-stopped
    
  logsink:
    build: .
    depends_on:
      - postgres
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - DB_NAME=${DB_NAME}
      - DB_USER=${DB_USER}
      - DB_PASSWORD=${DB_PASSWORD}
      - API_KEY=${API_KEY}
    volumes:
      - logsink_images:/app/images
    restart: unless-stopped

volumes:
  postgres_data:
  logsink_images:
```

### Security Considerations

1. **Change Default Passwords**: Use strong, unique passwords for production
2. **Enable SSL**: Configure SSL connections for production databases
3. **Network Security**: Use private networks and firewalls
4. **Regular Backups**: Set up automated database backups
5. **Monitor Resources**: Monitor database performance and resource usage

### Performance Tuning

1. **Connection Pool**: Adjust `DB_POOL_MAX` based on your load
2. **Database Configuration**: Tune PostgreSQL settings for your hardware
3. **Indexing**: Monitor query performance and add indexes as needed
4. **Monitoring**: Use tools like pgAdmin or monitoring solutions

## Troubleshooting

### Common Issues

**Connection Refused:**
- Check if PostgreSQL is running
- Verify host and port settings
- Check firewall rules

**Authentication Failed:**
- Verify username and password
- Check PostgreSQL user permissions
- Ensure database exists

**Performance Issues:**
- Monitor connection pool usage
- Check database query performance
- Review PostgreSQL logs

### Health Checks

The application includes health checks for both the API and database:

```bash
# Check application health
curl http://localhost:1234/health

# Check database connection
docker-compose exec postgres pg_isready -U logsink
```

## Support

For issues and questions:
- Check the application logs: `docker-compose logs logsink`
- Check PostgreSQL logs: `docker-compose logs postgres`
- Review the troubleshooting section above
- Open an issue on the GitHub repository
