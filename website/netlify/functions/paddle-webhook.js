const crypto = require('crypto');

const PRICE_TIER_MAP = {
  pro: {
    monthly: process.env.PADDLE_PRICE_PRO_MONTHLY || '',
    yearly: process.env.PADDLE_PRICE_PRO_YEARLY || ''
  },
  elite: {
    monthly: process.env.PADDLE_PRICE_ELITE_MONTHLY || '',
    yearly: process.env.PADDLE_PRICE_ELITE_YEARLY || ''
  }
};

function getHeader(headers, name) {
  if (!headers) return '';
  const target = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === target) {
      return headers[key] || '';
    }
  }
  return '';
}

function parsePaddleSignature(headerValue) {
  const result = {};
  const parts = String(headerValue || '').split(/[;,]/);

  for (const part of parts) {
    const [key, ...valueParts] = String(part).trim().split('=');
    if (!key || valueParts.length === 0) continue;
    result[key.trim()] = valueParts.join('=').trim();
  }

  return {
    ts: result.ts || result.timestamp || '',
    h1: result.h1 || result.signature || ''
  };
}

function timingSafeEqualHex(a, b) {
  if (!a || !b) return false;

  try {
    const aBuffer = Buffer.from(a, 'hex');
    const bBuffer = Buffer.from(b, 'hex');
    return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
  } catch (_) {
    return false;
  }
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const maskedUser = user.length > 2 ? `${user[0]}***${user[user.length - 1]}` : '***';
  return `${maskedUser}@${domain}`;
}

function verifySignature(rawBody, signatureHeader, secret) {
  const { ts, h1 } = parsePaddleSignature(signatureHeader);
  if (!ts || !h1 || !secret) return false;

  const payload = `${ts}:${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return timingSafeEqualHex(expected, h1);
}

function safeJsonParse(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch (error) {
    return null;
  }
}

function normalizeEventType(payload) {
  return String(
    payload?.event_type ||
    payload?.eventType ||
    payload?.type ||
    payload?.meta?.event_name ||
    ''
  ).toLowerCase();
}

function getSubscriptionData(payload) {
  return payload?.data || payload?.subscription || {};
}

function getCustomerData(payload, data) {
  return data?.customer || payload?.customer || {};
}

function getCustomData(payload, data) {
  return data?.custom_data || payload?.custom_data || payload?.meta?.custom_data || {};
}

function getSubscriptionId(data) {
  return String(
    data?.id ||
    data?.subscription_id ||
    data?.subscription?.id ||
    ''
  );
}

function getPriceId(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const firstItem = items[0] || {};
  return String(
    firstItem?.price?.id ||
    firstItem?.price_id ||
    firstItem?.priceId ||
    data?.price?.id ||
    data?.price_id ||
    ''
  );
}

function getPlanTierFromPriceId(priceId) {
  if (!priceId) return 'free';

  for (const [tier, periods] of Object.entries(PRICE_TIER_MAP)) {
    for (const mappedPriceId of Object.values(periods)) {
      if (mappedPriceId && String(mappedPriceId) === String(priceId)) {
        return tier;
      }
    }
  }

  return 'free';
}

async function findUserByIdOrEmail(supabaseUrl, supabaseKey, userId, email) {
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: 'application/json'
  };

  if (userId) {
    const byId = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}&select=*`, { headers });
    if (byId.ok) {
      const rows = await byId.json();
      if (Array.isArray(rows) && rows.length > 0) return rows[0];
    }
  }

  if (email) {
    const byEmail = await fetch(`${supabaseUrl}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=*`, { headers });
    if (byEmail.ok) {
      const rows = await byEmail.json();
      if (Array.isArray(rows) && rows.length > 0) return rows[0];
    }
  }

  return null;
}

function buildProfilePayload(basePayload, existingProfile, eventType) {
  const targetPlan = basePayload.plan_tier || 'free';
  const targetStatus = basePayload.subscription_status || 'active';
  const targetPlanPeriod = basePayload.plan_period || null;
  const targetSubscriptionId = basePayload.paddle_subscription_id || null;
  const targetCustomerId = basePayload.paddle_customer_id || null;
  const targetPriceId = basePayload.paddle_price_id || null;

  const nextPayload = {
    updated_at: new Date().toISOString()
  };

  if (typeof existingProfile?.plan !== 'undefined' && existingProfile.plan !== basePayload.plan) {
    nextPayload.plan = basePayload.plan;
  } else if (typeof existingProfile?.plan === 'undefined') {
    nextPayload.plan = basePayload.plan;
  }

  if (typeof existingProfile?.subscription_status !== 'undefined' && existingProfile.subscription_status !== targetStatus) {
    nextPayload.subscription_status = targetStatus;
  } else if (typeof existingProfile?.subscription_status === 'undefined') {
    nextPayload.subscription_status = targetStatus;
  }

  if (typeof existingProfile?.plan_period !== 'undefined' && targetPlanPeriod !== existingProfile.plan_period) {
    nextPayload.plan_period = targetPlanPeriod;
  }

  if (targetStatus === 'canceled' || targetStatus === 'cancelled' || targetStatus === 'free') {
    if (typeof existingProfile?.plan !== 'undefined' && existingProfile.plan !== 'free') {
      nextPayload.plan = 'free';
    } else if (typeof existingProfile?.plan === 'undefined') {
      nextPayload.plan = 'free';
    }

    if (typeof existingProfile?.plan_tier !== 'undefined' && existingProfile.plan_tier !== 'free') {
      nextPayload.plan_tier = 'free';
    }
  } else {
    if (typeof existingProfile?.plan_tier !== 'undefined' && existingProfile.plan_tier !== targetPlan) {
      nextPayload.plan_tier = targetPlan;
    }

    if (typeof existingProfile?.plan_tier === 'undefined' && targetPlan !== 'free') {
      nextPayload.plan_tier = targetPlan;
    }
  }

  if (targetSubscriptionId) {
    nextPayload.paddle_subscription_id = targetSubscriptionId;
  }

  if (targetCustomerId) {
    nextPayload.paddle_customer_id = targetCustomerId;
  }

  if (targetPriceId) {
    nextPayload.paddle_price_id = targetPriceId;
  }

  if (eventType === 'subscription.canceled' || eventType === 'subscription.cancelled') {
    nextPayload.subscription_status = 'canceled';
    nextPayload.plan = 'free';
    nextPayload.plan_tier = 'free';
  }

  return nextPayload;
}

async function patchUserProfile(supabaseUrl, supabaseKey, userId, payload) {
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };

  const attempts = [
    payload,
    {
      updated_at: payload.updated_at,
      plan: payload.plan,
      subscription_status: payload.subscription_status,
      plan_period: payload.plan_period
    }
  ];

  let lastErrorText = '';

  for (const attemptPayload of attempts) {
    const response = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(attemptPayload)
    });

    if (response.ok) {
      return { ok: true, payload: attemptPayload };
    }

    lastErrorText = await response.text();
    if (!/column|schema|plan_tier|paddle_subscription_id|paddle_customer_id|paddle_price_id/i.test(lastErrorText)) {
      break;
    }
  }

  return { ok: false, errorText: lastErrorText };
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://kickall.app'
  };

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!secret) {
    console.error('[Paddle Webhook] Missing PADDLE_WEBHOOK_SECRET');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Webhook secret not configured' })
    };
  }

  if (!supabaseUrl || !supabaseKey) {
    console.error('[Paddle Webhook] Missing Supabase configuration');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Supabase configuration missing' })
    };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const signatureHeader = getHeader(event.headers, 'Paddle-Signature');

  if (!signatureHeader || !verifySignature(rawBody, signatureHeader, secret)) {
    console.warn('[Paddle Webhook] Invalid signature');
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Invalid signature' })
    };
  }

  const payload = safeJsonParse(rawBody);
  if (!payload) {
    console.error('[Paddle Webhook] Invalid JSON payload');
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON payload' })
    };
  }

  const eventType = normalizeEventType(payload);
  const data = getSubscriptionData(payload);
  const subscriptionId = getSubscriptionId(data);
  const customer = getCustomerData(payload, data);
  const customData = getCustomData(payload, data);
  const customerEmail = String(customer?.email || customer?.email_address || payload?.customer_email || '').trim().toLowerCase();
  const customUserId = String(customData?.user_id || customData?.userId || payload?.meta?.custom_data?.user_id || '').trim();
  const priceId = getPriceId(data);
  const planTier = eventType === 'subscription.canceled' || eventType === 'subscription.cancelled'
    ? 'free'
    : getPlanTierFromPriceId(priceId);
  const planPeriod = priceId && PRICE_TIER_MAP[planTier]
    ? (PRICE_TIER_MAP[planTier].monthly === priceId ? 'monthly' : PRICE_TIER_MAP[planTier].yearly === priceId ? 'yearly' : null)
    : null;

  if (
    (eventType === 'subscription.created' || eventType === 'subscription.updated') &&
    (!priceId || planTier === 'free')
  ) {
    console.warn('[Paddle Webhook] Unknown price ID, manual review required', {
      eventType,
      subscriptionId: subscriptionId || null,
      priceId
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true, manualReview: true, reason: 'unknown_price_id' })
    };
  }

  console.log('[Paddle Webhook] Event received', {
    eventType,
    subscriptionId: subscriptionId || null,
    customerEmail: maskEmail(customerEmail),
    customUserId: customUserId || null,
    priceId: priceId || null
  });

  const user = await findUserByIdOrEmail(supabaseUrl, supabaseKey, customUserId, customerEmail);

  if (!user) {
    console.error('[Paddle Webhook] User not found for event', {
      eventType,
      subscriptionId: subscriptionId || null,
      customerEmail: maskEmail(customerEmail),
      customUserId: customUserId || null
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true, manualReview: true, reason: 'user_not_found' })
    };
  }

  const currentProfile = user || {};
  const targetStatus = (() => {
    if (eventType === 'subscription.canceled' || eventType === 'subscription.cancelled') return 'canceled';
    if (eventType === 'subscription.updated') {
      return String(data?.status || data?.state || currentProfile.subscription_status || 'active').toLowerCase();
    }
    if (eventType === 'transaction.completed') {
      return String(currentProfile.subscription_status || 'active').toLowerCase();
    }
    return 'active';
  })();

  const targetPlan = targetStatus === 'canceled' ? 'free' : planTier;
  const targetPlanForSchema = targetPlan === 'free' ? 'free' : targetPlan;
  const targetPayload = buildProfilePayload(
    {
      plan: targetPlanForSchema,
      plan_tier: targetPlanForSchema,
      plan_period: targetStatus === 'canceled' ? null : planPeriod,
      subscription_status: targetStatus,
      paddle_subscription_id: subscriptionId || currentProfile.paddle_subscription_id || null,
      paddle_customer_id: String(customer?.id || data?.customer_id || payload?.data?.customer_id || '').trim() || null,
      paddle_price_id: priceId || null
    },
    currentProfile,
    eventType
  );

  const sameSubscription = String(currentProfile.paddle_subscription_id || '') === String(subscriptionId || currentProfile.paddle_subscription_id || '');
  const sameStatus = String(currentProfile.subscription_status || '').toLowerCase() === String(targetStatus || '').toLowerCase();
  const samePlan = String(currentProfile.plan || '').toLowerCase() === String(targetPlanForSchema || '').toLowerCase();
  const sameTier = typeof currentProfile.plan_tier === 'undefined'
    ? true
    : String(currentProfile.plan_tier || '').toLowerCase() === String(targetPlanForSchema || '').toLowerCase();

  if (sameSubscription && sameStatus && samePlan && sameTier && eventType !== 'transaction.completed') {
    console.log('[Paddle Webhook] Idempotent skip', {
      eventType,
      subscriptionId: subscriptionId || null,
      userId: user.id
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true, handled: true, skipped: true })
    };
  }

  if (eventType === 'transaction.completed') {
    console.log('[Paddle Webhook] Transaction completed', {
      subscriptionId: subscriptionId || null,
      userId: user.id,
      priceId: priceId || null
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true, handled: true, logged: true })
    };
  }

  const updateResult = await patchUserProfile(supabaseUrl, supabaseKey, user.id, targetPayload);

  if (!updateResult.ok) {
    console.error('[Paddle Webhook] Failed to update user profile', {
      eventType,
      subscriptionId: subscriptionId || null,
      userId: user.id,
      error: updateResult.errorText
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true, handled: false, manualReview: true, reason: 'update_failed' })
    };
  }

  console.log('[Paddle Webhook] Profile updated successfully', {
    eventType,
    subscriptionId: subscriptionId || null,
    userId: user.id,
    status: targetPayload.subscription_status,
    plan: targetPayload.plan || targetPlanForSchema
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ received: true, handled: true, userId: user.id })
  };
};

// Eksport za unit testove
exports.verifySignature = verifySignature;
exports.parsePaddleSignature = parsePaddleSignature;
exports.maskEmail = maskEmail;
exports.safeJsonParse = safeJsonParse;
exports.normalizeEventType = normalizeEventType;