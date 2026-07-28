/**
 * Unified API Test Script for KickALL
 * Tests all API endpoints with comprehensive reporting
 */

const API_TESTS = [
    {
        name: 'Kick API v2 Channel',
        endpoint: 'https://kick.com/api/v2/channels/Milan_567',
        method: 'GET',
        icon: '📺',
        description: 'Kick API v2 channel endpoint',
        featured: true,
        directAPI: true
    },
    {
        name: 'Kick OAuth Generate URL',
        endpoint: 'Kick OAuth URL Generator',
        method: 'INTERNAL',
        icon: '🔐',
        description: 'Generate OAuth authorization URL',
        featured: true,
        internal: true,
        oauthTest: true
    },
    {
        name: 'CORS Proxy (CorsProxy.io)',
        endpoint: 'https://corsproxy.io/?' + encodeURIComponent('https://kick.com/api/v2/channels/Milan_567'),
        method: 'GET',
        icon: '🌐',
        description: 'CorsProxy.io test',
        corsProxy: true
    },
    {
        name: 'Kickbot Backend',
        endpoint: 'https://kickbot-ihzb.onrender.com/api/kick/test-ping',
        method: 'GET',
        icon: '🤖',
        description: 'Kickbot backend connectivity'
    },
    {
        name: 'Kickbot Channel API',
        endpoint: 'https://kickbot-ihzb.onrender.com/api/kick/channel?username=Milan_567',
        method: 'GET',
        icon: '📺',
        description: 'Kickbot channel endpoint'
    },
    {
        name: 'Kickbot Avatar API',
        endpoint: 'https://kickbot-ihzb.onrender.com/api/avatar?username=Milan_567',
        method: 'GET',
        icon: '🖼️',
        description: 'Kickbot avatar endpoint'
    },
    {
        name: 'Kickbot Stats API',
        endpoint: 'https://kickbot-ihzb.onrender.com/api/stats',
        method: 'GET',
        icon: '📊',
        description: 'Kickbot statistics endpoint'
    }
];

class APITester {
    constructor() {
        this.results = [];
        this.isRunning = false;
    }

    async runAllTests() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.results = [];
        const startTime = Date.now();
        
        // Clear previous results
        document.getElementById('testGrid').innerHTML = '';
        const secondaryGrid = document.getElementById('secondaryGrid');
        if (secondaryGrid) {
            secondaryGrid.innerHTML = '';
        }
        document.getElementById('summary').style.display = 'block';
        
        // Separate featured and secondary tests
        const featuredTests = API_TESTS.filter(test => test.featured);
        const secondaryTests = API_TESTS.filter(test => !test.featured);
        
        // Create featured test cards
        featuredTests.forEach((test, index) => {
            this.createTestCard(test, index, true);
        });
        
        // Create secondary test cards
        secondaryTests.forEach((test, index) => {
            this.createTestCard(test, index, false);
        });
        
        // Run featured tests first
        for (let i = 0; i < featuredTests.length; i++) {
            const test = featuredTests[i];
            await this.runTest(test, i, true);
            
            // Small delay between tests
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Run secondary tests
        for (let i = 0; i < secondaryTests.length; i++) {
            const test = secondaryTests[i];
            await this.runTest(test, i, false);
            
            // Small delay between tests
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        const duration = Date.now() - startTime;
        this.updateSummary(duration);
        this.isRunning = false;
    }

    createTestCard(test, index, isFeatured) {
        const card = document.createElement('div');
        card.className = 'test-card' + (isFeatured ? ' featured' : '');
        card.id = `test-card-${isFeatured ? 'featured-' : ''}${index}`;
        
        const iconSVG = this.getIconSVG(test.icon);
        
        let featuredBadge = '';
        if (isFeatured) {
            featuredBadge = '<div class="featured-badge">⭐ Featured</div>';
        }
        
        // Truncate endpoint if too long
        let displayEndpoint = test.endpoint;
        if (displayEndpoint.length > 60) {
            displayEndpoint = displayEndpoint.substring(0, 60) + '...';
        }
        
        card.innerHTML = `
            ${featuredBadge}
            <div class="test-header">
                <div class="test-icon">${iconSVG}</div>
                <div class="test-info">
                    <div class="test-name">${test.name}</div>
                    <div class="test-endpoint" title="${test.endpoint}">${displayEndpoint}</div>
                </div>
            </div>
            <div class="test-status">
                <span class="status-badge pending"><span>Pending</span></span>
            </div>
            <div class="test-details" id="test-details-${isFeatured ? 'featured-' : ''}${index}" style="display: none;">
                <pre></pre>
            </div>
        `;
        
        const gridId = isFeatured ? 'testGrid' : 'secondaryGrid';
        const gridElement = document.getElementById(gridId);
        if (gridElement) {
            gridElement.appendChild(card);
        }
    }

    getIconSVG(icon) {
        const icons = {
            '📺': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>',
            '🔐': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
            '🌐': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
            '🤖': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>',
            '👤': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
            '🖼️': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
            '📊': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>'
        };
        
        return icons[icon] || icons['📊'];
    }

    async runTest(test, index, isFeatured) {
        const cardId = `test-card-${isFeatured ? 'featured-' : ''}${index}`;
        const detailsId = `test-details-${isFeatured ? 'featured-' : ''}${index}`;
        
        const card = document.getElementById(cardId);
        const statusBadge = card.querySelector('.status-badge');
        const detailsDiv = document.getElementById(detailsId);
        
        // Update to loading
        card.classList.add('loading');
        statusBadge.className = 'status-badge loading';
        statusBadge.innerHTML = '<div class="loading-spinner"></div><span>Loading</span>';
        
        let result;
        
        try {
            if (test.method === 'INTERNAL') {
                result = await this.runInternalTest(test);
            } else {
                result = await this.runAPITest(test);
            }
            
            // Update result
            card.classList.remove('loading');
            
            if (result.success) {
                card.classList.add('success');
                statusBadge.className = 'status-badge success';
                statusBadge.innerHTML = '<span>✓ Success</span>';
            } else {
                card.classList.add('error');
                statusBadge.className = 'status-badge error';
                statusBadge.innerHTML = '<span>✗ Failed</span>';
            }
            
            // Show details
            detailsDiv.style.display = 'block';
            detailsDiv.querySelector('pre').textContent = this.formatResult(result);
            
        } catch (error) {
            card.classList.remove('loading');
            card.classList.add('error');
            statusBadge.className = 'status-badge error';
            statusBadge.innerHTML = '<span>✗ Error</span>';
            
            detailsDiv.style.display = 'block';
            detailsDiv.querySelector('pre').textContent = `Exception: ${error.message}`;
            
            result = {
                name: test.name,
                endpoint: test.endpoint,
                success: false,
                error: error.message,
                duration: 0
            };
        }
        
        this.results.push(result);
    }

    async runAPITest(test) {
        let url;
        let options = {
            method: test.method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        // Check if URL is too long and needs CORS proxy
        const useCorsProxy = test.endpoint.length > 2000 || test.corsProxy;
        
        if (useCorsProxy && !test.endpoint.includes('api.allorigins.win') && !test.endpoint.includes('corsproxy.io')) {
            // Use AllOrigins proxy for long URLs
            url = `https://api.allorigins.win/get?url=${encodeURIComponent(test.endpoint)}`;
        } else if (test.directAPI || test.corsProxy) {
            // Direct API call or CORS proxy - use full URL
            url = test.endpoint;
        } else if (test.backendProxy) {
            // Backend proxy - use relative URL
            url = new URL(test.endpoint, window.location.origin);
            if (test.body) {
                options.body = JSON.stringify(test.body);
            }
        } else {
            // Standard API call
            url = new URL(test.endpoint, window.location.origin);
        }
        
        // Add query parameters for standard API calls
        if (test.params && !test.directAPI && !test.corsProxy && !useCorsProxy) {
            Object.keys(test.params).forEach(key => {
                url.searchParams.append(key, test.params[key]);
            });
        }
        
        const startTime = Date.now();
        const response = await fetch(url, options);
        const duration = Date.now() - startTime;
        
        let data;
        let errorData = null;
        
        try {
            // Try to parse as JSON first
            const responseClone = response.clone();
            try {
                data = await response.json();
            } catch (jsonError) {
                // If JSON fails, try text
                try {
                    data = await responseClone.text();
                } catch (textError) {
                    data = 'Unable to read response body';
                }
            }
        } catch (e) {
            data = 'Error reading response: ' + e.message;
        }
        
        // For CORS proxies, check if the proxy itself worked
        if (useCorsProxy && data && typeof data === 'object') {
            if (data.contents) {
                try {
                    const parsedContents = JSON.parse(data.contents);
                    data = { proxySuccess: true, data: parsedContents };
                } catch (e) {
                    data = { proxySuccess: true, data: data.contents };
                }
            }
        }
        
        // If response is not OK, treat data as error
        if (!response.ok) {
            errorData = data;
            data = null;
        }
        
        return {
            name: test.name,
            endpoint: test.endpoint,
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            duration: duration,
            data: data,
            error: errorData,
            usedCorsProxy: useCorsProxy
        };
    }

    async runInternalTest(test) {
        // Test OAuth URL generation
        if (test.oauthTest) {
            try {
                const startTime = Date.now();
                
                // OAuth Configuration from config.js
                const clientId = '01KXN4YW8GF6DPXSC1JMMJ25QN';
                const scope = 'user:read channel:read chat:read chat:write moderation:read moderation:write';
                const redirectUri = `${window.location.origin}/auth/kick/callback/`;
                
                // Generate OAuth state and code verifier
                const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                const codeVerifier = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                
                // Generate OAuth URL
                const oauthUrl = new URL('https://id.kick.com/oauth/authorize');
                oauthUrl.searchParams.append('client_id', clientId);
                oauthUrl.searchParams.append('redirect_uri', redirectUri);
                oauthUrl.searchParams.append('response_type', 'code');
                oauthUrl.searchParams.append('scope', scope);
                oauthUrl.searchParams.append('state', state);
                oauthUrl.searchParams.append('code_challenge', codeVerifier);
                oauthUrl.searchParams.append('code_challenge_method', 'plain');
                
                const duration = Date.now() - startTime;
                
                return {
                    name: test.name,
                    endpoint: oauthUrl.toString(),
                    success: true,
                    data: {
                        oauthUrl: oauthUrl.toString(),
                        state: state,
                        codeVerifier: codeVerifier,
                        redirectUri: redirectUri,
                        scope: scope
                    },
                    duration: duration
                };
            } catch (error) {
                return {
                    name: test.name,
                    endpoint: test.endpoint,
                    success: false,
                    error: error.message,
                    duration: 0
                };
            }
        }
        
        // Test Supabase connection
        if (test.internal) {
            try {
                // Check if Supabase is available
                if (!window.sb) {
                    return {
                        name: test.name,
                        endpoint: test.endpoint,
                        success: false,
                        error: 'Supabase client not available (window.sb is undefined)',
                        duration: 0
                    };
                }
                
                const startTime = Date.now();
                const { data, error } = await window.sb.auth.getSession();
                const duration = Date.now() - startTime;
                
                if (error) {
                    return {
                        name: test.name,
                        endpoint: test.endpoint,
                        success: false,
                        error: error.message,
                        duration: duration
                    };
                }
                
                return {
                    name: test.name,
                    endpoint: test.endpoint,
                    success: true,
                    data: { session: data ? 'Active' : 'None' },
                    duration: duration
                };
            } catch (error) {
                return {
                    name: test.name,
                    endpoint: test.endpoint,
                    success: false,
                    error: error.message,
                    duration: 0
                };
            }
        }
        
        return {
            name: test.name,
            endpoint: test.endpoint,
            success: false,
            error: 'Unknown internal test',
            duration: 0
        };
    }

    formatResult(result) {
        const lines = [];
        lines.push(`Status: ${result.success ? '✓ Success' : '✗ Failed'}`);
        lines.push(`Duration: ${result.duration || 'N/A'}ms`);
        
        if (result.usedCorsProxy) {
            lines.push(`CORS Proxy: ✓ AllOrigins proxy used`);
        }
        
        if (result.status) {
            lines.push(`HTTP Status: ${result.status} ${result.statusText}`);
        }
        
        if (result.data) {
            lines.push('\nResponse Data:');
            let dataString;
            if (typeof result.data === 'object') {
                dataString = JSON.stringify(result.data, null, 2);
            } else {
                dataString = String(result.data);
            }
            
            // Truncate very long responses
            const maxLength = 2000;
            if (dataString.length > maxLength) {
                dataString = dataString.substring(0, maxLength) + '\n... (truncated, ' + (dataString.length - maxLength) + ' more characters)';
            }
            
            lines.push(dataString);
        }
        
        if (result.error) {
            lines.push(`\nError: `);
            let errorString;
            if (typeof result.error === 'object') {
                errorString = JSON.stringify(result.error, null, 2);
            } else {
                errorString = String(result.error);
            }
            
            // Truncate very long error messages
            const maxLength = 1000;
            if (errorString.length > maxLength) {
                errorString = errorString.substring(0, maxLength) + '\n... (truncated, ' + (errorString.length - maxLength) + ' more characters)';
            }
            
            lines.push(errorString);
        }
        
        return lines.join('\n');
    }

    updateSummary(duration) {
        const total = this.results.length;
        const passed = this.results.filter(r => r.success).length;
        const failed = total - passed;
        
        document.getElementById('totalTests').textContent = total;
        document.getElementById('passedTests').textContent = passed;
        document.getElementById('failedTests').textContent = failed;
        document.getElementById('duration').textContent = `${duration}ms`;
        
        const overallStatus = document.getElementById('overallStatus');
        if (failed === 0) {
            overallStatus.className = 'status-badge success';
            overallStatus.textContent = 'All Passed';
        } else if (passed === 0) {
            overallStatus.className = 'status-badge error';
            overallStatus.textContent = 'All Failed';
        } else {
            overallStatus.className = 'status-badge loading';
            overallStatus.textContent = 'Partial';
        }
    }

    clearResults() {
        document.getElementById('testGrid').innerHTML = '';
        const secondaryGrid = document.getElementById('secondaryGrid');
        if (secondaryGrid) {
            secondaryGrid.innerHTML = '';
        }
        document.getElementById('summary').style.display = 'none';
        this.results = [];
    }
}

// Initialize tester
const apiTester = new APITester();

// Global functions
function runAllTests() {
    apiTester.runAllTests();
}

function clearResults() {
    apiTester.clearResults();
}

// Auto-run on page load
window.addEventListener('load', () => {
    console.log('🧪 KickALL API Test Suite loaded');
    console.log('Click "Run All Tests" to begin testing');
});