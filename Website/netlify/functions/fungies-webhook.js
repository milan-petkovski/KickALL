const crypto = require('crypto');

const DEFAULT_OFFER_TIER_MAP = {
  // Pro Monthly Offer & Product ID
  'bedbc1aa-e5ef-4402-9a6b-e7236823a40d': { tier: 'pro', period: 'monthly' },
  '87a918a2-aa51-4ae2-a25e-26fbb1463116': { tier: 'pro', period: 'monthly' },
  '62d7b40f-45a0-413a-b967-d38ac97c4872': { tier: 'pro', period: 'monthly' },

  // Pro Yearly Offer & Product ID
  '16459e35-8c70-4cdc-b158-d1f492e5628f': { tier: 'pro', period: 'yearly' },
  'c38064aa-91ed-4d7a-881c-e11c84738334': { tier: 'pro', period: 'yearly' },

  // Elite Monthly Offer & Product ID
  '6478510e-150f-4069-9ac4-7c918c97f676': { tier: 'elite', period: 'monthly' },
  '59663b1c-913b-423f-958a-14af4663302a': { tier: 'elite', period: 'monthly' },

  // Elite Yearly Offer & Product ID
  'f66a25f4-53b5-4cd7-9012-5454f4761d47': { tier: 'elite', period: 'yearly' },
  '5fef2ac1-1f21-4f3c-a3cc-16a4bde51807': { tier: 'elite', period: 'yearly' }
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

function timingSafeEqualHex(a, b) {
  if (!a || !b) return false;
  try {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
  } catch (_) {
    return false;
  }
}

function verifyFungiesSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  const cleanHeader = String(signatureHeader).trim();
  const hexSignature = cleanHeader.startsWith('sha256_')
    ? cleanHeader.substring(7)
    : cleanHeader;

  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody || '', 'utf8').digest('hex');

  // Match either "sha256_<hex>" or plain "<hex>"
  const expectedWithPrefix = `sha256_${expectedHex}`;

  return timingSafeEqualHex(cleanHeader, expectedWithPrefix) || timingSafeEqualHex(hexSignature, expectedHex);
}

function safeJsonParse(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch (_) {
    return null;
  }
}

function normalizeEventType(payload) {
  return String(
    payload?.event ||
    payload?.event_type ||
    payload?.type ||
    payload?.name ||
    ''
  ).toLowerCase().trim();
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const maskedUser = user.length > 2 ? `${user[0]}***${user[user.length - 1]}` : '***';
  return `${maskedUser}@${domain}`;
}

function resolvePlanTier(offerOrProductId) {
  if (!offerOrProductId) return { tier: 'free', period: null };

  const id = String(offerOrProductId).trim().toLowerCase();

  // Check env overrides
  if (process.env.FUNGIES_OFFER_PRO_MONTHLY && id === process.env.FUNGIES_OFFER_PRO_MONTHLY.toLowerCase()) {
    return { tier: 'pro', period: 'monthly' };
  }
  if (process.env.FUNGIES_OFFER_PRO_YEARLY && id === process.env.FUNGIES_OFFER_PRO_YEARLY.toLowerCase()) {
    return { tier: 'pro', period: 'yearly' };
  }
  if (process.env.FUNGIES_OFFER_ELITE_MONTHLY && id === process.env.FUNGIES_OFFER_ELITE_MONTHLY.toLowerCase()) {
    return { tier: 'elite', period: 'monthly' };
  }
  if (process.env.FUNGIES_OFFER_ELITE_YEARLY && id === process.env.FUNGIES_OFFER_ELITE_YEARLY.toLowerCase()) {
    return { tier: 'elite', period: 'yearly' };
  }

  return DEFAULT_OFFER_TIER_MAP[id] || { tier: 'free', period: null };
}

function extractEntityData(payload) {
  const data = payload?.data || payload?.subscription || payload?.order || payload?.payment || {};
  const customFields = data?.customFields || data?.custom_fields || payload?.customFields || payload?.custom_fields || {};
  const metadata = data?.metadata || payload?.metadata || {};
  const customer = data?.customer || payload?.customer || {};

  const clientReferenceId = String(
    data?.client_reference_id ||
    data?.clientReferenceId ||
    payload?.client_reference_id ||
    payload?.clientReferenceId ||
    customFields?.user_id ||
    customFields?.userId ||
    metadata?.user_id ||
    metadata?.userId ||
    ''
  ).trim();

  const customerEmail = String(
    data?.customer_email ||
    data?.customerEmail ||
    customer?.email ||
    customer?.email_address ||
    payload?.customer_email ||
    ''
  ).trim().toLowerCase();

  const offerId = String(
    data?.offer_id ||
    data?.offerId ||
    data?.plan_id ||
    data?.planId ||
    data?.product_id ||
    data?.productId ||
    data?.item_id ||
    payload?.offer_id ||
    ''
  ).trim();

  const subscriptionId = String(
    data?.subscription_id ||
    data?.subscriptionId ||
    data?.id ||
    payload?.subscription_id ||
    ''
  ).trim();

  return {
    clientReferenceId,
    customerEmail,
    offerId,
    subscriptionId,
    data
  };
}

function buildProfilePayload(targetPlan, targetPeriod, targetStatus) {
  const isCancelled = targetStatus === 'canceled' || targetStatus === 'cancelled' || targetPlan === 'free';

  return {
    updated_at: new Date().toISOString(),
    plan: isCancelled ? 'free' : targetPlan,
    plan_tier: isCancelled ? 'free' : targetPlan,
    subscription_status: isCancelled ? 'canceled' : 'active',
    plan_period: isCancelled ? null : targetPeriod
  };
}

async function findUserProfile(supabaseUrl, supabaseKey, userId, email) {
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`
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
  }

  return { ok: false, errorText: lastErrorText };
}

async function notifyBot(renderBotApiBase, internalSecret, payload) {
  if (!renderBotApiBase) return;

  try {
    await fetch(`${renderBotApiBase}/api/internal/subscription-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret || ''
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn('[Fungies Webhook] Failed to notify bot backend:', error.message);
  }
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

  const secret = process.env.FUNGIES_WEBHOOK_SECRET || process.env.FUNGIES_SECRET_KEY;
  if (!secret) {
    console.error('[Fungies Webhook] FUNGIES_WEBHOOK_SECRET not configured');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Webhook secret is not configured' })
    };
  }
  const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const signatureHeader = getHeader(event.headers, 'x-fngs-signature');

  if (!signatureHeader || !verifyFungiesSignature(rawBody, signatureHeader, secret)) {
    console.warn('[Fungies Webhook] Invalid signature');
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Invalid signature' })
    };
  }

  const payload = safeJsonParse(rawBody);
  if (!payload) {
    console.error('[Fungies Webhook] Invalid JSON payload');
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON payload' })
    };
  }

  const eventType = normalizeEventType(payload);
  const { clientReferenceId, customerEmail, offerId, subscriptionId } = extractEntityData(payload);

  const isCancellation = eventType === 'subscription_cancelled' ||
                         eventType === 'subscription_canceled' ||
                         eventType === 'payment_refunded' ||
                         eventType === 'payment_failed';

  const { tier: planTier, period: planPeriod } = isCancellation
    ? { tier: 'free', period: null }
    : resolvePlanTier(offerId);

  const subscriptionStatus = isCancellation ? 'canceled' : 'active';

  console.log('[Fungies Webhook] Event processed', {
    eventType,
    clientReferenceId: clientReferenceId || null,
    customerEmail: maskEmail(customerEmail),
    offerId: offerId || null,
    planTier,
    planPeriod,
    subscriptionStatus
  });

  if (!supabaseUrl || !supabaseKey) {
    console.warn('[Fungies Webhook] Supabase credentials not configured in environment, returning received confirmation');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true, simulated: true, planTier, clientReferenceId })
    };
  }

  const userProfile = await findUserProfile(supabaseUrl, supabaseKey, clientReferenceId, customerEmail);

  if (!userProfile) {
    console.warn('[Fungies Webhook] User profile not found for reference:', {
      clientReferenceId,
      customerEmail: maskEmail(customerEmail)
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true, userFound: false, manualReview: true })
    };
  }

  const updatePayload = buildProfilePayload(planTier, planPeriod, subscriptionStatus);
  const updateResult = await patchUserProfile(supabaseUrl, supabaseKey, userProfile.id, updatePayload);

  if (!updateResult.ok) {
    console.error('[Fungies Webhook] Failed to update user profile in Supabase:', updateResult.errorText);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Database update failed' })
    };
  }

  // Obavesti Bot pozadinski server radi instant sinhronizacije
  await notifyBot(
    process.env.RENDER_BOT_API_BASE,
    process.env.INTERNAL_API_SECRET,
    {
      userId: userProfile.id,
      plan: updatePayload.plan,
      planTier: updatePayload.plan_tier,
      status: updatePayload.subscription_status,
      period: updatePayload.plan_period,
      source: 'fungies'
    }
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      received: true,
      updated: true,
      userId: userProfile.id,
      plan: updatePayload.plan
    })
  };
};

// Export helpers for unit testing
exports._test = {
  verifyFungiesSignature,
  normalizeEventType,
  resolvePlanTier,
  extractEntityData,
  buildProfilePayload,
  getHeader
};
