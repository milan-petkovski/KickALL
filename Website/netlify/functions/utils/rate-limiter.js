// Shared Rate Limiter Module for Netlify Functions
// Supports persistent rate limiting via Supabase REST API / RPC with in-memory fallback.

const inMemoryMap = new Map();

/**
 * Checks whether a client IP has exceeded the rate limit.
 * 
 * @param {string} clientIp 
 * @param {object} options 
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000 ms)
 * @param {number} options.maxRequests - Max requests allowed in the window (default: 30)
 * @param {string} options.endpoint - Optional endpoint identifier for granular limits
 * @returns {Promise<boolean>} true if rate limited, false otherwise
 */
async function isRateLimited(clientIp, options = {}) {
  const windowMs = options.windowMs || 60000;
  const maxRequests = options.maxRequests || 30;
  const endpoint = options.endpoint || 'global';

  if (!clientIp || clientIp === '127.0.0.1' || clientIp === 'localhost' || clientIp === '::1' || clientIp.includes('127.0.0.1')) {
    return false;
  }

  const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const now = Date.now();
      const headers = {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      };

      const key = `${clientIp}:${endpoint}`;
      
      // 1. Try atomic Supabase RPC call first to prevent TOCTOU race conditions
      const rpcUrl = `${supabaseUrl}/rest/v1/rpc/check_rate_limit`;
      const rpcRes = await fetch(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_key: key,
          p_window_ms: windowMs,
          p_max_requests: maxRequests
        })
      });

      if (rpcRes.ok) {
        const result = await rpcRes.json();
        if (typeof result === 'boolean') return result;
        if (result && typeof result.is_limited === 'boolean') return result.is_limited;
      }

      // 2. Fallback REST table approach if RPC function is not yet created in Postgres
      const queryUrl = `${supabaseUrl}/rest/v1/rate_limits?key=eq.${encodeURIComponent(key)}&select=*`;
      const res = await fetch(queryUrl, { headers: { ...headers, 'Prefer': 'return=representation' } });
      
      if (res.ok) {
        const records = await res.json();
        const record = records && records[0] ? records[0] : null;

        if (record) {
          const windowStart = Number(record.window_start) || 0;
          if (now - windowStart < windowMs) {
            if (record.request_count >= maxRequests) {
              return true;
            }
            // Increment count
            const patchUrl = `${supabaseUrl}/rest/v1/rate_limits?key=eq.${encodeURIComponent(key)}`;
            await fetch(patchUrl, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                request_count: record.request_count + 1,
                updated_at: new Date(now).toISOString()
              })
            });
            return false;
          }
        }

        // Insert or reset record
        const upsertUrl = `${supabaseUrl}/rest/v1/rate_limits`;
        await fetch(upsertUrl, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({
            key: key,
            request_count: 1,
            window_start: now,
            updated_at: new Date(now).toISOString()
          })
        });
        return false;
      }
    } catch (err) {
      console.warn('[RateLimiter] Supabase rate limit check failed, falling back to in-memory:', err.message);
    }
  }

  // 3. Fallback: In-memory rate limiting
  const now = Date.now();
  const key = `${clientIp}:${endpoint}`;
  const history = (inMemoryMap.get(key) || []).filter(t => now - t < windowMs);
  
  if (history.length >= maxRequests) {
    return true;
  }

  history.push(now);
  inMemoryMap.set(key, history);

  // Periodic cleanup
  if (inMemoryMap.size > 1000) {
    for (const [k, hist] of inMemoryMap.entries()) {
      if (hist.length === 0 || now - hist[hist.length - 1] > windowMs) {
        inMemoryMap.delete(k);
      }
    }
  }

  return false;
}

module.exports = {
  isRateLimited
};
