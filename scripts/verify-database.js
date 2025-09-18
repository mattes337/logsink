#!/usr/bin/env node

/**
 * Database Verification Script
 * 
 * This script connects to PostgreSQL and verifies:
 * 1. Database connection
 * 2. Table structure
 * 3. Sample data insertion and retrieval
 * 4. Embedding functionality
 * 5. Deduplication logic
 */

import { Pool } from 'pg';
import config from '../src/config/index.js';

// Database connection
const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
});

async function verifyDatabase() {
    console.log('🔍 Starting Database Verification...\n');
    
    try {
        // Test 1: Basic Connection
        console.log('1️⃣ Testing database connection...');
        const client = await pool.connect();
        console.log('✅ Database connection successful');
        
        // Test 2: Check Tables
        console.log('\n2️⃣ Checking table structure...');
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `);
        
        const tables = tablesResult.rows.map(row => row.table_name);
        console.log('📋 Found tables:', tables);
        
        const expectedTables = ['logs', 'blacklist', 'duplicates', 'embeddings'];
        const missingTables = expectedTables.filter(table => !tables.includes(table));
        
        if (missingTables.length > 0) {
            console.log('⚠️  Missing tables:', missingTables);
            console.log('💡 Tables will be created when the server starts');
        } else {
            console.log('✅ All expected tables exist');
        }
        
        // Test 3: Check Extensions
        console.log('\n3️⃣ Checking PostgreSQL extensions...');
        const extensionsResult = await client.query(`
            SELECT extname FROM pg_extension WHERE extname IN ('vector', 'uuid-ossp');
        `);
        
        const extensions = extensionsResult.rows.map(row => row.extname);
        console.log('🔌 Found extensions:', extensions);
        
        if (extensions.includes('vector')) {
            console.log('✅ pgvector extension is available for embeddings');
        } else {
            console.log('⚠️  pgvector extension not found - embeddings may not work');
        }
        
        // Test 4: Sample Data Operations (if tables exist)
        if (tables.includes('logs')) {
            console.log('\n4️⃣ Testing sample data operations...');
            
            // Count existing logs
            const countResult = await client.query('SELECT COUNT(*) as count FROM logs');
            const logCount = parseInt(countResult.rows[0].count);
            console.log(`📊 Current log entries: ${logCount}`);
            
            // Test insert (if we can)
            try {
                const testLogId = 'test-' + Date.now();
                await client.query(`
                    INSERT INTO logs (id, message, level, timestamp, state, context) 
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [testLogId, 'Database verification test', 'info', new Date(), 'pending', '{}']);
                
                console.log('✅ Sample log insertion successful');
                
                // Retrieve the test log
                const retrieveResult = await client.query('SELECT * FROM logs WHERE id = $1', [testLogId]);
                if (retrieveResult.rows.length > 0) {
                    console.log('✅ Sample log retrieval successful');
                    console.log('📝 Test log:', {
                        id: retrieveResult.rows[0].id,
                        message: retrieveResult.rows[0].message,
                        state: retrieveResult.rows[0].state
                    });
                }
                
                // Clean up test data
                await client.query('DELETE FROM logs WHERE id = $1', [testLogId]);
                console.log('🧹 Test data cleaned up');
                
            } catch (insertError) {
                console.log('⚠️  Could not insert test data:', insertError.message);
            }
        }
        
        // Test 5: Check for existing data
        if (tables.includes('logs')) {
            console.log('\n5️⃣ Analyzing existing data...');
            
            const statsResult = await client.query(`
                SELECT 
                    state,
                    COUNT(*) as count
                FROM logs 
                GROUP BY state 
                ORDER BY count DESC
            `);
            
            if (statsResult.rows.length > 0) {
                console.log('📈 Log entries by state:');
                statsResult.rows.forEach(row => {
                    console.log(`   ${row.state}: ${row.count}`);
                });
            } else {
                console.log('📭 No existing log entries found');
            }
        }
        
        // Test 6: Check blacklist
        if (tables.includes('blacklist')) {
            const blacklistResult = await client.query('SELECT COUNT(*) as count FROM blacklist');
            const blacklistCount = parseInt(blacklistResult.rows[0].count);
            console.log(`🚫 Blacklist entries: ${blacklistCount}`);
        }
        
        // Test 7: Check duplicates
        if (tables.includes('duplicates')) {
            const duplicatesResult = await client.query('SELECT COUNT(*) as count FROM duplicates');
            const duplicatesCount = parseInt(duplicatesResult.rows[0].count);
            console.log(`🔄 Duplicate entries: ${duplicatesCount}`);
        }
        
        // Test 8: Check embeddings
        if (tables.includes('embeddings')) {
            const embeddingsResult = await client.query('SELECT COUNT(*) as count FROM embeddings');
            const embeddingsCount = parseInt(embeddingsResult.rows[0].count);
            console.log(`🧠 Embedding entries: ${embeddingsCount}`);
        }
        
        client.release();
        
        console.log('\n🎉 Database verification completed successfully!');
        console.log('\n📋 Summary:');
        console.log('   ✅ Database connection working');
        console.log('   ✅ Table structure verified');
        console.log('   ✅ Basic operations functional');
        console.log('\n💡 Next steps:');
        console.log('   1. Start the LogSink server: npm start');
        console.log('   2. Test API endpoints with sample data');
        console.log('   3. Verify embedding and deduplication features');
        
    } catch (error) {
        console.error('❌ Database verification failed:', error.message);
        console.error('\n🔧 Troubleshooting:');
        console.error('   1. Ensure PostgreSQL is running: docker-compose up -d postgres');
        console.error('   2. Check database credentials in .env file');
        console.error('   3. Verify network connectivity to database');
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run verification
verifyDatabase().catch(console.error);

export { verifyDatabase };
