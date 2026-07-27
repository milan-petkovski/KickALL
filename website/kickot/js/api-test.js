/**
 * API Test Script for Kickot Dashboard
 * Test Kick API connectivity and CORS handling
 */

(async function testKickAPI() {
    'use strict';
    
    console.log('🧪 Testing Kick API Connectivity for Kickot...');
    
    const tests = [
        {
            name: 'Direct Kick API (will fail due to CORS)',
            url: 'https://kick.com/api/v2/channels/Milan_567',
            expectedToFail: true
        },
        {
            name: 'Backend API Proxy',
            url: '/api/proxy',
            method: 'POST',
            body: JSON.stringify({
                targetUrl: 'https://kick.com/api/v2/channels/Milan_567',
                method: 'GET'
            }),
            expectedToFail: false
        },
        {
            name: 'Backend Channel Endpoint',
            url: '/api/kick/channel?channel=Milan_567',
            expectedToFail: false
        }
    ];
    
    const results = [];
    
    for (const test of tests) {
        try {
            console.log(`Testing: ${test.name}`);
            console.log(`URL: ${test.url}`);
            
            const options = {
                method: test.method || 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            if (test.body) {
                options.body = test.body;
            }
            
            const response = await fetch(test.url, options);
            const status = response.status;
            const statusText = response.statusText;
            
            let data;
            try {
                data = await response.json();
            } catch (e) {
                data = await response.text();
            }
            
            const success = test.expectedToFail ? !response.ok : response.ok;
            
            results.push({
                name: test.name,
                url: test.url,
                status,
                statusText,
                success,
                data: success ? data : null,
                error: success ? null : data
            });
            
            console.log(`✅ Status: ${status} ${statusText}`);
            console.log(`📊 Success: ${success}`);
            
            if (success && data) {
                console.log(`📦 Data:`, data);
            }
            
        } catch (error) {
            results.push({
                name: test.name,
                url: test.url,
                success: false,
                error: error.message
            });
            
            console.log(`❌ Error: ${error.message}`);
        }
        
        console.log('---');
    }
    
    // Summary
    console.log('📋 TEST SUMMARY:');
    console.log('================');
    
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`Total Tests: ${results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    
    results.forEach((result, index) => {
        console.log(`${index + 1}. ${result.name}: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
        if (!result.success) {
            console.log(`   Error: ${result.error || result.statusText}`);
        }
    });
    
    // Return results for programmatic use
    window.KickotAPITest = {
        results,
        passed,
        failed,
        timestamp: new Date().toISOString()
    };
    
    console.log('🎯 Test results available in window.KickotAPITest');
    
})();
