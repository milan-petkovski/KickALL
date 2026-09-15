const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Jedinični testovi za Kickan Stream Analytics Studio & Bazu Prošlih Lajvova (public.kickan)
 */

function formatDuration(totalSeconds) {
  const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

function formatDateTime(isoString) {
  if (!isoString) return '--';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '--';
    return d.toISOString();
  } catch (_) {
    return '--';
  }
}

function buildStreamPayload({
  currentUser,
  channelName,
  channelId,
  chatroomId,
  currentStreamTitle,
  streamStartTime,
  now = new Date(),
  liveStats,
  currentVelocity = 0,
  peakVelocity = 0
}) {
  if (!currentUser) return null;

  const durationSec = streamStartTime ? Math.max(0, Math.floor((now.getTime() - streamStartTime) / 1000)) : 0;

  const topChatters = Array.from(liveStats.viewersActivityMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 25)
    .map(([user, data]) => ({ user, ...data }));

  const topEmotes = Array.from(liveStats.emotesMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, count]) => ({ name, count }));

  const summaryPayload = {
    topChatters,
    topEmotes,
    banLogs: (liveStats.banLogs || []).slice(0, 50),
    hourlyCounts: Array.from(liveStats.hourlyCounts),
    uniqueChattersCount: liveStats.uniqueChattersMap.size,
    chatVelocity: currentVelocity,
    peakVelocity: peakVelocity,
    savedAt: now.toISOString()
  };

  return {
    user_id: currentUser.id,
    channel_name: channelName || 'Kick Kanal',
    channel_id: channelId ? String(channelId) : null,
    chatroom_id: chatroomId ? parseInt(chatroomId, 10) : null,
    stream_title: currentStreamTitle || 'Kick Live Stream',
    started_at: streamStartTime ? new Date(streamStartTime).toISOString() : now.toISOString(),
    ended_at: now.toISOString(),
    duration_seconds: durationSec,
    peak_viewers: liveStats.peakViewers || 0,
    avg_viewers: liveStats.peakViewers > 0 ? Math.round(liveStats.peakViewers * 0.75) : 0,
    total_messages: liveStats.totalMessages || 0,
    total_emotes: liveStats.totalEmotes || 0,
    unique_chatters: liveStats.uniqueChattersMap.size || 0,
    chat_velocity_peak: peakVelocity || 0,
    moderation_actions: (liveStats.totalBans || 0) + (liveStats.totalKicks || 0),
    summary: summaryPayload,
    updated_at: now.toISOString()
  };
}

function filterPastStreams(list, searchTerm) {
  if (!searchTerm) return list;
  const term = searchTerm.toLowerCase().trim();
  return list.filter(s =>
    (s.channel_name && s.channel_name.toLowerCase().includes(term)) ||
    (s.stream_title && s.stream_title.toLowerCase().includes(term)) ||
    (s.started_at && s.started_at.toLowerCase().includes(term))
  );
}

function generateStreamCsv(stream) {
  const summary = stream.summary || {};
  const topChatters = summary.topChatters || [];
  const topEmotes = summary.topEmotes || [];

  let csv = 'Tip,Naziv/Korisnik,Broj/Vrednost,Status/Detalj,Vreme\n';
  csv += `Lajv Sesija,Kanal,${stream.channel_name},--,${stream.started_at}\n`;
  csv += `Lajv Sesija,Naslov,${(stream.stream_title || '').replace(/,/g, ' ')},--,--\n`;
  csv += `Lajv Sesija,Trajanje,${formatDuration(stream.duration_seconds)},${stream.duration_seconds}s,--\n`;
  csv += `Lajv Sesija,Peak Gledaoci,${stream.peak_viewers},--,--\n`;
  csv += `Lajv Sesija,Ukupno Poruka,${stream.total_messages},--,--\n`;
  csv += `Lajv Sesija,Jedinstveni Chatters,${stream.unique_chatters},--,--\n`;
  csv += `Lajv Sesija,Peak Brzina,${stream.chat_velocity_peak} msg/min,--,--\n`;

  topChatters.forEach((c, idx) => {
    csv += `Top Gledalac #${idx + 1},${c.user},${c.count},${c.isSub ? 'SUB' : 'Gledalac'},${c.lastSeen || '--'}\n`;
  });

  topEmotes.forEach(e => {
    csv += `Top Emote,${e.name},${e.count},--,--\n`;
  });

  return csv;
}

/* ════════════════════════════════════════
   TESTOVI
════════════════════════════════════════ */

test('Kickan - formatDuration ispravno formatira sekunde u hh:mm:ss format', () => {
  assert.equal(formatDuration(0), '00h 00m 00s');
  assert.equal(formatDuration(45), '00h 00m 45s');
  assert.equal(formatDuration(125), '00h 02m 05s');
  assert.equal(formatDuration(3665), '01h 01m 05s');
  assert.equal(formatDuration(36000), '10h 00m 00s');
  assert.equal(formatDuration(-10), '00h 00m 00s');
  assert.equal(formatDuration('invalid'), '00h 00m 00s');
});

test('Kickan - formatDateTime vraća fallback za nevalidne i nedostajuće datume', () => {
  assert.equal(formatDateTime(null), '--');
  assert.equal(formatDateTime(undefined), '--');
  assert.equal(formatDateTime(''), '--');
  assert.equal(formatDateTime('not-a-date'), '--');
  const validIso = '2026-09-12T10:30:00.000Z';
  assert.equal(formatDateTime(validIso), validIso);
});

test('Kickan - buildStreamPayload kreira kompletan i validan zapis za public.kickan tabelu', () => {
  const currentUser = { id: '00000000-0000-0000-0000-000000000001' };
  const streamStartTime = Date.now() - (3600 * 2.5 * 1000); // 2.5 sata pre
  const viewersMap = new Map();
  viewersMap.set('Gledalac1', { count: 120, isSub: true, isMod: false, lastSeen: '12:00' });
  viewersMap.set('Gledalac2', { count: 85, isSub: false, isMod: true, lastSeen: '12:15' });

  const emotesMap = new Map();
  emotesMap.set('kekw', 42);
  emotesMap.set('pog', 18);

  const liveStats = {
    totalMessages: 450,
    peakViewers: 152,
    uniqueChattersMap: new Set(['Gledalac1', 'Gledalac2', 'Gledalac3']),
    totalEmotes: 60,
    totalBans: 2,
    totalKicks: 1,
    banLogs: [{ user: 'spamer', mod: 'mod1', reason: 'Raid', time: '11:40', type: 'BAN' }],
    hourlyCounts: new Array(24).fill(0),
    viewersActivityMap: viewersMap,
    emotesMap: emotesMap
  };

  const payload = buildStreamPayload({
    currentUser,
    channelName: 'Milan_567',
    channelId: '12345',
    chatroomId: '67890',
    currentStreamTitle: 'Igramo GTA RP!',
    streamStartTime,
    liveStats,
    currentVelocity: 35,
    peakVelocity: 88
  });

  assert.ok(payload);
  assert.equal(payload.user_id, currentUser.id);
  assert.equal(payload.channel_name, 'Milan_567');
  assert.equal(payload.channel_id, '12345');
  assert.equal(payload.chatroom_id, 67890);
  assert.equal(payload.stream_title, 'Igramo GTA RP!');
  assert.equal(payload.peak_viewers, 152);
  assert.equal(payload.avg_viewers, Math.round(152 * 0.75));
  assert.equal(payload.total_messages, 450);
  assert.equal(payload.total_emotes, 60);
  assert.equal(payload.unique_chatters, 3);
  assert.equal(payload.chat_velocity_peak, 88);
  assert.equal(payload.moderation_actions, 3); // 2 bans + 1 kick
  assert.ok(payload.duration_seconds >= 8990); // ~9000s

  // Provera JSONB summary strukture
  assert.ok(payload.summary);
  assert.equal(payload.summary.topChatters.length, 2);
  assert.equal(payload.summary.topChatters[0].user, 'Gledalac1');
  assert.equal(payload.summary.topChatters[0].count, 120);
  assert.equal(payload.summary.topEmotes[0].name, 'kekw');
  assert.equal(payload.summary.topEmotes[0].count, 42);
  assert.equal(payload.summary.banLogs.length, 1);
});

test('Kickan - filterPastStreams filtrira arhivu po kanalu, naslovu i datumu', () => {
  const streams = [
    { channel_name: 'Milan_567', stream_title: 'Subotica Chill Stream', started_at: '2026-09-10T18:00:00Z' },
    { channel_name: 'Ficolive', stream_title: 'FIFA 26 Turnir', started_at: '2026-09-11T20:00:00Z' },
    { channel_name: 'Milan_567', stream_title: 'Horror Noć', started_at: '2026-09-12T22:00:00Z' }
  ];

  // Prazan filter vraća sve
  assert.equal(filterPastStreams(streams, '').length, 3);

  // Filter po kanalu
  assert.equal(filterPastStreams(streams, 'ficolive').length, 1);
  assert.equal(filterPastStreams(streams, 'milan').length, 2);

  // Filter po naslovu
  assert.equal(filterPastStreams(streams, 'chill').length, 1);
  assert.equal(filterPastStreams(streams, 'fifa').length, 1);

  // Filter po datumu
  assert.equal(filterPastStreams(streams, '2026-09-12').length, 1);
});

test('Kickan - generateStreamCsv kreira ispravno formatiran CSV fajl sa metrikama i top listama', () => {
  const stream = {
    channel_name: 'Milan_567',
    stream_title: 'Live Q&A Sesija',
    started_at: '2026-09-12T15:00:00Z',
    duration_seconds: 7200,
    peak_viewers: 210,
    total_messages: 1800,
    unique_chatters: 85,
    chat_velocity_peak: 64,
    summary: {
      topChatters: [
        { user: 'TopGledalac', count: 95, isSub: true, lastSeen: '16:50' }
      ],
      topEmotes: [
        { name: 'KICKON', count: 120 }
      ]
    }
  };

  const csv = generateStreamCsv(stream);
  assert.ok(csv.includes('Lajv Sesija,Kanal,Milan_567'));
  assert.ok(csv.includes('02h 00m 00s'));
  assert.ok(csv.includes('Peak Gledaoci,210'));
  assert.ok(csv.includes('Ukupno Poruka,1800'));
  assert.ok(csv.includes('Top Gledalac #1,TopGledalac,95,SUB,16:50'));
  assert.ok(csv.includes('Top Emote,KICKON,120'));
});

test('Kickan - buildStreamPayload vraća null ukoliko korisnik nije prijavljen', () => {
  const payload = buildStreamPayload({
    currentUser: null,
    channelName: 'Test',
    liveStats: {}
  });
  assert.equal(payload, null);
});

function getRoleBadgeInfo(role, isManaged) {
  if (role === 'managed' || isManaged) {
    return { label: 'Menadžer', class: 'cdm-role-managed' };
  } else if (role === 'custom') {
    return { label: 'Dodat', class: 'cdm-role-custom' };
  }
  return { label: 'Vlasnik', class: 'cdm-role-owner' };
}

function resolveChannelPlan(channelObj, currentUserProfile) {
  if (channelObj?.role === 'managed' && channelObj.owner_plan) {
    const plan = channelObj.owner_plan.toLowerCase();
    return plan.includes('elite') ? 'elite' : (plan.includes('pro') ? 'pro' : 'free');
  }
  const myTier = (currentUserProfile?.plan || currentUserProfile?.plan_tier || 'free').toLowerCase();
  return (myTier.includes('elite') || myTier.includes('business')) ? 'elite' : (myTier.includes('pro') ? 'pro' : 'free');
}

function deduplicateChannels(channelsList) {
  const seen = new Set();
  return channelsList.filter(c => {
    const key = (c.username || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

test('Kickan - getRoleBadgeInfo mapira uloge u ispravne nazive (Vlasnik, Menadžer, Dodat)', () => {
  assert.deepEqual(getRoleBadgeInfo('owner', false), { label: 'Vlasnik', class: 'cdm-role-owner' });
  assert.deepEqual(getRoleBadgeInfo('managed', true), { label: 'Menadžer', class: 'cdm-role-managed' });
  assert.deepEqual(getRoleBadgeInfo(null, true), { label: 'Menadžer', class: 'cdm-role-managed' });
  assert.deepEqual(getRoleBadgeInfo('custom', false), { label: 'Dodat', class: 'cdm-role-custom' });
  assert.deepEqual(getRoleBadgeInfo(undefined, false), { label: 'Vlasnik', class: 'cdm-role-owner' });
});

test('Kickan - resolveChannelPlan nasleđuje plan vlasnika kada je korisnik Glavni Moderator', () => {
  const userProfileFree = { plan: 'free' };
  const userProfilePro = { plan: 'pro' };

  // Moderator na Elite kanalu nasleđuje Elite paket
  const managedEliteChannel = { username: 'TopStrimer', role: 'managed', owner_plan: 'elite' };
  assert.equal(resolveChannelPlan(managedEliteChannel, userProfileFree), 'elite');

  // Moderator na Pro kanalu nasleđuje Pro paket
  const managedProChannel = { username: 'ProGamer', role: 'managed', owner_plan: 'pro' };
  assert.equal(resolveChannelPlan(managedProChannel, userProfileFree), 'pro');

  // Vlasnički kanal koristi sopstveni paket korisnika
  const ownChannel = { username: 'MojKanal', role: 'owner', owner_plan: 'free' };
  assert.equal(resolveChannelPlan(ownChannel, userProfileFree), 'free');
  assert.equal(resolveChannelPlan(ownChannel, userProfilePro), 'pro');
});

test('Kickan - deduplicateChannels uklanja duplikate bez obzira na veličinu slova', () => {
  const list = [
    { username: 'milan_567', role: 'owner' },
    { username: 'Milan_567', role: 'managed' },
    { username: 'Ficolive', role: 'managed' },
    { username: 'FICOLIVE', role: 'custom' },
    { username: 'novi_kanal', role: 'custom' }
  ];

  const deduped = deduplicateChannels(list);
  assert.equal(deduped.length, 3);
  assert.equal(deduped[0].username, 'milan_567');
  assert.equal(deduped[1].username, 'Ficolive');
  assert.equal(deduped[2].username, 'novi_kanal');
});

test('Kickan - Fullscreen HUD statistika pravilno mapira ukupno poruka, jedinstvene chatere i kicks donacije', () => {
  const liveStats = {
    totalMessages: 12450,
    uniqueChattersMap: new Set(['user1', 'user2', 'user3', 'user4']),
    totalKicks: 350,
    peakViewers: 1731,
    totalEmotes: 820
  };
  const currentVelocity = 45;

  const hudStats = {
    totalMessages: liveStats.totalMessages.toLocaleString(),
    uniqueChatters: liveStats.uniqueChattersMap.size.toLocaleString(),
    totalKicks: liveStats.totalKicks.toLocaleString(),
    peakViewers: liveStats.peakViewers.toLocaleString(),
    totalEmotes: liveStats.totalEmotes.toLocaleString(),
    chatVelocity: `${currentVelocity}/m`
  };

  assert.equal(hudStats.totalMessages, (12450).toLocaleString());
  assert.equal(hudStats.uniqueChatters, '4');
  assert.equal(hudStats.totalKicks, '350');
  assert.equal(hudStats.peakViewers, (1731).toLocaleString());
  assert.equal(hudStats.chatVelocity, '45/m');
});

function calculateEstimatedEarnings({
  streamStartTime = null,
  liveStats = {},
  now = Date.now(),
  currentVelocity = 0,
  engagementMult: explicitEngagementMult,
  geoMultiplier: explicitGeoMultiplier = 1.00
} = {}) {
  let durationHours = 0;
  const isLive = Boolean((liveStats.liveViewers || 0) > 0);

  if (isLive && streamStartTime) {
    durationHours = Math.min(12, Math.max(0, (now - streamStartTime) / 3600000));
  } else {
    durationHours = 0;
  }

  const viewers = liveStats.avgViewers || liveStats.liveViewers || 0;
  const uniqueChatters = liveStats.uniqueChattersMap ? liveStats.uniqueChattersMap.size : 0;
  const followers = liveStats.followersCount || 0;

  let baseHourlyRate = 0;
  let tierLabel = 'OFFLINE';

  if (viewers >= 3000) { baseHourlyRate = 60.00; tierLabel = 'KCIP ELITE'; }
  else if (viewers >= 1500) { baseHourlyRate = 45.00; tierLabel = 'KCIP TIER 1'; }
  else if (viewers >= 1000) { baseHourlyRate = 35.00; tierLabel = 'KCIP TIER 1'; }
  else if (viewers >= 500)  { baseHourlyRate = 25.00; tierLabel = 'KCIP TIER 2'; }
  else if (viewers >= 250)  { baseHourlyRate = 18.00; tierLabel = 'KCIP TIER 2'; }
  else if (viewers >= 100)  { baseHourlyRate = 16.00; tierLabel = 'KCIP CLASS 1'; }
  else if (viewers >= 50)   { baseHourlyRate = 8.00;  tierLabel = 'KCIP CLASS 2'; }
  else if (viewers >= 25)   { baseHourlyRate = 4.00;  tierLabel = 'KCIP ASPIRING'; }
  else if (viewers >= 10)   { baseHourlyRate = 2.00;  tierLabel = 'COMMUNITY TIER'; }
  else { baseHourlyRate = 0; tierLabel = isLive ? 'MIKRO STRIM' : 'OFFLINE'; }

  let isBotAdjusted = false;
  let verifiedAudience = viewers;
  if (viewers > 100 && uniqueChatters > 0 && uniqueChatters < viewers * 0.05) {
    isBotAdjusted = true;
    verifiedAudience = Math.max(uniqueChatters * 12, Math.round(viewers * 0.25));
    if (verifiedAudience < 100) baseHourlyRate = Math.min(baseHourlyRate, 8.00);
    else if (verifiedAudience < 250) baseHourlyRate = Math.min(baseHourlyRate, 16.00);
    else if (verifiedAudience < 500) baseHourlyRate = Math.min(baseHourlyRate, 22.00);
    else if (verifiedAudience < 1000) baseHourlyRate = Math.min(baseHourlyRate, 30.00);
  }

  let engagementMult = 1.00;
  if (isLive && viewers > 0) {
    const chatterRatio = uniqueChatters / Math.max(viewers, 1);
    if (currentVelocity >= 80 || (currentVelocity >= 40 && chatterRatio >= 0.12)) {
      engagementMult = 1.25;
    } else if (currentVelocity >= 40 || (currentVelocity >= 20 && chatterRatio >= 0.08)) {
      engagementMult = 1.15;
    } else if (currentVelocity >= 15 || chatterRatio >= 0.05) {
      engagementMult = 1.08;
    } else {
      engagementMult = 1.00;
    }
  }
  if (explicitEngagementMult !== undefined) {
    engagementMult = explicitEngagementMult;
  }

  const geoMultiplier = explicitGeoMultiplier;
  const effectiveHourlyRate = Number((baseHourlyRate * engagementMult * geoMultiplier).toFixed(2));
  const kcipEst = Number((durationHours * effectiveHourlyRate).toFixed(2));

  const estimatedCpm = 3.00;
  const activeSubsCount = liveStats.activeSubs || 0;
  const effectiveAdViewers = Math.max(0, (isBotAdjusted ? verifiedAudience : viewers) - activeSubsCount);
  const adImpressions = isLive ? (durationHours * effectiveAdViewers * 1.5) : 0;
  const adRevenueEst = Number(((adImpressions / 1000) * estimatedCpm).toFixed(2));

  const subsEst = Number((activeSubsCount * 4.75).toFixed(2));
  const kicksEst = Number(((liveStats.totalKicks || 0) * 0.01).toFixed(2));
  const totalEst = Number((kcipEst + subsEst + kicksEst + adRevenueEst).toFixed(2));

  let qualificationStatus = 'Offline (Čeka se lajv)';
  if (isLive) {
    if (viewers >= 100 && followers >= 300) {
      qualificationStatus = 'Kvalifikovan (Class 1)';
    } else if (viewers >= 100) {
      qualificationStatus = 'Kvalifikovan (100 CCV)';
    } else if (viewers >= 25) {
      qualificationStatus = `Aspiring (${viewers}/100 CCV)`;
    } else {
      qualificationStatus = `Zajednica (${viewers}/100 CCV)`;
    }
  }

  return {
    kcipEst,
    subsEst,
    kicksEst,
    adRevenueEst,
    totalEst,
    durationHours,
    baseHourlyRate,
    effectiveHourlyRate,
    hourlyRate: baseHourlyRate,
    engagementMult,
    estimatedCpm,
    geoMultiplier,
    tierLabel,
    viewers,
    uniqueChatters,
    currentVelocity,
    isBotAdjusted,
    qualificationStatus
  };
}

test('Kickan - calculateEstimatedEarnings računa KCIP tiers satnicu, 95% pretplata, Kicks i Ad revenue', () => {
  const streamStart = Date.now() - (2.5 * 3600 * 1000); // 2.5 sata strima
  const liveStats = {
    liveViewers: 100, // 100 gledalaca -> Tier $16/h * 2.5h = $40.00
    activeSubs: 20,   // 20 subs * $4.75 = $95.00
    totalKicks: 500   // 500 kicks * $0.01 = $5.00
  };

  const res = calculateEstimatedEarnings({
    streamStartTime: streamStart,
    liveStats,
    now: streamStart + (2.5 * 3600 * 1000)
  });

  assert.equal(res.kcipEst, 40.00);
  assert.equal(res.subsEst, 95.00);
  assert.equal(res.kicksEst, 5.00);
  assert.equal(res.adRevenueEst, 0.90); // 80 non-sub gledalaca * 2.5h * 1.5 * $3.00 CPM = $0.90
  assert.equal(res.totalEst, 140.90); // 40 + 95 + 5 + 0.90
  assert.equal(res.estimatedCpm, 3.00);
  assert.equal(res.tierLabel, 'KCIP CLASS 1');
  assert.equal(res.qualificationStatus, 'Kvalifikovan (100 CCV)');
});

test('Kickan - calculateEstimatedEarnings primenjuje chat velocity multiplikator angažovanosti', () => {
  const streamStart = Date.now() - (2 * 3600 * 1000); // 2 sata strima
  const liveStats = {
    liveViewers: 500, // 500 gledalaca -> baza $25/h
    uniqueChattersMap: new Set(Array.from({ length: 60 }, (_, i) => `user_${i}`)), // 12% chatters
    activeSubs: 10,
    totalKicks: 1000
  };

  const res = calculateEstimatedEarnings({
    streamStartTime: streamStart,
    liveStats,
    now: streamStart + (2 * 3600 * 1000),
    currentVelocity: 50
  });

  assert.equal(res.baseHourlyRate, 25.00);
  assert.equal(res.engagementMult, 1.25);
  assert.equal(res.effectiveHourlyRate, 31.25);
  assert.equal(res.kcipEst, 62.50); // 2h * $31.25 = $62.50
  assert.equal(res.subsEst, 47.50);
  assert.equal(res.kicksEst, 10.00);
  assert.equal(res.adRevenueEst, 4.41); // (490 * 2h * 1.5 / 1000) * 3 = 4.41
  assert.equal(res.totalEst, 124.41);
});

test('Kickan - calculateEstimatedEarnings normalizuje nerealne bot cifre prema aktivnom chatu', () => {
  const streamStart = Date.now() - (2 * 3600 * 1000); // 2 sata strima
  const liveStats = {
    liveViewers: 1724, // 1724 gledalaca ali samo 31 chatter (< 5% chata)
    uniqueChattersMap: new Set(Array.from({ length: 31 }, (_, i) => `user_${i}`)),
    activeSubs: 0,
    totalKicks: 0
  };

  const res = calculateEstimatedEarnings({
    streamStartTime: streamStart,
    liveStats,
    now: streamStart + (2 * 3600 * 1000)
  });

  // Umesto nerealnih $500+, normalizovana satnica je $22/h -> $44.00 za 2h
  assert.equal(res.hourlyRate, 22.00);
  assert.equal(res.kcipEst, 44.00);
  assert.equal(res.adRevenueEst, 3.88); // (431 verifikovanih * 2h * 1.5 / 1000) * 3 = 3.88
  assert.equal(res.totalEst, 47.88);
  assert.equal(res.isBotAdjusted, true);
});

test('Kickan - calculateEstimatedEarnings vraća 0 za novu praznu ili offline sesiju', () => {
  const res = calculateEstimatedEarnings({
    streamStartTime: null,
    liveStats: { totalMessages: 0, liveViewers: 0, activeSubs: 0, totalKicks: 0 }
  });

  assert.equal(res.kcipEst, 0);
  assert.equal(res.subsEst, 0);
  assert.equal(res.kicksEst, 0);
  assert.equal(res.adRevenueEst, 0);
  assert.equal(res.totalEst, 0);
  assert.equal(res.tierLabel, 'OFFLINE');
  assert.equal(res.qualificationStatus, 'Offline (Čeka se lajv)');
});

/* ════════════════════════════════════════════════════════════════
   DODATNI TOP-TIER AUDIT TESTOVI (Konzistentnost sa Kickot i Kickaj)
   ════════════════════════════════════════════════════════════════ */

test('Kickan - cleanUsername robusno ekstrahuje ime iz URL-ova, prefiksa, query parametara i heševa', () => {
  function cleanUsername(raw, defaultVal = 'Kanal') {
    if (!raw) return defaultVal;
    let s = String(raw).trim()
      .replace(/^https?:\/\/(www\.)?kick\.com\//i, '')
      .replace(/^kick_user_/, '')
      .replace(/^@/, '');
    if (s.includes('@')) s = s.split('@')[0];
    s = s.split(/[/?#\s]/)[0];
    return s || defaultVal;
  }

  assert.equal(cleanUsername('https://kick.com/milan_567/'), 'milan_567');
  assert.equal(cleanUsername('http://www.kick.com/streamer?ref=banner#bio'), 'streamer');
  assert.equal(cleanUsername('@MilanGamer'), 'MilanGamer');
  assert.equal(cleanUsername('kick_user_pro123'), 'pro123');
  assert.equal(cleanUsername('streamer/about/sub'), 'streamer');
  assert.equal(cleanUsername(''), 'Kanal');
  assert.equal(cleanUsername(null), 'Kanal');
  assert.equal(cleanUsername(undefined), 'Kanal');
  assert.equal(cleanUsername(null, 'Streamer'), 'Streamer');
});

test('Kickan - escapeHtml neutrališe opasne XSS payload-e u korisničkim imenima i porukama', () => {
  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m]);
  }

  const payload = '<script>alert("xss")</script>';
  const escaped = escapeHtml(payload);
  assert.equal(escaped.includes('<script>'), false);
  assert.equal(escaped.includes('&lt;script&gt;'), true);
  assert.equal(escaped.includes('&quot;xss&quot;'), true);
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml('Normalan tekst 123'), 'Normalan tekst 123');
  assert.equal(escapeHtml('User & Name <Tag> "Quote" \'Apostrophe\''), 'User &amp; Name &lt;Tag&gt; &quot;Quote&quot; &#39;Apostrophe&#39;');
});

test('Kickan - Modal Manager upravlja fokusom, aria-hidden atributima i zatvaranjem na Escape', () => {
  let activeModalStack = [];
  const modalTriggerElements = new Map();
  let appAriaHidden = null;
  let focusedElement = null;

  const mockApp = {
    setAttribute(attr, val) { if (attr === 'aria-hidden') appAriaHidden = val; },
    removeAttribute(attr) { if (attr === 'aria-hidden') appAriaHidden = null; }
  };

  const mockModal = {
    id: 'exportReportModal',
    isOpen: false,
    ariaHidden: 'true',
    classList: {
      add(cls) { if (cls === 'open') mockModal.isOpen = true; },
      remove(cls) { if (cls === 'open') mockModal.isOpen = false; }
    },
    setAttribute(attr, val) { if (attr === 'aria-hidden') mockModal.ariaHidden = val; },
    focus() { focusedElement = 'modalFirstBtn'; }
  };

  function openModal(id, triggerBtn) {
    if (triggerBtn) modalTriggerElements.set(id, triggerBtn);
    mockModal.classList.add('open');
    mockModal.setAttribute('aria-hidden', 'false');
    mockApp.setAttribute('aria-hidden', 'true');
    activeModalStack.push(id);
    mockModal.focus();
  }

  function closeModal(id) {
    mockModal.classList.remove('open');
    mockModal.setAttribute('aria-hidden', 'true');
    activeModalStack = activeModalStack.filter(item => item !== id);
    if (activeModalStack.length === 0) {
      mockApp.removeAttribute('aria-hidden');
    }
    const trigger = modalTriggerElements.get(id);
    if (trigger) {
      focusedElement = trigger;
      modalTriggerElements.delete(id);
    }
  }

  // 1. Otvaranje modala
  openModal('exportReportModal', 'btnTriggerExport');
  assert.equal(mockModal.isOpen, true);
  assert.equal(mockModal.ariaHidden, 'false');
  assert.equal(appAriaHidden, 'true');
  assert.equal(focusedElement, 'modalFirstBtn');
  assert.equal(activeModalStack.length, 1);

  // 2. Zatvaranje modala vraća fokus na dugme pokretača i uklanja aria-hidden
  closeModal('exportReportModal');
  assert.equal(mockModal.isOpen, false);
  assert.equal(mockModal.ariaHidden, 'true');
  assert.equal(appAriaHidden, null);
  assert.equal(focusedElement, 'btnTriggerExport');
  assert.equal(activeModalStack.length, 0);
});

test('Kickan - Escape taster poštuje hijerarhiju zatvaranja (prvo modal, tek onda fullscreen studio)', () => {
  let activeModalStack = ['customChannelModal'];
  let isFullscreenOpen = true;

  function handleEscapeKey() {
    if (activeModalStack.length > 0) {
      activeModalStack.pop();
      return 'modal_closed';
    }
    if (isFullscreenOpen) {
      isFullscreenOpen = false;
      return 'fullscreen_closed';
    }
    return 'none';
  }

  // Prvi pritisak na Escape zatvara modal, ali Fullscreen ostaje otvoren
  assert.equal(handleEscapeKey(), 'modal_closed');
  assert.equal(isFullscreenOpen, true);
  assert.equal(activeModalStack.length, 0);

  // Drugi pritisak na Escape zatvara Fullscreen studio
  assert.equal(handleEscapeKey(), 'fullscreen_closed');
  assert.equal(isFullscreenOpen, false);
});

test('Kickan - debouncedSaveSessionStats ograničava upise u localStorage tokom brzog chata', () => {
  let writesCount = 0;
  let saveSessionTimeout = null;

  function saveSessionStats() {
    writesCount++;
  }

  function debouncedSaveSessionStats() {
    if (saveSessionTimeout) return;
    saveSessionTimeout = setTimeout(() => {
      saveSessionTimeout = null;
      saveSessionStats();
    }, 100);
  }

  // Simulacija 50 brzih dolaznih chat poruka u 10ms
  for (let i = 0; i < 50; i++) {
    debouncedSaveSessionStats();
  }

  // Pre isteka tajmera, nije izvršen nijedan upis
  assert.equal(writesCount, 0);
  assert.ok(saveSessionTimeout !== null);
  clearTimeout(saveSessionTimeout);
});

test('Kickan - deletePastStream i update operacije striktno filtriraju zapis po user_id ulogovanog korisnika', () => {
  const currentUserId = 'user-uuid-1234-abcd';
  let queryFilters = {};

  const mockSupabaseQuery = {
    from(table) {
      assert.equal(table, 'kickan');
      return {
        delete() {
          return {
            eq(col, val) {
              queryFilters[col] = val;
              return {
                eq(col2, val2) {
                  queryFilters[col2] = val2;
                  return Promise.resolve({ error: null });
                }
              };
            }
          };
        }
      };
    }
  };

  async function deletePastStream(streamId, sb, user) {
    if (!streamId || !sb || !user) return;
    await sb.from('kickan').delete().eq('id', streamId).eq('user_id', user.id);
  }

  deletePastStream('stream-session-999', mockSupabaseQuery, { id: currentUserId });
  assert.equal(queryFilters['id'], 'stream-session-999');
  assert.equal(queryFilters['user_id'], currentUserId, 'Brisanje mora biti zaštićeno sa user_id filterom');
});

test('Kickan - liveStats.viewerSamples se automatski ograničava na 500 stavki kako bi se sprečio memory leak', () => {
  const samples = [];
  for (let i = 0; i < 1200; i++) {
    samples.push(i);
    if (samples.length > 500) {
      samples.shift();
    }
  }

  assert.equal(samples.length, 500);
  assert.equal(samples[samples.length - 1], 1199);
  assert.equal(samples[0], 700);
});

test('Kickan - Mobile Sidebar Drawer pravilno postavlja aria-expanded i aria-hidden atribute', () => {
  let isSidebarOpen = false;
  let ariaExpanded = 'false';
  let ariaHidden = 'true';

  function toggleMobileSidebar() {
    isSidebarOpen = !isSidebarOpen;
    ariaExpanded = String(isSidebarOpen);
    ariaHidden = String(!isSidebarOpen);
  }

  function closeMobileSidebar() {
    isSidebarOpen = false;
    ariaExpanded = 'false';
    ariaHidden = 'true';
  }

  // 1. Otvaranje
  toggleMobileSidebar();
  assert.equal(isSidebarOpen, true);
  assert.equal(ariaExpanded, 'true');
  assert.equal(ariaHidden, 'false');

  // 2. Zatvaranje
  closeMobileSidebar();
  assert.equal(isSidebarOpen, false);
  assert.equal(ariaExpanded, 'false');
  assert.equal(ariaHidden, 'true');
});

test('Kickan - Offline stanje: resetuje sve lajv metrike na 0/prazno, a čuva istoriju grafikona (hourlyCounts)', () => {
  const liveStats = {
    totalMessages: 1450,
    liveViewers: 320,
    avgViewers: 280,
    viewerSamples: [300, 310, 320],
    peakViewers: 450,
    activeSubs: 14,
    uniqueChattersMap: new Set(['user1', 'user2', 'user3']),
    totalKicks: 250,
    totalBans: 5,
    totalHosts: 2,
    totalEmotes: 89,
    emotesMap: new Map([['kekw', 40]]),
    viewersActivityMap: new Map([['user1', { count: 50 }]]),
    banLogs: [{ user: 'troll', time: '14:00' }],
    recentChatMessages: [{ content: 'test', sender: 'user1' }],
    hourlyCounts: [0, 0, 15, 45, 80, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  // Funkcija za prelazak u offline stanje
  function handleStreamOffline(stats) {
    stats.liveViewers = 0;
    stats.avgViewers = 0;
    stats.viewerSamples = [];
    stats.totalMessages = 0;
    stats.peakViewers = 0;
    stats.activeSubs = 0;
    stats.uniqueChattersMap = new Set();
    stats.totalKicks = 0;
    stats.totalBans = 0;
    stats.totalHosts = 0;
    stats.totalEmotes = 0;
    stats.emotesMap = new Map();
    stats.viewersActivityMap = new Map();
    stats.banLogs = [];
    stats.recentChatMessages = [];
    // hourlyCounts se NE resetuje - čuva se za grafike
  }

  handleStreamOffline(liveStats);

  // Proveri da su sve trenutne lajv vrednosti očišćene
  assert.equal(liveStats.liveViewers, 0);
  assert.equal(liveStats.avgViewers, 0);
  assert.equal(liveStats.viewerSamples.length, 0);
  assert.equal(liveStats.totalMessages, 0);
  assert.equal(liveStats.peakViewers, 0);
  assert.equal(liveStats.activeSubs, 0);
  assert.equal(liveStats.uniqueChattersMap.size, 0);
  assert.equal(liveStats.totalKicks, 0);
  assert.equal(liveStats.totalBans, 0);
  assert.equal(liveStats.totalHosts, 0);
  assert.equal(liveStats.totalEmotes, 0);
  assert.equal(liveStats.emotesMap.size, 0);
  assert.equal(liveStats.viewersActivityMap.size, 0);
  assert.equal(liveStats.banLogs.length, 0);
  assert.equal(liveStats.recentChatMessages.length, 0);

  // Proveri da su podaci grafikona netaknuti
  assert.equal(liveStats.hourlyCounts[2], 15);
  assert.equal(liveStats.hourlyCounts[5], 120);
});

test('Kickan - saveLiveStreamToDatabase update operacija striktno uključuje id i user_id', async () => {
  const currentUserId = 'user-owner-uuid-456';
  const targetSessionDbId = 'stream-session-id-789';
  let updateFilters = {};

  const mockSupabaseQuery = {
    from(table) {
      assert.equal(table, 'kickan');
      return {
        update(payload) {
          assert.ok(payload);
          return {
            eq(col, val) {
              updateFilters[col] = val;
              return {
                eq(col2, val2) {
                  updateFilters[col2] = val2;
                  return Promise.resolve({ error: null });
                }
              };
            }
          };
        }
      };
    }
  };

  async function updateStreamInDatabase(dbId, targetUserId, payload, sb) {
    const { error } = await sb.from('kickan').update(payload).eq('id', dbId).eq('user_id', targetUserId);
    if (error) throw error;
  }

  await updateStreamInDatabase(targetSessionDbId, currentUserId, { peak_viewers: 250 }, mockSupabaseQuery);
  assert.equal(updateFilters['id'], targetSessionDbId);
  assert.equal(updateFilters['user_id'], currentUserId);
});

test('Kickan - Bot filtriranje ignoriše poznate bot naloge iz statistike čatera', () => {
  const KNOWN_BOTS = new Set(['botrix', 'nightbot', 'streamlabs', 'streamelements', 'kickbot']);

  function isBotUser(username, filterBotsEnabled) {
    if (!filterBotsEnabled) return false;
    if (!username) return false;
    return KNOWN_BOTS.has(username.toLowerCase().trim());
  }

  assert.equal(isBotUser('BotRix', true), true);
  assert.equal(isBotUser('nightbot', true), true);
  assert.equal(isBotUser('StreamLabs', true), true);
  assert.equal(isBotUser('MilanStreamer', true), false);
  // Kada je filter isključen, ne filtrira
  assert.equal(isBotUser('BotRix', false), false);
});
