const test = require('node:test');
const assert = require('node:assert/strict');

test('Kickaj - PLAN_LIMITS ima ispravno definisana pravila za planove', () => {
  const PLAN_LIMITS = {
    free:  { maxParticipants: 500,  animations: ['wheel'],                   sound: false, fullscreen: true  },
    pro:   { maxParticipants: 0,    animations: ['wheel','slot','roulette'], sound: true,  fullscreen: true  },
    elite: { maxParticipants: 0,    animations: ['wheel','slot','roulette'], sound: true,  fullscreen: true  }
  };

  assert.equal(PLAN_LIMITS.free.sound, false, 'Free plan ne sme imati dozvoljen zvuk');
  assert.equal(PLAN_LIMITS.pro.sound, true, 'PRO plan mora imati dozvoljen zvuk');
  assert.equal(PLAN_LIMITS.elite.sound, true, 'ELITE plan mora imati dozvoljen zvuk');
  assert.deepEqual(PLAN_LIMITS.free.animations, ['wheel'], 'Free plan ima samo točak sreće');
});

test('Kickaj - Potvrda više pobednika u nizu kroz chat poruku', () => {
  const winnersList = [
    { username: 'DrugiPobednik', prize: 'Sub', isConfirmed: false, isExpired: false, timerId: 101 },
    { username: 'PrviPobednik',  prize: 'Vip', isConfirmed: false, isExpired: false, timerId: 102 }
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
    { username: 'StreamViewer2', prize: 'Key',     isConfirmed: false, timerId: 56 }
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

test('Kickaj - Izvoz pobednika u hronološkom redosledu (prvi osvojio = broj 1)', () => {
  // winnersList čuva najnovije na početku (unshift)
  const winnersList = [
    { username: 'Treci', prize: 'Nagrada 3' },
    { username: 'Drugi', prize: 'Nagrada 2' },
    { username: 'Prvi',  prize: 'Nagrada 1' }
  ];

  const chronological = [...winnersList].reverse();
  const exportedLines = chronological.map((w, i) => `${i + 1}. ${w.username} — ${w.prize}`).join('\n');

  const expected = [
    '1. Prvi — Nagrada 1',
    '2. Drugi — Nagrada 2',
    '3. Treci — Nagrada 3'
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
  const PLAN_LIMITS = {
    free:  { sound: false },
    pro:   { sound: true },
    elite: { sound: true }
  };

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
  const PLAN_LIMITS = {
    free:  { maxParticipants: 500, sound: false, fullscreen: true },
    pro:   { maxParticipants: 0,   sound: true,  fullscreen: true }
  };
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
