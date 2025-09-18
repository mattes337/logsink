#!/usr/bin/env node

/**
 * Simple LogSink API Test
 * 
 * Basic test to verify the API is working and processing correctly
 */

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:1234';
const API_KEY = 'super-secret-log-api-key-2024';

const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
};

async function testAPI() {
    console.log('🧪 Simple LogSink API Test\n');
    
    try {
        // Test 1: Health Check
        console.log('1️⃣ Health Check...');
        const healthResponse = await fetch(`${API_BASE}/health`, { headers });
        const health = await healthResponse.json();
        console.log('✅ Health:', health);
        
        // Test 2: Create Log
        console.log('\n2️⃣ Creating Log...');
        const logData = {
            applicationId: 'test-app',
            message: 'Test log message for verification',
            context: { test: true, timestamp: new Date().toISOString() }
        };
        
        const createResponse = await fetch(`${API_BASE}/log`, {
            method: 'POST',
            headers,
            body: JSON.stringify(logData)
        });
        
        const createResult = await createResponse.json();
        console.log('✅ Create Result:', createResult);
        
        // Test 3: Get Logs
        console.log('\n3️⃣ Getting Logs...');
        const logsResponse = await fetch(`${API_BASE}/log/test-app`, { headers });
        const logs = await logsResponse.json();
        console.log('✅ Logs Count:', logs?.length || 'undefined');
        
        if (logs && logs.length > 0) {
            console.log('📝 Sample Log:', {
                id: logs[0].id,
                message: logs[0].message,
                state: logs[0].state,
                timestamp: logs[0].timestamp || logs[0].created_at
            });
        }
        
        // Test 4: Embedding Status
        console.log('\n4️⃣ Embedding Status...');
        const embeddingResponse = await fetch(`${API_BASE}/embedding/status`, { headers });
        const embeddingStatus = await embeddingResponse.json();
        console.log('✅ Embedding Status:', embeddingStatus);
        
        // Test 5: Statistics
        console.log('\n5️⃣ Statistics...');
        const statsResponse = await fetch(`${API_BASE}/log/test-app/statistics`, { headers });
        const stats = await statsResponse.json();
        console.log('✅ Statistics:', stats);
        
        console.log('\n🎉 Basic API test completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testAPI();
