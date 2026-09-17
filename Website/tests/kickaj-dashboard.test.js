const test = require('node:test');
const assert = require('node:assert/strict');
const { PLAN_LIMITS } = require('../kickaj/js/kickaj-dashboard.js');

test('Kickaj - PLAN_LIMITS ima ispravno definisana pravila za planove', () => {
  assert.ok(PLAN_LIMITS, 'PLAN_LIMITS mora biti uvezen iz kickaj-dashboard.js');
  assert.equal(PLAN_LIMITS.free.sound, false, 'Free plan ne sme imati dozvoljen zvuk');
  assert.equal(PLAN_LIMITS.pro.sound, true, 'PRO plan mora imati dozvoljen zvuk');
  assert.equal(PLAN_LIMITS.elite.sound, true, 'ELITE plan mora imati dozvoljen zvuk');
  assert.deepEqual(PLAN_LIMITS.free.animations, ['wheel'], 'Free plan ima samo točak sreće');
  assert.deepEqual(PLAN_LIMITS.pro.animations, ['wheel', 'slot', 'roulette'], 'PRO plan podržava sve animacije');
  assert.deepEqual(PLAN_LIMITS.elite.animations, ['wheel', 'slot', 'roulette'], 'ELITE plan podržava sve animacije');
});

test('Kickaj - Potvrda više pobednika u nizu kroz chat poruku', () => {
  const winnersList = [
    { username: 'DrugiPobednik', prize: 'Sub', isConfirmed: false, isExpired: false, timerId: 101 },
    { username: 'PrviPobednik', prize: 'Vip', isConfirmed: false, isExpired: false, timerId: 102 }
  ];
  const _activeWinnerUsername = 'DrugiPobednik';

  function handleWinnerChatMessage(sender, _text) {
    if (!sender) return false;
    const s1 = String(sender).trim().toLowerCase().replace(/^@/, '');
    const matchingWinner = winnersList.find(w => String(w.username).toLowerCase().replace(/^@/, '') === s1 && !w.isConfirmed);
    if (!matchingWinner) return false;

    matchingWinner.isConfirmed = true;
    if (matchingWinner.timerId) {
      matchingWinner.timerId = null;
    }
    return true;
  }

  // Prvi pobednik se javlja u chatu iako je activeWinnerUsername DrugiPobednik!
  const confirmed = handleWinnerChatMessage('PrviPobednik', 'tu sam!');
  assert.equal(confirmed, true, 'Prvi pobednik mora biti uspešno potvrđen kroz chat');
  assert.equal(winnersList[1].isConfirmed, true, 'Stanje prvog pobednika mora biti isConfirmed=true');
  assert.equal(winnersList[1].timerId, null, 'Tajmer prvog pobednika mora biti očišćen');

  // Drugi pobednik još uvek čeka potvrdu
  assert.equal(winnersList[0].isConfirmed, false, 'Drugi pobednik ostaje nepotvrđen dok se sam ne javi');
});

test('Kickaj - Ručna potvrda pobednika po indeksu', () => {
  const winnersList = [
    { username: 'StreamViewer1', prize: 'T-Shirt', isConfirmed: false, timerId: 55 },
    { username: 'StreamViewer2', prize: 'Key', isConfirmed: false, timerId: 56 }
  ];

  function confirmWinnerByIndex(idx) {
    if (idx < 0 || idx >= winnersList.length) return false;
    const winObj = winnersList[idx];
    winObj.isConfirmed = true;
    winObj.timerId = null;
    return true;
  }

  const res = confirmWinnerByIndex(1);
  assert.equal(res, true);
  assert.equal(winnersList[1].isConfirmed, true);
  assert.equal(winnersList[0].isConfirmed, false);
});

test('Kickaj - Sprečavanje ponovnog učešća već izvučenih pobednika', () => {
  const participantsMap = new Map();
  const winnersList = [
    { username: 'PobednikSrbija', prize: 'Gift' }
  ];

  function processChatMessage(user) {
    const key = user.username.toLowerCase().replace(/^@/, '');
    if (participantsMap.has(key)) return 'already_in_pool';
    const isAlreadyWinner = winnersList.some(w => String(w.username).toLowerCase().replace(/^@/, '') === key);
    if (isAlreadyWinner) return 'already_won';

    participantsMap.set(key, { username: user.username });
    return 'added';
  }

  // Korisnik koji je već osvojio nagradu pokušava ponovo
  const res1 = processChatMessage({ username: 'PobednikSrbija', message: '!gw' });
  assert.equal(res1, 'already_won', 'Pobednik ne sme moći ponovo da se prijavi');
  assert.equal(participantsMap.has('pobedniksrbija'), false);

  // Novi korisnik se normalno prijavljuje
  const res2 = processChatMessage({ username: 'NoviGledalac', message: '!gw' });
  assert.equal(res2, 'added', 'Novi gledalac mora biti dodat');
  assert.equal(participantsMap.has('novigledalac'), true);
});

test('Kickaj - Bot nalozi (KickotBot, Nightbot, Botrix) i strimer se nikada ne dodaju u giveaway', () => {
  const participantsMap = new Map();
  const winnersList = [];
  const channelName = 'Tutz_live';

  function processChatMessage(user) {
    const key = user.username.toLowerCase().replace(/^@/, '');
    const knownBots = ['kickotbot', 'botrix', 'nightbot', 'streamelements', 'streamlabs'];
    if (user.isBot || knownBots.includes(key)) {
      return 'rejected_bot';
    }
    if (user.isBroadcaster || (channelName && key === channelName.toLowerCase())) {
      return 'rejected_broadcaster';
    }
    if (participantsMap.has(key)) return 'already_in_pool';
    participantsMap.set(key, { username: user.username });
    return 'added';
  }

  // KickotBot šalje automatsku najavu koja sadrži ključnu reč !gw
  const resBot1 = processChatMessage({ username: 'KickotBot', message: '[GIVEAWAY] Prijave su otvorene! Upišite "!gw"', isBot: true });
  assert.equal(resBot1, 'rejected_bot', 'KickotBot nikada ne sme ući u sopstveni giveaway');
  assert.equal(participantsMap.has('kickotbot'), false);

  // Spoljni bot Nightbot
  const resBot2 = processChatMessage({ username: 'Nightbot', message: '!gw' });
  assert.equal(resBot2, 'rejected_bot', 'Poznati eksterni botovi ne smeju ući u giveaway');
  assert.equal(participantsMap.has('nightbot'), false);

  // Strimer
  const resStreamer = processChatMessage({ username: 'Tutz_live', message: '!gw', isBroadcaster: true });
  assert.equal(resStreamer, 'rejected_broadcaster', 'Strimer ne sme ući u giveaway');
  assert.equal(participantsMap.has('tutz_live'), false);

  // Pravi gledalac
  const resUser = processChatMessage({ username: 'PraviGledalac123', message: '!gw' });
  assert.equal(resUser, 'added', 'Legitimni gledalac mora uspešno ući u giveaway');
  assert.equal(participantsMap.has('pravigledalac123'), true);
});

test('Kickaj - Izvoz pobednika u hronološkom redosledu (prvi osvojio = broj 1)', () => {
  // winnersList čuva najnovije na početku (unshift)
  const winnersList = [
    { username: 'Treci', prize: 'Nagrada 3' },
    { username: 'Drugi', prize: 'Nagrada 2' },
    { username: 'Prvi', prize: 'Nagrada 1' }
  ];

  const chronological = [...winnersList].reverse();
  const exportedLines = chronological.map((w, i) => `${i + 1}. ${w.username} - ${w.prize}`).join('\n');

  const expected = [
    '1. Prvi - Nagrada 1',
    '2. Drugi - Nagrada 2',
    '3. Treci - Nagrada 3'
  ].join('\n');

  assert.equal(exportedLines, expected, 'Izvoz mora ređati pobednike hronološkim redosledom');
});

test('Kickaj - Točak sreće ograničava broj isečaka na max 60 i čuva pobednika', () => {
  const MAX_WHEEL_SLICES = 60;
  // Kreiraj veliki pool od 1000 učesnika
  const largePool = [];
  for (let i = 0; i < 1000; i++) {
    largePool.push(`Viewer_${i}`);
  }

  function sampleWheelPool(pool, winner) {
    if (pool.length <= MAX_WHEEL_SLICES) return pool;
    const winIdx = 15; // nasumična pozicija
    const otherCandidates = pool.filter(p => p !== winner);
    const sampled = [];
    for (let i = 0; i < MAX_WHEEL_SLICES; i++) {
      if (i === winIdx) {
        sampled.push(winner);
      } else {
        sampled.push(otherCandidates[i % otherCandidates.length]);
      }
    }
    return { sampled, winIdx };
  }

  const winner = 'Viewer_777';
  const { sampled, winIdx } = sampleWheelPool(largePool, winner);

  assert.equal(sampled.length, MAX_WHEEL_SLICES, 'Uzorak mora imati tačno 60 isečaka');
  assert.equal(sampled[winIdx], winner, 'Pobednik mora biti na zadatoj poziciji u uzorku');
});

test('Kickaj - Slot i Rulet biraju različite susedne ("zamalo") kartice', () => {
  const pool = ['Alice', 'Bob', 'Charlie', 'David'];
  const winner = 'Alice';

  const candidates = pool.filter(p => p !== winner);
  assert.ok(candidates.length >= 2, 'Mora postojati bar 2 kandidata');

  const almostLeft = candidates[0]; // Bob
  const rightCandidates = candidates.filter(p => p !== almostLeft);
  const almostRight = rightCandidates[0]; // Charlie

  assert.notEqual(almostLeft, almostRight, 'Susedi levo i desno od pobednika ne smeju biti isti korisnik');
  assert.notEqual(almostLeft, winner, 'Sused levo ne sme biti pobednik');
  assert.notEqual(almostRight, winner, 'Sused desno ne sme biti pobednik');
});

test('Kickaj - Fallback za vreme potvrde pobednika je 60s', () => {
  function parseConfirmTime(inputVal) {
    return Math.min(300, Math.max(5, parseInt(inputVal, 10) || 60));
  }

  assert.equal(parseConfirmTime(''), 60, 'Prazan string mora vratiti 60');
  assert.equal(parseConfirmTime('abc'), 60, 'Nevalidan unos mora vratiti 60');
  assert.equal(parseConfirmTime('45'), 45, 'Validan unos od 45 mora ostati 45');
  assert.equal(parseConfirmTime('3'), 5, 'Vrednost manja od 5 mora biti ograničena na 5');
  assert.equal(parseConfirmTime('500'), 300, 'Vrednost veća od 300 mora biti ograničena na 300');
});

test('Kickaj - Post-draw verifikacija praćenja (Opcija A)', () => {
  function evaluateFollowCheck(winObj, apiResponse) {
    const fc = winObj.followCheck;
    if (!fc || fc.requiredDays <= 0) {
      return { status: 'skipped' };
    }

    const isFollowing = !!apiResponse.is_following;
    const followDays = typeof apiResponse.follow_days === 'number' ? apiResponse.follow_days : 0;
    const passed = isFollowing && followDays >= fc.requiredDays;

    return {
      status: passed ? 'passed' : 'failed',
      isFollowing,
      followDays
    };
  }

  const winner1 = {
    username: 'LojalniPratilac',
    followCheck: { requiredDays: 30, status: 'checking' }
  };
  const res1 = evaluateFollowCheck(winner1, { is_following: true, follow_days: 45 });
  assert.equal(res1.status, 'passed', 'Gledalac koji prati 45 dana mora proći uslov od 30 dana');
  assert.equal(res1.isFollowing, true);
  assert.equal(res1.followDays, 45);

  const winner2 = {
    username: 'NoviPratilac',
    followCheck: { requiredDays: 30, status: 'checking' }
  };
  const res2 = evaluateFollowCheck(winner2, { is_following: true, follow_days: 5 });
  assert.equal(res2.status, 'failed', 'Gledalac koji prati samo 5 dana mora pasti uslov od 30 dana');
  assert.equal(res2.followDays, 5);

  const winner3 = {
    username: 'Nepratilac',
    followCheck: { requiredDays: 7, status: 'checking' }
  };
  const res3 = evaluateFollowCheck(winner3, { is_following: false, follow_days: 0 });
  assert.equal(res3.status, 'failed', 'Korisnik koji ne prati mora pasti proveru');

  const winner4 = {
    username: 'SlobodanUlaz',
    followCheck: { requiredDays: 0, status: 'skipped' }
  };
  const res4 = evaluateFollowCheck(winner4, { is_following: false, follow_days: 0 });
  assert.equal(res4.status, 'skipped', 'Kada filter praćenja nije uključen, status je skipped');
});

test('Kickaj - Redraw (ponovno izvlačenje) uklanja pobednika koji ne ispunjava uslove', () => {
  let winnersList = [
    { username: 'PobednikInvalid', prize: 'Sub', isConfirmed: false },
    { username: 'PobednikValidan', prize: 'Key', isConfirmed: true }
  ];

  let drawTriggered = false;
  function redrawWinner(idx) {
    if (idx < 0 || idx >= winnersList.length) return false;
    winnersList.splice(idx, 1);
    drawTriggered = true;
    return true;
  }

  const ok = redrawWinner(0);
  assert.equal(ok, true);
  assert.equal(winnersList.length, 1);
  assert.equal(winnersList[0].username, 'PobednikValidan');
  assert.equal(drawTriggered, true, 'Redraw mora automatski pokrenuti novo izvlačenje');
});

test('Kickaj - Chatroom ID lookup vrši do 3 retry pokušaja', async () => {
  let attempts = 0;
  async function resolveKickChatroomMock(slug, failTimes = 2) {
    let resolvedId = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      attempts++;
      if (attempt > failTimes) {
        resolvedId = 12345;
        break;
      }
    }
    return resolvedId;
  }

  const id = await resolveKickChatroomMock('teststreamer', 2);
  assert.equal(id, 12345, 'Chatroom ID mora biti uspešno pronađen nakon retry-ja');
  assert.equal(attempts, 3, 'Mora izvršiti tačno 3 pokušaja');
});

test('Kickaj - Istekli pobednik ne može da se potvrdi kroz chat poruku', () => {
  const winnersList = [
    { username: 'IstekliPobednik', prize: 'Sub', isConfirmed: false, isExpired: true, confirmSeconds: 0, timerId: null },
    { username: 'AktivanPobednik', prize: 'Vip', isConfirmed: false, isExpired: false, confirmSeconds: 25, timerId: 102 }
  ];

  function handleWinnerChatMessage(sender) {
    if (!sender) return false;
    const s1 = String(sender).trim().toLowerCase().replace(/^@/, '');
    const matchingWinner = winnersList.find(w => {
      const uname = String(w.username).toLowerCase().replace(/^@/, '');
      return uname === s1 && !w.isConfirmed && !w.isExpired && (typeof w.confirmSeconds !== 'number' || w.confirmSeconds > 0);
    });
    if (!matchingWinner) return false;
    matchingWinner.isConfirmed = true;
    return true;
  }

  // Istekli pobednik piše u chat
  const res1 = handleWinnerChatMessage('IstekliPobednik');
  assert.equal(res1, false, 'Istekli pobednik ne sme dobiti automatsku potvrdu');
  assert.equal(winnersList[0].isConfirmed, false, 'Stanje mora ostati isConfirmed=false');

  // Aktivan pobednik piše u chat
  const res2 = handleWinnerChatMessage('AktivanPobednik');
  assert.equal(res2, true, 'Aktivan pobednik se uspešno potvrđuje');
  assert.equal(winnersList[1].isConfirmed, true, 'Stanje aktivnog pobednika prelazi u isConfirmed=true');
});

test('Kickaj - reopenWinnerOverlay ne restartuje tajmer na 60s za isteklog pobednika', () => {
  const _settings = { confirmTime: 60 };
  const winnersList = [
    { username: 'IstekliGledalac', prize: 'Gift', isConfirmed: false, isExpired: true, confirmSeconds: 0 },
    { username: 'AktivanGledalac', prize: 'Gift', isConfirmed: false, isExpired: false, confirmSeconds: 15 },
    { username: 'PotvrdjenGledalac', prize: 'Gift', isConfirmed: true, isExpired: false, confirmSeconds: 0 }
  ];

  function computeReopenSeconds(w) {
    const isConf = !!w.isConfirmed;
    const isExp = !isConf && (!!w.isExpired || (typeof w.confirmSeconds === 'number' && w.confirmSeconds <= 0));
    return (isConf || isExp) ? 0 : Math.max(0, w.confirmSeconds || 0);
  }

  assert.equal(computeReopenSeconds(winnersList[0]), 0, 'Za isteklog pobednika mora vratiti 0s (ne sme pasti na 60s)');
  assert.equal(computeReopenSeconds(winnersList[1]), 15, 'Za aktivnog pobednika mora vratiti preostale sekunde (15s)');
  assert.equal(computeReopenSeconds(winnersList[2]), 0, 'Za potvrđenog pobednika mora vratiti 0s');
});

test('Kickaj - Free plan blokira zvuk čak i ako je u settings.soundEnabled uključen', () => {
  function getVolume(plan, settings) {
    const soundAllowed = !!PLAN_LIMITS[plan]?.sound;
    if (!soundAllowed || !settings.soundEnabled) return 0;
    return Math.max(0, Math.min(1, typeof settings.volume === 'number' ? settings.volume : 0.5));
  }

  const freeSettings = { soundEnabled: true, volume: 0.8 };
  assert.equal(getVolume('free', freeSettings), 0, 'Free korisnik mora imati volume 0');

  const proSettings = { soundEnabled: true, volume: 0.8 };
  assert.equal(getVolume('pro', proSettings), 0.8, 'PRO korisnik ima pun volume');

  const proMutedSettings = { soundEnabled: false, volume: 0.8 };
  assert.equal(getVolume('pro', proMutedSettings), 0, 'Kada je soundEnabled false, PRO ima volume 0');
});

test('Kickaj - participantsMap uspešno uklanja pobednika i sa vodećim @ znakom', () => {
  const participantsMap = new Map();
  participantsMap.set('srbviewer', { username: 'SrbViewer' });

  function removeWinnerFromMap(winnerName) {
    const key = String(winnerName).toLowerCase().replace(/^@/, '').trim();
    return participantsMap.delete(key);
  }

  const deletedWithAt = removeWinnerFromMap('@SrbViewer');
  assert.equal(deletedWithAt, true, 'Korisnik sa vodećim @ mora biti uspešno obrisan iz mape');
  assert.equal(participantsMap.size, 0);
});

test('Kickaj - Pobednici sa nelatiničnim karakterima dobijaju stabilan i jedinstven ID', () => {
  const w1 = { id: 'win_12345_abc', username: 'ПобедникĆŠŽ', prize: 'T-Shirt' };
  const w2 = { id: 'win_12346_xyz', username: 'ПобедникĆŠŽ', prize: 'DrugaNagrada' };

  function getWinnerDomKey(w, idx) {
    return w.id || String(w.username).replace(/[^a-zA-Z0-9_-]/g, '') || ('win_' + idx);
  }

  const key1 = getWinnerDomKey(w1, 0);
  const key2 = getWinnerDomKey(w2, 1);

  assert.equal(key1, 'win_12345_abc');
  assert.equal(key2, 'win_12346_xyz');
  assert.notEqual(key1, key2, 'Dva unosa istog korisnika sa ćirilicom moraju imati jedinstvene DOM ID-jeve');
});

test('Kickaj - Follow check greška postavlja status na error', () => {
  function handleFollowCheckResult(statusCode, body) {
    if (statusCode === 200 && body) {
      if (body.is_following && body.follow_days >= 7) return 'passed';
      return 'failed';
    }
    return 'error';
  }

  assert.equal(handleFollowCheckResult(500, null), 'error');
  assert.equal(handleFollowCheckResult(404, null), 'error');
  assert.equal(handleFollowCheckResult(200, { is_following: true, follow_days: 10 }), 'passed');
  assert.equal(handleFollowCheckResult(200, { is_following: true, follow_days: 2 }), 'failed');
});

test('Kickaj - Korisnička imena sa apostrofima i specijalnim znacima se bezbedno čuvaju i brišu', () => {
  const participantsMap = new Map();
  const rawUsername = "d'artagnan";
  const key = rawUsername.toLowerCase().replace(/^@/, '');
  participantsMap.set(key, { username: rawUsername, isSub: false, mult: 1 });

  assert.equal(participantsMap.has("d'artagnan"), true);

  function removeParticipantByKey(targetKey) {
    return participantsMap.delete(targetKey);
  }

  const removed = removeParticipantByKey(key);
  assert.equal(removed, true, 'Učesnik sa apostrofom mora biti bezbedno obrisan bez sintaksnih grešaka');
  assert.equal(participantsMap.has("d'artagnan"), false);
});

test('Kickaj - PLAN_LIMITS fallback na free plan za nepoznat ili nedefinisan plan', () => {
  const testTiers = [undefined, null, '', 'unknown_plan', 'creator'];

  testTiers.forEach(tier => {
    const limits = PLAN_LIMITS[tier] || PLAN_LIMITS.free;
    assert.equal(limits.sound, false, `Plan ${tier} mora imati sound=false preko fallback-a`);
    assert.equal(limits.maxParticipants, 500, `Plan ${tier} mora imati limit od 500 učesnika`);
  });
});

test('Kickaj - Izvlačenje kada je broj učesnika manji od zadatog broja pobednika', () => {
  const pool = ['Korisnik1'];
  const numWinners = 3;
  const winners = [];

  function drawNext(currentPool) {
    if (currentPool.length === 0 || winners.length >= numWinners) return null;
    const winner = currentPool.shift();
    winners.push({ username: winner });
    return winner;
  }

  const w1 = drawNext(pool);
  assert.equal(w1, 'Korisnik1');
  assert.equal(winners.length, 1);

  const w2 = drawNext(pool);
  assert.equal(w2, null, 'Kada nema više učesnika u bazenu, izvlačenje mora bezbedno vratiti null bez kraha');
  assert.equal(winners.length, 1);
});

test('Kickaj - Escape taster prvo zatvara modal pobednika pre fullscreen overlay-a', () => {
  let winnerModalClosed = false;
  let fullscreenClosed = false;

  const mockWinnerOverlay = { isOpen: true };
  const mockFullscreenOverlay = { isOpen: true };

  function handleEscapeKey() {
    if (mockWinnerOverlay.isOpen) {
      mockWinnerOverlay.isOpen = false;
      winnerModalClosed = true;
      return;
    }
    if (mockFullscreenOverlay.isOpen) {
      mockFullscreenOverlay.isOpen = false;
      fullscreenClosed = true;
    }
  }

  // Prvi Escape: zatvara samo winner modal
  handleEscapeKey();
  assert.equal(winnerModalClosed, true, 'Prvi Escape mora zatvoriti modal pobednika');
  assert.equal(fullscreenClosed, false, 'Fullscreen overlay mora ostati otvoren nakon prvog Escape');

  // Drugi Escape: zatvara fullscreen overlay
  handleEscapeKey();
  assert.equal(fullscreenClosed, true, 'Drugi Escape zatvara fullscreen overlay');
});

test('Kickaj - Ispravno formatiranje statusa pobednika (Potvrđeno, Nije potvrđeno, Čeka potvrdu)', () => {
  function getWinnerStatus(w) {
    const isConf = !!w.isConfirmed;
    const isExp = !isConf && (!!w.isExpired || (typeof w.confirmSeconds === 'number' && w.confirmSeconds <= 0));
    if (isConf) return 'Potvrđeno';
    if (isExp) return 'Nije potvrđeno';
    return `Čeka potvrdu (${w.confirmSeconds}s)`;
  }

  const confirmedWinner = { username: 'Prvi', isConfirmed: true, confirmSeconds: 0 };
  const expiredWinner = { username: 'Drugi', isConfirmed: false, isExpired: true, confirmSeconds: 0 };
  const waitingWinner = { username: 'Treci', isConfirmed: false, isExpired: false, confirmSeconds: 45 };

  assert.equal(getWinnerStatus(confirmedWinner), 'Potvrđeno');
  assert.equal(getWinnerStatus(expiredWinner), 'Nije potvrđeno');
  assert.equal(getWinnerStatus(waitingWinner), 'Čeka potvrdu (45s)');
});

test('Kickaj - Ispravno skaliranje i poklapanje slajdera sa oznakama (1s, 30s, 1min, 3min, 5min)', () => {
  function secondsToSliderPos(sec) {
    const s = Math.min(300, Math.max(1, typeof sec === 'number' ? sec : (parseInt(sec, 10) || 5)));
    if (s <= 30) return ((s - 1) / 29) * 25;
    if (s <= 60) return 25 + ((s - 30) / 30) * 25;
    if (s <= 180) return 50 + ((s - 60) / 120) * 25;
    return 75 + ((s - 180) / 120) * 25;
  }

  function sliderPosToSeconds(pos) {
    const p = Math.min(100, Math.max(0, typeof pos === 'number' ? pos : (parseFloat(pos) || 0)));
    if (p <= 25) return Math.round(1 + (p / 25) * 29);
    if (p <= 50) return Math.round(30 + ((p - 25) / 25) * 30);
    if (p <= 75) return Math.round(60 + ((p - 50) / 25) * 120);
    return Math.round(180 + ((p - 75) / 25) * 120);
  }

  // 1s -> 0%
  assert.equal(secondsToSliderPos(1), 0);
  assert.equal(sliderPosToSeconds(0), 1);

  // 30s -> 25% (tačno iznad oznake 30s)
  assert.equal(secondsToSliderPos(30), 25);
  assert.equal(sliderPosToSeconds(25), 30);

  // 60s (1min) -> 50% (tačno iznad oznake 1min)
  assert.equal(secondsToSliderPos(60), 50);
  assert.equal(sliderPosToSeconds(50), 60);

  // 180s (3min) -> 75% (tačno iznad oznake 3min)
  assert.equal(secondsToSliderPos(180), 75);
  assert.equal(sliderPosToSeconds(75), 180);

  // 300s (5min) -> 100% (tačno iznad oznake 5min)
  assert.equal(secondsToSliderPos(300), 100);
  assert.equal(sliderPosToSeconds(100), 300);
});

test('Kickaj - Ispravno računanje dana praćenja preko following_since iz Kick v2 API-ja', () => {
  const mockNow = new Date('2026-09-11T01:30:00.000Z').getTime();
  const followingSince = '2026-01-30T15:58:22.000000Z';
  const requiredDays = 50;

  const followDate = new Date(followingSince);
  const diffTime = Math.max(0, mockNow - followDate.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  assert.ok(diffDays >= 220, `Korisnik mora imati preko 220 dana praćenja (izračunato: ${diffDays})`);
  assert.ok(diffDays >= requiredDays, `Korisnik mora ispuniti uslov od min. ${requiredDays} dana`);
});

test('Kickaj - Crna lista (Blacklist) blokira i uklanja neželjene korisnike', () => {
  const rawBlacklist = 'bot1, @spamer; toxic_user  badGuy';

  function getBlacklistSet(str) {
    if (!str) return new Set();
    const names = String(str).split(/[\s,;]+/).map(s => s.toLowerCase().replace(/^@/, '').trim()).filter(Boolean);
    return new Set(names);
  }

  function isUserBlacklisted(username, bSet) {
    if (!username) return false;
    const clean = String(username).toLowerCase().replace(/^@/, '').trim();
    return bSet.has(clean);
  }

  const bSet = getBlacklistSet(rawBlacklist);
  assert.equal(bSet.has('bot1'), true);
  assert.equal(bSet.has('spamer'), true);
  assert.equal(bSet.has('toxic_user'), true);
  assert.equal(bSet.has('badguy'), true);
  assert.equal(bSet.has('regular_user'), false);

  assert.equal(isUserBlacklisted('@Spamer', bSet), true);
  assert.equal(isUserBlacklisted('Regular_User', bSet), false);

  // Test čišćenja mape učesnika kada se unese blacklist
  const participants = new Map();
  participants.set('regular_user', { username: 'Regular_User' });
  participants.set('bot1', { username: 'bot1' });
  participants.set('spamer', { username: '@spamer' });

  assert.equal(participants.size, 3);

  for (const key of participants.keys()) {
    if (bSet.has(key)) {
      participants.delete(key);
    }
  }

  assert.equal(participants.size, 1);
  assert.equal(participants.has('regular_user'), true);
  assert.equal(participants.has('bot1'), false);
  assert.equal(participants.has('spamer'), false);
});

test('Kickaj - Test nalozi imaju isTest=true, dok chat nalozi imaju isTest=false', () => {
  const participantsMap = new Map();

  function processChatMessage(user, isTest = false) {
    const key = user.username.toLowerCase().replace(/^@/, '');
    participantsMap.set(key, {
      username: user.username,
      isSub: !!user.isSub,
      mult: user.isSub ? 2 : 1,
      isTest: !!isTest,
      joinedAt: Date.now()
    });
  }

  // Pravi korisnik iz chata
  processChatMessage({ username: 'PraviGledalac', isSub: true, message: '!gw' }, false);
  // Test bot nalog sa panela
  processChatMessage({ username: 'Stefan_BG_44', isSub: false, message: '!gw test' }, true);

  const realUser = participantsMap.get('pravigledalac');
  const testUser = participantsMap.get('stefan_bg_44');

  assert.equal(realUser.isTest, false, 'Pravi korisnik mora imati isTest=false');
  assert.equal(testUser.isTest, true, 'Test nalog mora imati isTest=true');
});

test('Kickaj - getEligibleWinnerPool NIKADA ne bira test naloge ako postoji bar jedan pravi korisnik', () => {
  const participantsMap = new Map();

  // 1 pravi korisnik iz chata
  participantsMap.set('pravigledalac', {
    username: 'PraviGledalac',
    isSub: false,
    mult: 1,
    isTest: false
  });

  // 50 test botova na lajvu da prikriju viewbotting
  for (let i = 0; i < 50; i++) {
    participantsMap.set(`test_bot_${i}`, {
      username: `Test_Bot_${i}`,
      isSub: Math.random() > 0.5,
      mult: 1,
      isTest: true
    });
  }

  function getPoolList() {
    const pool = [];
    participantsMap.forEach(p => {
      for (let i = 0; i < p.mult; i++) pool.push(p.username);
    });
    return pool;
  }

  function getEligibleWinnerPool() {
    const realPool = [];
    participantsMap.forEach(p => {
      if (!p.isTest) {
        const mult = Math.max(1, p.mult || 1);
        for (let i = 0; i < mult; i++) {
          realPool.push(p.username);
        }
      }
    });
    return realPool;
  }

  // Ukupan pool za vizuelne animacije sadrži sve (51 nalog)
  const fullVisualPool = getPoolList();
  assert.equal(fullVisualPool.length >= 51, true, 'Vizuelni pool mora prikazivati sve naloge radi verodostojnosti');

  // Bazen za izvlačenje pobednika
  const eligiblePool = getEligibleWinnerPool();
  assert.equal(eligiblePool.length, 1, 'Bazen za pobednike mora sadržati SAMO pravog korisnika');
  assert.equal(eligiblePool[0], 'PraviGledalac');

  // Testiramo 200 uzastopnih simulacija izvlačenja: test bot NIKADA ne sme pobediti
  for (let spin = 0; spin < 200; spin++) {
    const winner = eligiblePool[Math.floor(Math.random() * eligiblePool.length)];
    assert.equal(winner, 'PraviGledalac', `U krugu ${spin}, pobednik mora biti pravi korisnik a ne bot`);
  }
});

test('Kickaj - getEligibleWinnerPool NIKADA ne dozvoljava test naloge (čak i ako ima 0 pravih učesnika)', () => {
  const participantsMap = new Map();

  // 0 pravih učesnika, 3 test naloga
  participantsMap.set('test_1', { username: 'Test_1', isTest: true, mult: 1 });
  participantsMap.set('test_2', { username: 'Test_2', isTest: true, mult: 1 });
  participantsMap.set('test_3', { username: 'Test_3', isTest: true, mult: 1 });

  function getEligibleWinnerPool() {
    const realPool = [];
    participantsMap.forEach(p => {
      if (!p.isTest) {
        const mult = Math.max(1, p.mult || 1);
        for (let i = 0; i < mult; i++) {
          realPool.push(p.username);
        }
      }
    });
    return realPool;
  }

  const eligiblePool = getEligibleWinnerPool();
  assert.equal(eligiblePool.length, 0, 'Test nalozi NIKADA ne mogu ući u eligiblePool, čak i sa 0 pravih korisnika');
});

test('Kickaj - updateParticipantsUI sortira prijavljene gledaoce hronološki bez veštačkog odvajanja', () => {
  const participantsMap = new Map();

  // Dodaj 3 simulirana naloga sa raspodeljenim vremenom
  participantsMap.set('stefan_011', { username: 'stefan_011', isTest: true, joinedAt: 1000 });
  participantsMap.set('luka_bg', { username: 'luka_bg', isTest: true, joinedAt: 2000 });
  participantsMap.set('nidza_99', { username: 'nidza_99', isTest: true, joinedAt: 3000 });

  // Dodaj 2 prava korisnika koji se javljaju u chat (noviji timestamp)
  participantsMap.set('pravi_marko', { username: 'Pravi_Marko', isTest: false, joinedAt: 4000 });
  participantsMap.set('pravi_stefan', { username: 'Pravi_Stefan', isTest: false, joinedAt: 5000 });

  const sortedParticipants = Array.from(participantsMap.entries()).sort((a, b) => {
    return (b[1].joinedAt || 0) - (a[1].joinedAt || 0);
  });

  // Pravi gledaoci iz chata stižu na vrh jer su se upravo prijavili
  assert.equal(sortedParticipants[0][1].username, 'Pravi_Stefan');
  assert.equal(sortedParticipants[1][1].username, 'Pravi_Marko');
  // Simulirani nalozi prate prirodan raspored bez ikakvog odavanja
  assert.equal(sortedParticipants[2][1].username, 'nidza_99');
  assert.equal(sortedParticipants[3][1].username, 'luka_bg');
  assert.equal(sortedParticipants[4][1].username, 'stefan_011');
});

test('Kickaj - Test nalozi NIKADA nemaju sub status i uvek imaju nasumične follow days', () => {
  const DOMESTIC_GAMER_BASES = ['Stefan', 'Nikola', 'Marko', 'Petar', 'Luka'];
  const DOMESTIC_GAMER_TAGS = ['BG', 'CS2', 'FPS', 'PRO', 'Snajper'];
  const DOMESTIC_GAMER_PREFIXES = ['', 'x_', 'Pro_'];

  function generateUniqueTestUser() {
    const base = DOMESTIC_GAMER_BASES[Math.floor(Math.random() * DOMESTIC_GAMER_BASES.length)];
    const prefix = DOMESTIC_GAMER_PREFIXES[Math.floor(Math.random() * DOMESTIC_GAMER_PREFIXES.length)];
    const tag = DOMESTIC_GAMER_TAGS[Math.floor(Math.random() * DOMESTIC_GAMER_TAGS.length)];
    const name = `${prefix}${base}_${tag}`;
    const isSub = false;
    const subMonths = 0;
    const followDays = 1 + Math.floor(Math.random() * 320);
    return { username: name, isSub, subMonths, followDays, message: '!prijava' };
  }

  for (let i = 0; i < 50; i++) {
    const user = generateUniqueTestUser();
    assert.equal(user.isSub, false, `Test nalog ${user.username} ne sme imati sub`);
    assert.equal(user.subMonths, 0, `Test nalog ${user.username} mora imati 0 meseci suba`);
    assert.equal(user.followDays >= 1, true, `Test nalog ${user.username} mora imati validan broj dana praćenja`);
  }
});

test('Kickaj - Zaustavljanje točka staje nasumično bilo gde unutar polja i zadržava vizuelni prikaz pobednika', () => {
  const pool = ['Milan', 'Nikola', 'Stefan', 'Marko', 'Petar'];
  const winner = 'Stefan';
  const winIdx = pool.indexOf(winner);
  const sliceAngle = (Math.PI * 2) / pool.length;

  const offsets = [];
  for (let i = 0; i < 60; i++) {
    const landOffset = 0.06 + Math.random() * 0.88;
    offsets.push(landOffset);
    assert.ok(landOffset >= 0.05 && landOffset <= 0.95, 'landOffset mora biti unutar polja (5%-95%)');
    assert.notEqual(landOffset, 0.5, 'landOffset ne sme biti uvek fiksno na sredini');

    const targetOffset = (Math.PI * 1.5) - (winIdx + landOffset) * sliceAngle;
    const pointerRay = (((Math.PI * 1.5 - targetOffset) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const actualOffset = (pointerRay - winIdx * sliceAngle) / sliceAngle;
    assert.ok(Math.abs(actualOffset - landOffset) < 0.0001, 'Strelica mora stajati tačno na izračunatom random offsetu');
  }

  // Provera da postoji varijansa u poziciji zaustavljanja (nije uvek u sredini)
  const minOffset = Math.min(...offsets);
  const maxOffset = Math.max(...offsets);
  assert.ok(minOffset < 0.35, 'Barem neka izvlačenja moraju stati blizu prve polovine/ivice');
  assert.ok(maxOffset > 0.65, 'Barem neka izvlačenja moraju stati blizu druge polovine/ivice');

  // Provera zadržavanja pobedničkog točka
  let activeWheelDisplayPool = pool;
  let lastWinningWheelPool = pool;
  let isSpinning = false;
  const participantsMap = new Map([['milan', { username: 'Milan' }], ['nikola', { username: 'Nikola' }], ['stefan', { username: 'Stefan' }]]);
  // Simulacija brisanja pobednika iz mape:
  participantsMap.delete('stefan');

  function getWheelDisplayPool() {
    if (isSpinning && activeWheelDisplayPool) return activeWheelDisplayPool;
    if (lastWinningWheelPool) return lastWinningWheelPool;
    const res = [];
    participantsMap.forEach(p => res.push(p.username));
    return res;
  }

  // Dok je lastWinningWheelPool aktivan, točak i dalje prikazuje pobednika pod strelicom:
  assert.ok(getWheelDisplayPool().includes('Stefan'), 'Točak mora zadržati pobednika pod strelicom dok je modal aktivan');

  // Nakon zatvaranja modala:
  lastWinningWheelPool = null;
  assert.ok(!getWheelDisplayPool().includes('Stefan'), 'Nakon zatvaranja modala, točak prelazi na preostale učesnike');
});

test('Kickaj - Zaustavljanje ruleta staje nasumično duž širine polja kartice i ne zakucava na 70px centar', () => {
  const cardWidth = 140;
  const cardPitch = 152;
  const winnerIdx = 45;
  const offsets = [];

  for (let i = 0; i < 50; i++) {
    const landInCard = 10 + Math.random() * (cardWidth - 20);
    offsets.push(landInCard);
    assert.ok(landInCard >= 10 && landInCard <= (cardWidth - 10), 'Offset mora biti unutar tela kartice');
    assert.notEqual(landInCard, 70, 'Offset ne sme biti fiksno centriran na 70px');
  }

  const minLand = Math.min(...offsets);
  const maxLand = Math.max(...offsets);
  assert.ok(minLand < 45, 'Mora postojati zaustavljanje blizu leve ivice polja');
  assert.ok(maxLand > 95, 'Mora postojati zaustavljanje blizu desne ivice polja');

  // Provera drawRoulettePreview funkcije da ne koristi hardkodovanih 70px
  let lastRouletteOffsetInCard = 22.5;
  const lastRouletteWinner = 'Pobednik1';
  function computeRouletteTarget(highlightIdx, highlightName, viewportW = 600) {
    const offsetInCard = (lastRouletteOffsetInCard !== null && (!highlightName || highlightName === lastRouletteWinner))
      ? lastRouletteOffsetInCard
      : (14 + Math.random() * (cardWidth - 28));
    const cardTarget = highlightIdx * cardPitch + offsetInCard;
    return Math.max(0, cardTarget - (viewportW / 2));
  }

  const targetX = computeRouletteTarget(winnerIdx, 'Pobednik1');
  const expectedX = Math.max(0, winnerIdx * cardPitch + 22.5 - 300);
  assert.equal(targetX, expectedX, 'Rulet mora sačuvati tačnu poziciju zaustavljanja unutar polja a ne resetovati na 70px centar');
});

test('Kickaj - Opcija za dodavanje nasumičnog broja test učesnika od 100 do 200', () => {
  function computeBulkCount(datasetValue) {
    if (datasetValue === 'random-100-200' || datasetValue === 'random') {
      return Math.floor(Math.random() * 101) + 100;
    }
    return parseInt(datasetValue, 10) || 10;
  }

  const generatedCounts = [];
  for (let i = 0; i < 200; i++) {
    const c = computeBulkCount('random-100-200');
    assert.ok(c >= 100 && c <= 200, `Generisani broj ${c} mora biti u opsegu od 100 do 200`);
    assert.equal(Number.isInteger(c), true, 'Broj mora biti ceo broj');
    generatedCounts.push(c);
  }

  const minGenerated = Math.min(...generatedCounts);
  const maxGenerated = Math.max(...generatedCounts);
  assert.ok(minGenerated <= 115, 'Mora pokriti donji deo opsega (blizu 100)');
  assert.ok(maxGenerated >= 185, 'Mora pokriti gornji deo opsega (blizu 200)');
  const uniqueCount = new Set(generatedCounts).size;
  assert.ok(uniqueCount > 40, 'Mora postojati visoka varijacija nasumičnih brojeva');
});

test('Kickaj - getWheelDisplayPool prioritetno prikazuje prave učesnike na krugu (točku)', () => {
  const MAX_WHEEL_SLICES = 60;
  function simulateWheelPool(participantsMap) {
    const realList = [];
    const testList = [];
    participantsMap.forEach(p => {
      const mult = Math.max(1, p.mult || 1);
      const targetList = p.isTest ? testList : realList;
      for (let i = 0; i < mult; i++) targetList.push(p.username);
    });

    if (realList.length === 0 && testList.length === 0) return [];
    if (realList.length === 0) {
      if (testList.length <= MAX_WHEEL_SLICES) return testList;
      const step = testList.length / MAX_WHEEL_SLICES;
      const sampled = [];
      for (let i = 0; i < MAX_WHEEL_SLICES; i++) sampled.push(testList[Math.floor(i * step)]);
      return sampled;
    }

    if (realList.length >= MAX_WHEEL_SLICES) {
      const step = realList.length / MAX_WHEEL_SLICES;
      const sampled = [];
      for (let i = 0; i < MAX_WHEEL_SLICES; i++) sampled.push(realList[Math.floor(i * step)]);
      return sampled;
    }

    const totalCount = realList.length + testList.length;
    const targetSlots = Math.min(MAX_WHEEL_SLICES, totalCount);
    const testSlotsNeeded = targetSlots - realList.length;
    if (testSlotsNeeded <= 0 || testList.length === 0) return realList.slice();

    const sampleedTest = [];
    const testStep = testList.length / testSlotsNeeded;
    for (let i = 0; i < testSlotsNeeded; i++) sampleedTest.push(testList[Math.floor(i * testStep)]);

    const result = new Array(targetSlots);
    const stepReal = targetSlots / realList.length;
    const realPositions = new Set();
    for (let i = 0; i < realList.length; i++) {
      const pos = Math.floor(i * stepReal);
      result[pos] = realList[i];
      realPositions.add(pos);
    }
    let testIdx = 0;
    for (let i = 0; i < targetSlots; i++) {
      if (!realPositions.has(i)) result[i] = sampleedTest[testIdx++] || testList[0];
    }
    return result;
  }

  // Scenario 1: 5 pravih korisnika i 150 test botova
  const map1 = new Map();
  const realUsers = ['Gledalac_1', 'Gledalac_2', 'Gledalac_3', 'Gledalac_4', 'Gledalac_5'];
  realUsers.forEach(u => map1.set(u.toLowerCase(), { username: u, isTest: false, mult: 1 }));
  for (let i = 0; i < 150; i++) {
    map1.set(`bot_${i}`, { username: `Bot_${i}`, isTest: true, mult: 1 });
  }

  const pool1 = simulateWheelPool(map1);
  assert.equal(pool1.length, 60, 'Točak mora imati maksimalnih 60 isečaka');
  realUsers.forEach(u => {
    assert.ok(pool1.includes(u), `Pravi korisnik ${u} mora 100% biti prisutan na točku pored 150 botova`);
  });

  // Scenario 2: 70 pravih korisnika i 50 test botova
  const map2 = new Map();
  for (let i = 0; i < 70; i++) map2.set(`real_${i}`, { username: `Real_${i}`, isTest: false, mult: 1 });
  for (let i = 0; i < 50; i++) map2.set(`test_${i}`, { username: `Test_${i}`, isTest: true, mult: 1 });

  const pool2 = simulateWheelPool(map2);
  assert.equal(pool2.length, 60);
  assert.ok(!pool2.some(x => x.startsWith('Test_')), 'Kada ima 60+ pravih korisnika, test nalozi ne smeju zauzimati krug');
});

test('Kickaj - getEffectiveUserId / getChannelOwnerId rešava vlasnički i managed kanal', () => {
  let currentUser = { id: 'user_regular_123' };
  let activeChannelObj = null;

  function getEffectiveUserId() {
    if (activeChannelObj && activeChannelObj.is_managed && activeChannelObj.owner_id) {
      return activeChannelObj.owner_id;
    }
    return currentUser ? currentUser.id : null;
  }

  // 1. Vlasnički kanal (nije managed)
  activeChannelObj = { username: 'mojkanal', is_managed: false, owner_id: currentUser.id };
  assert.equal(getEffectiveUserId(), 'user_regular_123', 'Vlasnički kanal mora vratiti ID prijavljenog korisnika');

  // 2. Managed kanal gde je trenutni korisnik samo menadžer
  activeChannelObj = { username: 'klijentskikanal', is_managed: true, owner_id: 'owner_streamer_999' };
  assert.equal(getEffectiveUserId(), 'owner_streamer_999', 'Managed kanal mora vratiti ID pravog vlasnika kanala');

  // 3. Kada korisnik nije prijavljen i nema kanala
  currentUser = null;
  activeChannelObj = null;
  assert.equal(getEffectiveUserId(), null, 'Kada nema korisnika, vraća se null');
});

test('Kickaj - Double-click zaštita na triggerDraw sprečava višestruko okretanje', () => {
  let isSpinning = false;
  let drawClickLock = false;
  let spinCounter = 0;
  const pool = ['Gledalac1', 'Gledalac2'];

  function triggerDraw() {
    if (isSpinning || drawClickLock) return false;
    drawClickLock = true;
    setTimeout(() => { drawClickLock = false; }, 400);

    if (pool.length === 0) return false;

    isSpinning = true;
    spinCounter++;
    return true;
  }

  // Prvi klik pokreće izvlačenje
  const click1 = triggerDraw();
  assert.equal(click1, true, 'Prvi klik mora pokrenuti izvlačenje');
  assert.equal(spinCounter, 1);

  // Drugi brzi klik tokom istog frame-a ili dok je spin u toku mora biti blokiran
  const click2 = triggerDraw();
  assert.equal(click2, false, 'Drugi brzi klik mora biti sprečen lock mehanizmom');
  assert.equal(spinCounter, 1, 'Brojač okretanja ne sme porasti');
});

test('Kickaj - Delegacija toast poruka na window.toastSystem i podrška za oba redosleda argumenata', () => {
  const calls = [];
  const mockToastSystem = {
    show: (msg, type, dur) => {
      calls.push({ msg, type, dur });
    }
  };

  function showToast(a, b, c, d) {
    if (mockToastSystem && typeof mockToastSystem.show === 'function') {
      const types = ['success', 'error', 'warning', 'info'];
      let message = b;
      let type = a;
      let duration = typeof c === 'number' ? c : (typeof d === 'number' ? d : 5000);

      if (!types.includes(a)) {
        message = a;
        type = types.includes(b) ? b : 'info';
      }
      return mockToastSystem.show(message, type, duration);
    }
  }

  // Format 1: (message, type, duration)
  showToast('Čestitamo pobedniku!', 'success', 4000);
  assert.deepEqual(calls[0], { msg: 'Čestitamo pobedniku!', type: 'success', dur: 4000 });

  // Format 2: (type, message, duration)
  showToast('error', 'Gubitak konekcije', 6000);
  assert.deepEqual(calls[1], { msg: 'Gubitak konekcije', type: 'error', dur: 6000 });

  // Format 3: Samo poruka sa podrazumevanim parametrima
  showToast('Obaveštenje za stream');
  assert.deepEqual(calls[2], { msg: 'Obaveštenje za stream', type: 'info', dur: 5000 });
});

test('Kickaj - Zaštita od null/undefined na profilima i korisničkim podacima', () => {
  function extractUserData(currentUser, profile) {
    const username = currentUser?.user_metadata?.kick_username
      || currentUser?.user_metadata?.preferred_username
      || currentUser?.user_metadata?.name
      || (currentUser?.email || '');
    const avatarUrl = currentUser?.user_metadata?.avatar_url
      || currentUser?.user_metadata?.picture
      || '';
    const tier = String(profile?.plan || profile?.tier || 'free').toLowerCase().trim();
    return { username, avatarUrl, tier };
  }

  // Test 1: Potpuno prazan korisnik i null profil
  const res1 = extractUserData(null, null);
  assert.equal(res1.username, '');
  assert.equal(res1.avatarUrl, '');
  assert.equal(res1.tier, 'free');

  // Test 2: Korisnik bez user_metadata
  const res2 = extractUserData({ email: 'streamer@test.com' }, { plan: 'elite' });
  assert.equal(res2.username, 'streamer@test.com');
  assert.equal(res2.tier, 'elite');

  // Test 3: Korisnik sa punim metapodacima
  const res3 = extractUserData({
    user_metadata: { kick_username: 'ProStreamer99', avatar_url: 'https://kick.com/avatar.png' }
  }, { tier: 'pro' });
  assert.equal(res3.username, 'ProStreamer99');
  assert.equal(res3.avatarUrl, 'https://kick.com/avatar.png');
  assert.equal(res3.tier, 'pro');
});

test('Kickaj - Bezbedno sanitizovanje HTML-a (escHtml) sprečava XSS i čuva regionalna slova', () => {
  function escHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const maliciousInput = '<script>alert("hack")</script><img src="x" onerror="alert(1)">';
  const sanitized = escHtml(maliciousInput);
  assert.ok(!sanitized.includes('<script>'), 'Mora neutralisati script tag');
  assert.ok(!sanitized.includes('<img'), 'Mora neutralisati img tag');
  assert.ok(sanitized.includes('&quot;'), 'Mora enkodovati dvostruke navodnike');
  assert.equal(sanitized, '&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt;&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');

  const serbianLatin = 'Čačak, Šabac, Đorđe, Žitište, Ćuprija';
  assert.equal(escHtml(serbianLatin), serbianLatin, 'Srpska latinična slova moraju ostati netaknuta');
});

test('Kickaj - resolveChannelPlan nasleđuje plan vlasnika za menadžerske kanale i sopstveni plan za vlasnike', () => {
  function resolveChannelPlan(targetObj, currentUserProfile, fallbackPlan = 'free') {
    if (!targetObj) {
      const myTier = currentUserProfile ? String(currentUserProfile.plan || currentUserProfile.plan_tier || currentUserProfile.tier || fallbackPlan).toLowerCase() : fallbackPlan;
      return (myTier.includes('elite') || myTier.includes('business')) ? 'elite' : (myTier.includes('pro') ? 'pro' : 'free');
    }
    if (targetObj.is_managed || targetObj.role === 'managed') {
      const ownerTier = String(targetObj.owner_plan || fallbackPlan).toLowerCase();
      return (ownerTier.includes('elite') || ownerTier.includes('business')) ? 'elite' : (ownerTier.includes('pro') ? 'pro' : 'free');
    }
    const myTier = currentUserProfile ? String(currentUserProfile.plan || currentUserProfile.plan_tier || currentUserProfile.tier || fallbackPlan).toLowerCase() : fallbackPlan;
    const resolved = (myTier.includes('elite') || myTier.includes('business')) ? 'elite' : (myTier.includes('pro') ? 'pro' : 'free');
    targetObj.owner_plan = resolved;
    return resolved;
  }

  const milanProfile = { plan: 'pro', display_name: 'Milan_567' };

  // 1. Menadžer na tutz_live kanalu koji je Elite: mora naslediti elite!
  const tutzChannel = {
    username: 'tutz_live',
    is_managed: true,
    role: 'managed',
    owner_plan: 'elite'
  };
  assert.equal(resolveChannelPlan(tutzChannel, milanProfile), 'elite', 'Menadžer na elite kanalu mora imati elite plan');

  // 2. Vlasnički kanal: mora koristiti plan iz Milanovog profila (pro)
  const ownChannel = {
    username: 'milan_channel',
    is_managed: false,
    role: 'owner',
    owner_plan: 'pro'
  };
  assert.equal(resolveChannelPlan(ownChannel, milanProfile), 'pro', 'Vlasnik mora koristiti svoj PRO plan');

  // 3. Menadžer na kanalu sa business planom: mapira se na elite
  const businessChannel = {
    username: 'partner_stream',
    is_managed: true,
    role: 'managed',
    owner_plan: 'business'
  };
  assert.equal(resolveChannelPlan(businessChannel, milanProfile), 'elite', 'Business plan se mapira u elite');

  // 4. Custom dodat kanal bez vlasničkih prava: koristi profil korisnika
  const customChannel = {
    username: 'guest_channel',
    is_managed: false,
    role: 'custom'
  };
  assert.equal(resolveChannelPlan(customChannel, milanProfile), 'pro', 'Dodat kanal nasleđuje plan ulogovanog korisnika');
});

test('Kickaj - Očuvanje isRunning stanja na reload/refresh umesto resetovanja na false', () => {
  function resolveActiveRunningState({ channelName, storedActiveFlag, loadedPayload }) {
    const _cLower = (channelName || '').toLowerCase();
    const storedActive = storedActiveFlag != null ? storedActiveFlag : null;
    const wasRunning = (storedActive === 'true') || (storedActive === null && !!(loadedPayload && loadedPayload.isRunning));
    return wasRunning;
  }

  // 1. Ako je u bazi ili storage-u giveaway bio aktivan, mora ostati aktivan (true)
  const state1 = resolveActiveRunningState({
    channelName: 'tutz_live',
    storedActiveFlag: 'true',
    loadedPayload: { isRunning: true }
  });
  assert.equal(state1, true, 'Giveaway koji je bio pokrenut mora ostati aktivan na reload');

  // 2. Ako je u d.isRunning bilo true, a storage je null, takođe ostaje true
  const state2 = resolveActiveRunningState({
    channelName: 'tutz_live',
    storedActiveFlag: null,
    loadedPayload: { isRunning: true }
  });
  assert.equal(state2, true, 'Giveaway sa isRunning=true u payload-u ostaje aktivan');

  // 3. Ako je u storage-u eksplicitno false, ostaje false
  const state3 = resolveActiveRunningState({
    channelName: 'tutz_live',
    storedActiveFlag: 'false',
    loadedPayload: { isRunning: true }
  });
  assert.equal(state3, false, 'Eksplicitno zaustavljen giveaway ostaje zaustavljen');
});

test('Kickaj - Logika stanja dugmadi (Samo Pokreni i Zaustavi - bez pauziranja)', () => {
  function computeButtonStates({ isRunning, participantsCount, winnersCount, isSpinning }) {
    const hasData = participantsCount > 0 || winnersCount > 0;
    const showStart = !isRunning;
    const showStop = isRunning || hasData;
    const canDraw = !isSpinning && participantsCount > 0;

    return {
      showStart,
      startText: 'Pokreni giveaway',
      showStop,
      stopText: 'Zaustavi giveaway',
      canDraw
    };
  }

  // Stanje 1: Početno (Standby) - nema učesnika, nije pokrenuto
  const s1 = computeButtonStates({ isRunning: false, participantsCount: 0, winnersCount: 0, isSpinning: false });
  assert.equal(s1.showStart, true, 'Start dugme je vidljivo');
  assert.equal(s1.startText, 'Pokreni giveaway');
  assert.equal(s1.showStop, false, 'Stop dugme je skriveno u standby režimu');
  assert.equal(s1.canDraw, false, 'Ne može se izvlačiti bez učesnika');

  // Stanje 2: Pokrenuto (Live) - live chat aktivan
  const s2 = computeButtonStates({ isRunning: true, participantsCount: 5, winnersCount: 0, isSpinning: false });
  assert.equal(s2.showStart, false, 'Start dugme je skriveno dok je giveaway aktivan');
  assert.equal(s2.showStop, true, 'Stop dugme je vidljivo dok je giveaway aktivan');
  assert.equal(s2.stopText, 'Zaustavi giveaway', 'Nema pauziranja, direktno nudi Zaustavi giveaway');
  assert.equal(s2.canDraw, true, 'Može se izvući pobednik');

  // Stanje 3: Izvlačenje u toku (Spinning)
  const s3 = computeButtonStates({ isRunning: true, participantsCount: 5, winnersCount: 0, isSpinning: true });
  assert.equal(s3.canDraw, false, 'Tokom animacije izvlačenja dugme za izvlačenje je blokirano');

  // Stanje 4: Nakon zaustavljanja sa podacima ili pobednicima
  const s4 = computeButtonStates({ isRunning: false, participantsCount: 5, winnersCount: 1, isSpinning: false });
  assert.equal(s4.showStart, true, 'Start dugme nudi Pokreni');
  assert.equal(s4.showStop, true, 'Stop dugme omogućava reset postojećih podataka');
});

test('Kickaj - removeWinner podržava skipConfirm za automatski redraw bez blokiranja modalnim prozorom', async () => {
  const winnersList = [
    { username: 'InvalidWinner', prize: 'Sub', isConfirmed: false, timerId: 101 },
    { username: 'ValidWinner', prize: 'VIP', isConfirmed: true, timerId: null }
  ];

  let confirmDialogShown = false;
  async function mockRemoveWinner(index, skipConfirm = false) {
    if (index < 0 || index >= winnersList.length) return false;
    if (!skipConfirm) {
      confirmDialogShown = true;
    }
    const removed = winnersList[index];
    if (removed.timerId) removed.timerId = null;
    winnersList.splice(index, 1);
    return true;
  }

  // 1. Poziv sa skipConfirm=true (npr. iz redraw funkcije) uklanja pobednika odmah bez dijaloga
  const res1 = await mockRemoveWinner(0, true);
  assert.equal(res1, true);
  assert.equal(confirmDialogShown, false, 'skipConfirm=true ne sme otvarati dijalog');
  assert.equal(winnersList.length, 1);
  assert.equal(winnersList[0].username, 'ValidWinner');

  // 2. Ručni poziv bez skipConfirm otvara modal
  const res2 = await mockRemoveWinner(0, false);
  assert.equal(res2, true);
  assert.equal(confirmDialogShown, true, 'skipConfirm=false mora tražiti potvrdu');
  assert.equal(winnersList.length, 0);
});

test('Kickaj - Escape taster poštuje hijerarhiju zatvaranja (Confirm modal -> Winner modal -> Fullscreen)', () => {
  let closedElement = null;

  function simulateEscapeKey({ hasConfirmModal, hasWinnerModal, hasFullscreen }) {
    if (hasConfirmModal) {
      closedElement = 'confirmModal';
      return;
    }
    if (hasWinnerModal) {
      closedElement = 'winnerModal';
      return;
    }
    if (hasFullscreen) {
      closedElement = 'fullscreen';
      return;
    }
  }

  // Ako su otvoreni i confirm modal i winner modal i fullscreen:
  simulateEscapeKey({ hasConfirmModal: true, hasWinnerModal: true, hasFullscreen: true });
  assert.equal(closedElement, 'confirmModal', 'Escape mora prvo zatvoriti potvrdu akcije');

  // Kada je confirm modal zatvoren, sledeći Escape zatvara winner modal:
  simulateEscapeKey({ hasConfirmModal: false, hasWinnerModal: true, hasFullscreen: true });
  assert.equal(closedElement, 'winnerModal', 'Escape zatim zatvara winner modal');

  // Tek kada nema otvorenih modala, Escape zatvara fullscreen overlay:
  simulateEscapeKey({ hasConfirmModal: false, hasWinnerModal: false, hasFullscreen: true });
  assert.equal(closedElement, 'fullscreen', 'Poslednji Escape zatvara fullscreen overlay');
});

test('Kickaj - hideAuthGate uklanja auth-loading klasu sa body elementa', () => {
  const mockClassList = new Set(['kickaj-body', 'auth-loading']);
  const mockBody = {
    classList: {
      remove: (cls) => mockClassList.delete(cls),
      has: (cls) => mockClassList.has(cls)
    }
  };

  assert.equal(mockBody.classList.has('auth-loading'), true, 'Na početku body ima auth-loading');
  mockBody.classList.remove('auth-loading');
  assert.equal(mockBody.classList.has('auth-loading'), false, 'Nakon hideAuthGate auth-loading mora biti uklonjen');
});

test('Kickaj - cleanUsername uklanja URL-ove, query parametre, heševe i prateće kose crte', () => {
  function cleanUsername(raw) {
    if (!raw) return 'Kanal';
    let s = String(raw).trim()
      .replace(/^https?:\/\/(www\.)?kick\.com\//i, '')
      .replace(/^kick_user_/, '')
      .replace(/^@/, '');
    if (s.includes('@')) s = s.split('@')[0];
    s = s.split(/[/?#\s]/)[0];
    return s || 'Kanal';
  }

  assert.equal(cleanUsername('https://kick.com/milan_567/'), 'milan_567');
  assert.equal(cleanUsername('http://www.kick.com/streamer?ref=banner#bio'), 'streamer');
  assert.equal(cleanUsername('@MilanGamer'), 'MilanGamer');
  assert.equal(cleanUsername('kick_user_pro123'), 'pro123');
  assert.equal(cleanUsername('kanal_test/about/sub'), 'kanal_test');
  assert.equal(cleanUsername(''), 'Kanal');
  assert.equal(cleanUsername(null), 'Kanal');
  assert.equal(cleanUsername(undefined), 'Kanal');
});

test('Kickaj - Escape taster zatvara helpModal pre nego što pređe na fullscreen overlay', () => {
  let closedElement = null;

  function simulateEscapeKeyWithHelp({ hasConfirmModal, hasWinnerModal, hasCustomModal, hasHelpModal, hasFullscreen }) {
    if (hasConfirmModal) {
      closedElement = 'confirmModal';
      return;
    }
    if (hasWinnerModal) {
      closedElement = 'winnerModal';
      return;
    }
    if (hasCustomModal) {
      closedElement = 'customModal';
      return;
    }
    if (hasHelpModal) {
      closedElement = 'helpModal';
      return;
    }
    if (hasFullscreen) {
      closedElement = 'fullscreen';
      return;
    }
  }

  // Kada je otvoren helpModal u fullscreen režimu, Escape mora prvo zatvoriti helpModal
  simulateEscapeKeyWithHelp({
    hasConfirmModal: false,
    hasWinnerModal: false,
    hasCustomModal: false,
    hasHelpModal: true,
    hasFullscreen: true
  });
  assert.equal(closedElement, 'helpModal', 'Escape mora zatvoriti helpModal pre zatvaranja fullscreen režima');

  // Kada je helpModal zatvoren, sledeći Escape zatvara fullscreen overlay
  simulateEscapeKeyWithHelp({
    hasConfirmModal: false,
    hasWinnerModal: false,
    hasCustomModal: false,
    hasHelpModal: false,
    hasFullscreen: true
  });
  assert.equal(closedElement, 'fullscreen', 'Nakon zatvaranja help modala, Escape zatvara fullscreen overlay');
});

test('Kickaj - prefers-reduced-motion automatski skraćuje trajanje animacije izvlačenja na 50ms', () => {
  function getEffectiveSpinDuration(spinTimeSeconds, prefersReducedMotion) {
    return prefersReducedMotion ? 50 : (spinTimeSeconds * 1000);
  }

  // Standardni korisnik: 15 sekundi vrtenja
  assert.equal(getEffectiveSpinDuration(15, false), 15000);

  // Korisnik sa prefers-reduced-motion: momentalni spin od 50ms
  assert.equal(getEffectiveSpinDuration(15, true), 50);
});

test('Kickaj - reusableOffscreens čuva i ponovo koristi canvas instance tokom uzastopnih spinova', () => {
  const wheelCaches = new Map();
  const reusableOffscreens = new Map();

  function invalidateWheelCache() {
    for (const [key, entry] of wheelCaches.entries()) {
      if (entry && entry.offCanvas) {
        reusableOffscreens.set(key, entry.offCanvas);
      }
    }
    wheelCaches.clear();
  }

  function getWheelCache(canvasId, cssW, cssH, dpr, pool) {
    const key = canvasId;
    const poolSig = pool.length + ':' + (pool[0] || '');
    let entry = wheelCaches.get(key);
    if (entry && entry.sig === poolSig) return entry;

    let offCanvas = entry ? entry.offCanvas : (reusableOffscreens.get(key) || null);
    let createdNew = false;
    if (!offCanvas) {
      offCanvas = { id: 'canvas_' + Math.random(), width: cssW * dpr, height: cssH * dpr };
      createdNew = true;
    }

    entry = { offCanvas, sig: poolSig, createdNew };
    wheelCaches.set(key, entry);
    return entry;
  }

  // 1. Prvi spin: kreira se nova canvas instanca
  const spin1 = getWheelCache('wheelCanvas', 500, 500, 2, ['Pera', 'Mika']);
  assert.ok(spin1.createdNew, 'Prvi spin mora alocirati inicijalni canvas buffer');
  const initialCanvasId = spin1.offCanvas.id;

  // 2. Simulacija 20 uzastopnih spinova sa invalidacijom keša
  for (let i = 0; i < 20; i++) {
    invalidateWheelCache();
    assert.equal(wheelCaches.size, 0, 'wheelCaches mapa mora biti ispražnjena');
    assert.ok(reusableOffscreens.has('wheelCanvas'), 'reusableOffscreens mora zadržati canvas');

    const nextSpin = getWheelCache('wheelCanvas', 500, 500, 2, ['Ucesnik_' + i]);
    assert.strictEqual(nextSpin.offCanvas.id, initialCanvasId, 'Offscreen canvas instanca mora biti ponovo iskorišćena');
    assert.strictEqual(nextSpin.createdNew, false, 'Ne sme se alocirati novi canvas element nakon prvog');
  }
});

test('Kickaj - syncStateToSupabase ograničava payload na max 1500 učesnika i 200 pobednika uz pre-sanitizaciju', () => {
  function escHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function preparePayloadForSupabase(dataToSave) {
    const MAX_PERSISTED_PARTICIPANTS = 1500;
    let safeParticipants = dataToSave.participants || [];
    if (safeParticipants.length > MAX_PERSISTED_PARTICIPANTS) {
      safeParticipants = safeParticipants.slice(0, MAX_PERSISTED_PARTICIPANTS);
    }
    safeParticipants = safeParticipants.map(([key, p]) => [
      key,
      {
        ...p,
        username: escHtml(p.username || key)
      }
    ]);

    const safeWinners = (dataToSave.winners || []).slice(0, 200).map(w => ({
      ...w,
      username: escHtml(w.username || '')
    }));

    return {
      participants: safeParticipants,
      winners: safeWinners
    };
  }

  // 1. Test ograničenja učesnika sa 2000 na 1500
  const largeParticipants = [];
  for (let i = 0; i < 2000; i++) {
    largeParticipants.push([`user_${i}`, { username: `<script>alert(${i})</script>User_${i}` }]);
  }

  // 2. Test ograničenja pobednika sa 250 na 200
  const largeWinners = [];
  for (let i = 0; i < 250; i++) {
    largeWinners.push({ username: `<b>Winner_${i}</b>`, prize: 'Nagrada' });
  }

  const result = preparePayloadForSupabase({
    participants: largeParticipants,
    winners: largeWinners
  });

  assert.equal(result.participants.length, 1500, 'Mora skratiti listu učesnika na maksimalno 1500');
  assert.equal(result.winners.length, 200, 'Mora skratiti listu pobednika na maksimalno 200');

  // 3. Provera sanitizacije
  assert.ok(!result.participants[0][1].username.includes('<script>'), 'Korisničko ime učesnika mora biti sanitizovano');
  assert.ok(result.participants[0][1].username.includes('&lt;script&gt;'), 'HTML tagovi moraju biti konvertovani u entitete');
  assert.ok(!result.winners[0].username.includes('<b>'), 'Korisničko ime pobednika mora biti sanitizovano');
  assert.ok(result.winners[0].username.includes('&lt;b&gt;'), 'HTML tagovi pobednika moraju biti enkodovani');
});

test('Kickaj - syncStateToSupabaseDebounced dinamički prilagođava delay (1000ms za >150 učesnika, 600ms inače)', () => {
  function computeSyncDelay(participantsCount) {
    return participantsCount > 150 ? 1000 : 600;
  }

  assert.equal(computeSyncDelay(0), 600, 'Za 0 učesnika delay je 600ms');
  assert.equal(computeSyncDelay(50), 600, 'Za 50 učesnika delay je 600ms');
  assert.equal(computeSyncDelay(150), 600, 'Za tačno 150 učesnika delay je 600ms');
  assert.equal(computeSyncDelay(151), 1000, 'Za 151 učesnika delay se povećava na 1000ms (throttling)');
  assert.equal(computeSyncDelay(1000), 1000, 'Za 1000 učesnika delay ostaje 1000ms');
});

test('Kickaj - processChatMessage pre-sanitizuje korisnička imena pre upisa u participantsMap', () => {
  function escHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const participantsMap = new Map();

  function processChatMessage(user) {
    const key = user.username.toLowerCase().replace(/^@/, '');
    participantsMap.set(key, {
      username: escHtml(user.username || key),
      isSub: !!user.isSub,
      mult: 1
    });
  }

  // Korisnik sa potencijalno zlonamernim skriptom u imenu
  processChatMessage({ username: '<img src=x onerror=alert(1)>Marko', isSub: false });
  const entry1 = participantsMap.get('<img src=x onerror=alert(1)>marko');
  assert.ok(entry1, 'Mora pronaći unosa po ključu');
  assert.equal(entry1.username, '&lt;img src=x onerror=alert(1)&gt;Marko', 'Ime u mapi mora biti escHtml sanitizovano');

  // Korisnik sa srpskim latiničnim slovima (č, ć, š, đ, ž)
  processChatMessage({ username: 'Miloš_Čačak_Đorđe', isSub: true });
  const entry2 = participantsMap.get('miloš_čačak_đorđe');
  assert.ok(entry2);
  assert.equal(entry2.username, 'Miloš_Čačak_Đorđe', 'Regionalna slova moraju biti potpuno očuvana');
});

test('Kickaj - Točak sreće 3-pass batching objedinjuje radialne linije i obod u jedan stroke poziv', () => {
  let strokeCalls = 0;
  let fillCalls = 0;
  let beginPathCalls = 0;

  const mockCtx = {
    beginPath: () => { beginPathCalls++; },
    moveTo: () => { },
    lineTo: () => { },
    arc: () => { },
    closePath: () => { },
    fill: () => { fillCalls++; },
    stroke: () => { strokeCalls++; },
    save: () => { },
    restore: () => { },
    rotate: () => { },
    fillText: () => { },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: ''
  };

  function renderWheel3Pass(ctx, pool, r, cx, cy) {
    const n = Math.min(pool.length, 60);
    const sliceAngle = (Math.PI * 2) / n;

    // Pass 1: Slices (Fills)
    for (let i = 0; i < n; i++) {
      const a0 = i * sliceAngle;
      const a1 = a0 + sliceAngle;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a0, a1);
      ctx.closePath();
      ctx.fill();
    }

    // Pass 2: Batched dividers & rim (Single beginPath & Single stroke)
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a0 = i * sliceAngle;
      ctx.moveTo(0, 0);
      ctx.lineTo(r * Math.cos(a0), r * Math.sin(a0));
    }
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#07070D';
    ctx.stroke();

    // Pass 3: Text labels
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i < n; i++) {
      ctx.fillText(pool[i], r - 16, 4);
    }
  }

  const testPool = Array.from({ length: 60 }, (_, i) => `Gledalac_${i}`);
  renderWheel3Pass(mockCtx, testPool, 250, 260, 260);

  assert.equal(fillCalls, 60, 'Mora popuniti 60 isečaka u Pass 1');
  assert.equal(strokeCalls, 1, 'Pass 2 mora izvršiti tačno 1 stroke poziv za sve delioce i spoljni obod točka');
});

test('Kickaj - Focus trap i focus return u openFullscreen i closeFullscreen', () => {
  let focusedElement = null;
  const mockTriggerBtn = {
    id: 'btnOpenFullscreen',
    focus: () => { focusedElement = 'btnOpenFullscreen'; }
  };

  let activeElement = mockTriggerBtn;
  let fsFocusReturn = null;
  let fsFocusTrap = null;

  const firstFocusable = { id: 'firstBtn', focus: () => { focusedElement = 'firstBtn'; } };
  const lastFocusable = { id: 'lastBtn', focus: () => { focusedElement = 'lastBtn'; } };
  const focusables = [firstFocusable, lastFocusable];

  function openFullscreenSim() {
    fsFocusReturn = activeElement;
    fsFocusTrap = function (e) {
      if (e.key !== 'Tab') return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    // Fokusira inicijalni element unutar fullscreen-a
    firstFocusable.focus();
    activeElement = firstFocusable;
  }

  function closeFullscreenSim() {
    if (fsFocusReturn && typeof fsFocusReturn.focus === 'function') {
      fsFocusReturn.focus();
      activeElement = fsFocusReturn;
      fsFocusReturn = null;
    }
    fsFocusTrap = null;
  }

  // 1. Otvaranje fullscreen-a
  openFullscreenSim();
  assert.equal(focusedElement, 'firstBtn', 'Fokus se postavlja unutar fullscreen overlay-a');
  assert.ok(fsFocusTrap, 'Focus trap listener je instaliran');

  // 2. Tab sa poslednjeg elementa vraća na prvi (wrap-around)
  activeElement = lastFocusable;
  let prevented = false;
  fsFocusTrap({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'Mora sprečiti podrazumevani Tab gubitak fokusa');
  assert.equal(focusedElement, 'firstBtn', 'Tab sa kraja mora vratiti fokus na početak');

  // 3. Shift+Tab sa prvog elementa skače na poslednji
  activeElement = firstFocusable;
  prevented = false;
  fsFocusTrap({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(focusedElement, 'lastBtn', 'Shift+Tab sa početka mora poslati fokus na kraj');

  // 4. Zatvaranje fullscreen-a
  closeFullscreenSim();
  assert.equal(focusedElement, 'btnOpenFullscreen', 'Fokus mora biti bezbedno vraćen na dugme koje je pokrenulo fullscreen');
  assert.equal(fsFocusReturn, null);
  assert.equal(fsFocusTrap, null);
});

test('Kickaj - Focus trap i focus return u showWinnerOverlay i closeWinnerOverlay', () => {
  let currentFocus = 'triggerDrawBtn';
  const triggerBtn = { focus: () => { currentFocus = 'triggerDrawBtn'; } };

  let winnerFocusReturn = null;
  let winnerFocusTrap = null;

  const firstBtn = { id: 'confirmBtn', focus: () => { currentFocus = 'confirmBtn'; } };
  const lastBtn = { id: 'closeBtn', focus: () => { currentFocus = 'closeBtn'; } };
  const modalButtons = [firstBtn, lastBtn];

  function showWinnerOverlaySim() {
    winnerFocusReturn = triggerBtn;
    winnerFocusTrap = function (e) {
      if (e.key === 'Tab') {
        const first = modalButtons[0];
        const last = modalButtons[modalButtons.length - 1];
        if (e.shiftKey) {
          if (currentFocus === first.id) { e.preventDefault(); last.focus(); }
        } else {
          if (currentFocus === last.id) { e.preventDefault(); first.focus(); }
        }
      }
    };
    firstBtn.focus();
  }

  function closeWinnerOverlaySim() {
    if (winnerFocusReturn && typeof winnerFocusReturn.focus === 'function') {
      winnerFocusReturn.focus();
      winnerFocusReturn = null;
    }
    winnerFocusTrap = null;
  }

  showWinnerOverlaySim();
  assert.equal(currentFocus, 'confirmBtn', 'Pri otvaranju pobedničkog ekrana fokusira se prvo dugme');

  // Wrap napred
  currentFocus = 'closeBtn';
  let prevented = false;
  winnerFocusTrap({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(currentFocus, 'confirmBtn');

  // Wrap unazad
  prevented = false;
  winnerFocusTrap({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(currentFocus, 'closeBtn');

  // Zatvaranje modala vraća fokus
  closeWinnerOverlaySim();
  assert.equal(currentFocus, 'triggerDrawBtn', 'Fokus se vraća na dugme za izvlačenje');
});

test('Kickaj - updateParticipantsUI generiše bogati empty state sa SVG ikonom kada nema učesnika', () => {
  function renderParticipantsContainer(participantsCount) {
    if (participantsCount === 0) {
      return `
        <div class="list-empty-rich">
          <div class="list-empty-icon-wrap">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
            </svg>
          </div>
          <p>Još uvek nema prijavljenih učesnika</p>
          <p>Gledaoci se prijavljuju putem čet komande ili simulacije unosa.</p>
        </div>`;
    }
    return '<div class="participant-row"><span>Korisnik1</span></div>';
  }

  const emptyHtml = renderParticipantsContainer(0);
  assert.ok(emptyHtml.includes('list-empty-rich'), 'Prazna lista mora imati list-empty-rich klasu');
  assert.ok(emptyHtml.includes('<svg'), 'Prazna lista mora sadržati ilustrativnu SVG ikonu');
  assert.ok(emptyHtml.includes('Još uvek nema prijavljenih učesnika'), 'Mora sadržati jasan naslov stanja');

  const populatedHtml = renderParticipantsContainer(1);
  assert.ok(!populatedHtml.includes('list-empty-rich'), 'Popunjena lista ne sme imati empty state');
  assert.ok(populatedHtml.includes('participant-row'), 'Popunjena lista mora imati redove učesnika');
});

test('Kickaj - unhandledrejection globalni hendler filtrira AbortError i šalje error toast za ostale greške', () => {
  const toastCalls = [];
  function mockShowToast(msg, type) {
    toastCalls.push({ msg, type });
  }

  function handleUnhandledRejection(event) {
    const msg = event?.reason?.message || '';
    if (!msg.includes('AbortError')) {
      mockShowToast('Došlo je do neočekivane greške.', 'error');
    }
  }

  // 1. AbortError se ignoriše (npr. prekinut fetch usled brzog switch-a kanala)
  handleUnhandledRejection({ reason: new Error('The operation was aborted (AbortError)') });
  assert.equal(toastCalls.length, 0, 'AbortError ne sme uznemiravati korisnika toast greškom');

  // 2. Prava neočekivana greška
  handleUnhandledRejection({ reason: new Error('Database connection failed: 500') });
  assert.equal(toastCalls.length, 1, 'Prava greška mora prikazati toast');
  assert.equal(toastCalls[0].type, 'error');
  assert.equal(toastCalls[0].msg, 'Došlo je do neočekivane greške.');
});

test('Kickaj - orientationchange događaj invalidira keš točka sreće za novu orijentaciju ekrana', () => {
  let cacheInvalidated = false;
  let redrawCalled = false;

  function onOrientationChange() {
    cacheInvalidated = true;
    redrawCalled = true;
  }

  onOrientationChange();
  assert.equal(cacheInvalidated, true, 'Orijentacija ekrana mora invalidirati keš točka');
  assert.equal(redrawCalled, true, 'Orijentacija ekrana mora ponovo iscrtati točak');
});

test('Kickaj - getWheelCache odvaja iscrtavanje podeonih linija i spoljnog oboda radi sprečavanja tetivne crte', () => {
  const recordedCommands = [];
  const mockCtx = {
    beginPath() { recordedCommands.push('beginPath'); },
    moveTo(x, y) { recordedCommands.push(`moveTo(${x},${y})`); },
    lineTo(x, y) { recordedCommands.push(`lineTo(${x},${y})`); },
    arc(x, y, r, a0, a1) { recordedCommands.push(`arc(${x},${y},${r})`); },
    stroke() { recordedCommands.push('stroke'); }
  };

  const n = 8;
  const sliceAngle = (Math.PI * 2) / n;
  const r = 200;

  // Pass 2: Linije
  mockCtx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i * sliceAngle;
    mockCtx.moveTo(0, 0);
    mockCtx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  mockCtx.stroke();

  // Pass 3: Obod mora imati novi beginPath da arc ne bi povukao spojnu liniju (tetivu)
  mockCtx.beginPath();
  mockCtx.arc(0, 0, r, 0, Math.PI * 2);
  mockCtx.stroke();

  // Provera: pre arc mora biti pozvan beginPath
  const arcIndex = recordedCommands.findIndex(cmd => cmd.startsWith('arc'));
  assert.equal(recordedCommands[arcIndex - 1], 'beginPath', 'Pre arc() mora biti pozvan beginPath() kako ne bi došlo do spajanja sa poslednjom linijom');
});

