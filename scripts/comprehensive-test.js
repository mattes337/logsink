#!/usr/bin/env node

/**
 * Comprehensive LogSink Test Suite
 * 
 * This script performs end-to-end testing of the LogSink service:
 * 1. Issue creation and embedding generation
 * 2. Deduplication logic verification
 * 3. State advancement for worker workflows
 * 4. Database consistency checks
 */

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:1234';
const API_KEY = 'super-secret-log-api-key-2024';
const TEST_APP_ID = 'comprehensive-test';

const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
};

async function apiRequest(method, endpoint, body = null) {
    const url = `${API_BASE}${endpoint}`;
    const options = { method, headers, body: body ? JSON.stringify(body) : null };
    
    try {
        const response = await fetch(url, options);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${data.error || 'Unknown error'}`);
        }
        
        return data;
    } catch (error) {
        throw new Error(`Request failed: ${error.message}`);
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function comprehensiveTest() {
    console.log('🚀 Starting Comprehensive LogSink Test Suite...\n');
    
    let testResults = {
        passed: 0,
        failed: 0,
        tests: []
    };
    
    function logTest(name, passed, details = '') {
        const status = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status} ${name}${details ? ': ' + details : ''}`);
        testResults.tests.push({ name, passed, details });
        if (passed) testResults.passed++;
        else testResults.failed++;
    }
    
    try {
        // Test 1: Health Check
        console.log('1️⃣ Testing System Health...');
        const health = await apiRequest('GET', '/health');
        logTest('Health Check', health.status === 'ok', health.status);
        
        // Test 2: Create New Issue
        console.log('\n2️⃣ Testing Issue Creation...');
        const newIssue = {
            applicationId: TEST_APP_ID,
            message: 'Critical database connection timeout in user authentication service',
            context: {
                service: 'auth-service',
                error_code: 'DB_TIMEOUT',
                severity: 'critical',
                timestamp: new Date().toISOString(),
                stack_trace: 'at DatabaseConnection.connect() line 42'
            }
        };
        
        const createdIssue = await apiRequest('POST', '/log', newIssue);
        logTest('Issue Creation', !!createdIssue.id, `ID: ${createdIssue.id}`);
        logTest('Initial State', createdIssue.state === 'pending', `State: ${createdIssue.state}`);
        
        const issueId = createdIssue.id;
        
        // Test 3: Verify Embedding Processing
        console.log('\n3️⃣ Testing Embedding Generation...');
        
        // Wait for background processing
        await sleep(2000);
        
        // Check embedding status
        const embeddingStatus = await apiRequest('GET', '/embedding/status');
        logTest('Embedding Service Active', embeddingStatus.enabled, `Enabled: ${embeddingStatus.enabled}`);
        
        // Force embedding processing
        await apiRequest('POST', '/embedding/process');
        await sleep(3000); // Wait for processing
        
        // Check if issue moved to 'open' state after embedding
        const processedIssue = await apiRequest('GET', `/log/${TEST_APP_ID}/${issueId}`);
        logTest('State Advancement', processedIssue.state === 'open', `State: ${processedIssue.state}`);
        
        // Test 4: Test Deduplication
        console.log('\n4️⃣ Testing Deduplication Logic...');
        
        // Create identical issue
        const duplicateIssue = await apiRequest('POST', '/log', newIssue);
        logTest('Duplicate Detection', duplicateIssue.id === issueId, 'Same ID returned for duplicate');
        
        // Create similar issue (should be detected by embeddings)
        const similarIssue = {
            applicationId: TEST_APP_ID,
            message: 'Database timeout error in authentication service',
            context: {
                service: 'auth-service',
                error_code: 'TIMEOUT',
                severity: 'high'
            }
        };
        
        const similarResult = await apiRequest('POST', '/log', similarIssue);
        
        // Wait for embedding processing
        await sleep(3000);
        
        // Check if similar issue was merged or created separately
        const allIssues = await apiRequest('GET', `/log/${TEST_APP_ID}`);
        const authServiceIssues = allIssues.filter(issue => 
            issue.message.toLowerCase().includes('database') && 
            issue.message.toLowerCase().includes('timeout')
        );
        
        logTest('Similar Issue Handling', authServiceIssues.length <= 2, 
            `Found ${authServiceIssues.length} similar issues (expected ≤2)`);
        
        // Test 5: Worker Workflow
        console.log('\n5️⃣ Testing Worker Workflow...');
        
        // Get open issues for workers
        const openIssues = await apiRequest('GET', `/log/${TEST_APP_ID}/open`);
        logTest('Open Issues Available', openIssues.length > 0, `Found ${openIssues.length} open issues`);
        
        if (openIssues.length > 0) {
            const workIssue = openIssues[0];
            
            // Worker picks up issue
            const inProgressUpdate = await apiRequest('PUT', `/log/${TEST_APP_ID}/${workIssue.id}`, {
                state: 'in-progress',
                context: {
                    ...workIssue.context,
                    worker_id: 'test-worker-001',
                    started_at: new Date().toISOString()
                }
            });
            
            logTest('Mark In-Progress', inProgressUpdate.state === 'in-progress', 
                `State: ${inProgressUpdate.state}`);
            
            // Worker completes issue
            const completedUpdate = await apiRequest('PUT', `/log/${TEST_APP_ID}/${workIssue.id}`, {
                state: 'done',
                context: {
                    ...inProgressUpdate.context,
                    completed_at: new Date().toISOString(),
                    resolution: 'Increased database connection timeout to 30 seconds'
                }
            });
            
            logTest('Mark Complete', completedUpdate.state === 'done', 
                `State: ${completedUpdate.state}`);
        }
        
        // Test 6: Reopen Scenario (Regression)
        console.log('\n6️⃣ Testing Issue Reopening...');
        
        // Create the same issue again (should reopen the done issue)
        const reopenIssue = await apiRequest('POST', '/log', newIssue);
        
        // Wait for processing
        await sleep(2000);
        
        const reopenedIssue = await apiRequest('GET', `/log/${TEST_APP_ID}/${reopenIssue.id}`);
        logTest('Issue Reopening', reopenedIssue.state === 'open', 
            `State: ${reopenedIssue.state}, Reopen Count: ${reopenedIssue.reopen_count || 0}`);
        
        // Test 7: Statistics and Monitoring
        console.log('\n7️⃣ Testing Statistics...');
        
        const stats = await apiRequest('GET', `/log/${TEST_APP_ID}/statistics`);
        logTest('Statistics Available', !!stats.statistics, 'Statistics object exists');
        
        const totalIssues = Object.values(stats.statistics).reduce((sum, state) => 
            sum + (state.count || 0), 0);
        logTest('Issue Count Tracking', totalIssues > 0, `Total issues: ${totalIssues}`);
        
        // Test 8: Blacklist Functionality
        console.log('\n8️⃣ Testing Blacklist...');
        
        const blacklistTest = await apiRequest('POST', '/blacklist/test', {
            message: 'Critical database connection timeout'
        });
        
        logTest('Blacklist Test', typeof blacklistTest.isBlacklisted === 'boolean', 
            `Blacklisted: ${blacklistTest.isBlacklisted}`);
        
        // Test 9: Embedding Search
        console.log('\n9️⃣ Testing Embedding Search...');
        
        try {
            const searchResult = await apiRequest('POST', `/embedding/search/${TEST_APP_ID}`, {
                query: 'database timeout authentication',
                limit: 5
            });
            
            logTest('Embedding Search', Array.isArray(searchResult), 
                `Found ${searchResult.length} similar logs`);
        } catch (error) {
            logTest('Embedding Search', false, error.message);
        }
        
        // Test 10: Final State Verification
        console.log('\n🔟 Final State Verification...');
        
        const finalStats = await apiRequest('GET', `/log/${TEST_APP_ID}/statistics`);
        const finalEmbeddingStatus = await apiRequest('GET', '/embedding/status');
        
        logTest('Final Statistics', !!finalStats.statistics, 'Statistics available');
        logTest('Embedding Processing', finalEmbeddingStatus.logsProcessed > 0, 
            `Processed ${finalEmbeddingStatus.logsProcessed} logs`);
        
        console.log('\n📊 Test Results Summary:');
        console.log(`✅ Passed: ${testResults.passed}`);
        console.log(`❌ Failed: ${testResults.failed}`);
        console.log(`📈 Success Rate: ${Math.round((testResults.passed / (testResults.passed + testResults.failed)) * 100)}%`);
        
        if (testResults.failed === 0) {
            console.log('\n🎉 All tests passed! LogSink is working correctly.');
            console.log('\n✅ Verified Functionality:');
            console.log('   • Issue creation with proper state management');
            console.log('   • Embedding generation and processing');
            console.log('   • Intelligent deduplication');
            console.log('   • Worker workflow support');
            console.log('   • Issue reopening for regressions');
            console.log('   • Statistics and monitoring');
            console.log('   • Blacklist filtering');
            console.log('   • Semantic search capabilities');
        } else {
            console.log('\n⚠️  Some tests failed. Check the details above.');
        }
        
        console.log('\n🌐 Access Points:');
        console.log(`   • API: ${API_BASE}`);
        console.log(`   • Web UI: file:///D:/Test/logsink/scripts/web-ui.html`);
        console.log(`   • Health: ${API_BASE}/health`);
        console.log(`   • OpenAPI: ${API_BASE}/openapi.json`);
        
    } catch (error) {
        console.error('❌ Test suite failed:', error.message);
        process.exit(1);
    }
}

// Run comprehensive test
comprehensiveTest().catch(console.error);
