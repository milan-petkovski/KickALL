/* ═══════════════════════════════════════════════════════════
   Kickot Dashboard — app logic (dashboard.js)
   Supabase CRUD + Real-time + UI
   ═══════════════════════════════════════════════════════════ */

// ── Supabase Init ──────────────────────────────────────────
const SUPABASE_URL = 'https://rcukparptzzyssqdmydt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdWtwYXJwdHp6eXNzcWRteWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Nzc3NzEsImV4cCI6MjA5OTA1Mzc3MX0.5FLpFchORq6h5O0q5HWWYBiRD6qCPZKGjx3Zo4UhlJc';
const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ─────────────────────────────────────────────────
let currentUser = null;
let currentChannels = [];   // [{id, username, is_primary}]
let activeChannel = null; // {id, username}
let allCommands = [];   // cached custom commands
let allLeaderboard = [];   // cached leaderboard rows
let allWatchtime = [];   // cached watchtime rows
let allMarriages = [];   // cached marriages
let allLoveStatuses = [];  // cached love modifiers
let editingCmdId = null; // null = new, UUID = edit
let confirmCallback = null;
let realtimeSub = null;
let configLoaded = false;
let localAnnounces = [];   // cached auto-announce messages
let activeLeaderboardType = localStorage.getItem('active-leaderboard-tab') || 'chatters'; // 'chatters' or 'watchtime'
let activeCommandsTab = 'all'; // 'all', 'system', 'custom', 'builtin'

// ── Built-in commands reference ────────────────────────────
const BUILTIN_COMMANDS = [
  { cmd: '!aktivnost', desc: 'Tvoja aktivnost ovog meseca' },
  { cmd: '!top', desc: 'Top 10 aktivnih gledalaca' },
  { cmd: '!watchtime', desc: 'Tvoj ukupni watchtime' },
  { cmd: '!topwatchtime', desc: 'Top 10 gledalaca po watchtime-u' },
  { cmd: '!vreme', desc: 'Prognoza vremena za grad' },
  { cmd: '!love', desc: 'Kompatibilnost između dva korisnika' },
  { cmd: '!vencaj', desc: 'Zaprosi korisnika i sklopi brak' },
  { cmd: '!razvod', desc: 'Razvedi se od partnera' },
  { cmd: '!samar', desc: 'Pošalji šamar korisniku' },
  { cmd: '!roll', desc: 'Slučajni roll / dvoboj' },
  { cmd: '!duel', desc: 'Izazovi nekoga na duel' },
  { cmd: '!iq', desc: 'Izmeri IQ korisnika' },
  { cmd: '!info', desc: 'Nasumična zanimljivost' },
  { cmd: '!cooldown', desc: 'Provera cooldown-a' },
];

// ═══════════════════════════════════════════════════════════
// AUTH GUARD
// ═══════════════════════════════════════════════════════════
async function initAuth() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      document.getElementById('authGateMsg').textContent = 'Preusmerjavanje na prijavu...';
      setTimeout(() => { window.location.href = 'index.html?login=1'; }, 1200);
      return;
    }
    currentUser = session.user;
    await initApp();
  } catch (err) {
    document.getElementById('authGateMsg').textContent = 'Greška pri proveri sesije.';
    console.error(err);
  }
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { window.location.href = 'index.html'; }
});

// ═══════════════════════════════════════════════════════════
// APP INIT
// ═══════════════════════════════════════════════════════════
async function initApp() {
  // Load user profile + channels
  await loadUserProfile();

  // Show app
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('app').style.display = 'grid';

  // Sidebar avatar/name
  const name = currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'User';
  document.getElementById('sidebarAvatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('sidebarName').textContent = name;

  // Set initial leaderboard tab from state (loaded from localStorage)
  setLeaderboardType(activeLeaderboardType);

  // Load initial panel
  if (activeChannel) {
    loadAllData();
    const lastPanel = localStorage.getItem('active-dashboard-panel') || 'overview';
    switchPanel(lastPanel);
  } else {
    // No channel configured — prompt
    showNoChannelState();
  }

  renderBuiltinCommands();
  populateMonthSelector();
}

// ── User Profile ──────────────────────────────────────────
async function loadUserProfile() {
  const { data, error } = await sb.from('user_profiles')
    .select('display_name, plan, kick_channels')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (data) {
    document.getElementById('sidebarPlan').textContent =
      (data.plan || 'free').charAt(0).toUpperCase() + (data.plan || 'free').slice(1);

    currentChannels = data.kick_channels || [];
    if (currentChannels.length > 0) {
      const primary = currentChannels.find(c => c.is_primary) || currentChannels[0];
      setActiveChannel(primary);
    }
  }

  renderChannelList();
}

function setActiveChannel(ch) {
  activeChannel = ch;
  document.getElementById('channelNameDisplay').textContent = ch.username;
  document.getElementById('channelAvatar').textContent = ch.username.charAt(0).toUpperCase();
  document.getElementById('topbarChannel').textContent = `@${ch.username}`;
  document.getElementById('cmdPrefixBadge').textContent = '!';
}

function renderChannelList() {
  const list = document.getElementById('channelList');
  if (!list) return;
  list.innerHTML = '';

  if (currentChannels.length === 0) {
    list.innerHTML = '<div style="padding:0.5rem 0.75rem;font-size:0.8125rem;color:var(--text-muted)">Nema dodanih kanala</div>';
    return;
  }

  currentChannels.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'channel-option' + (activeChannel?.id === ch.id ? ' selected' : '');
    div.innerHTML = `
      <div class="channel-avatar" style="width:22px;height:22px;font-size:0.65rem">${ch.username.charAt(0).toUpperCase()}</div>
      <span class="ch-name">${ch.username}</span>
      ${activeChannel?.id === ch.id ? '<span class="ch-check">✓</span>' : ''}
    `;
    div.onclick = () => selectChannel(ch);
    list.appendChild(div);
  });
}

async function selectChannel(ch) {
  setActiveChannel(ch);
  renderChannelList();
  toggleChannelMenu();
  await loadAllData();
}

function showNoChannelState() {
  showToast('info', 'Dodaj Kick kanal da počneš', 'ℹ️');
  setTimeout(() => showAddChannelModal(), 800);
}

// ── Channel Management ────────────────────────────────────
function extractKickUsername(input) {
  let val = input.trim();
  // Ukloni URL delove
  val = val.replace(/https?:\/\/(www\.)?kick\.com\//i, '');
  // Ukloni eventualni @ na početku
  val = val.replace(/^@/, '');
  // Uzmi samo prvi deo do sledećeg kosog poteza ili space-a ili upitnika
  val = val.split(/[/?\s]/)[0];
  return val.toLowerCase();
}

async function resolveChatroomId(username) {
  const apiUrl = `https://kick.com/api/v2/channels/${username}`;

  // 1. Pokušavamo preko corsproxy.io
  try {
    const proxyUrl = `https://corsproxy.io/?` + encodeURIComponent(apiUrl);
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.chatroom && data.chatroom.id) {
        return {
          id: data.chatroom.id.toString(),
          username: data.slug || username
        };
      }
    }
  } catch (err) {
    console.warn('corsproxy.io failed, trying fallback...', err);
  }

  // 2. Pokušavamo preko allorigins.win
  try {
    const fallbackUrl = `https://api.allorigins.win/get?url=` + encodeURIComponent(apiUrl);
    const res = await fetch(fallbackUrl);
    if (res.ok) {
      const resData = await res.json();
      if (resData && resData.contents) {
        const data = JSON.parse(resData.contents);
        if (data && data.chatroom && data.chatroom.id) {
          return {
            id: data.chatroom.id.toString(),
            username: data.slug || username
          };
        }
      }
    }
  } catch (err) {
    console.error('All fallbacks failed for resolving channel:', err);
  }

  return null;
}

// ── Channel Management ────────────────────────────────────
async function addChannel() {
  const rawInput = document.getElementById('newChannelInput').value.trim();
  const errEl = document.getElementById('addChannelError');
  errEl.style.display = 'none';

  if (!rawInput) {
    errEl.textContent = 'Unesi Kick username ili link kanala.';
    errEl.style.display = 'block';
    return;
  }

  const username = extractKickUsername(rawInput);
  if (!username) {
    errEl.textContent = 'Nevalidan unos kanala.';
    errEl.style.display = 'block';
    return;
  }

  setLoading('addChannelBtn', true);
  const resolved = await resolveChatroomId(username);

  if (!resolved) {
    setLoading('addChannelBtn', false);
    errEl.textContent = `Kanal "${username}" nije pronađen na Kick platformi. Proveri ispravnost.`;
    errEl.style.display = 'block';
    return;
  }

  const { id: channelId, username: channelName } = resolved;

  if (currentChannels.some(c => c.id === channelId)) {
    setLoading('addChannelBtn', false);
    errEl.textContent = 'Ovaj kanal je već dodat na tvoj nalog.';
    errEl.style.display = 'block';
    return;
  }

  const newChannel = {
    id: channelId,
    username: channelName,
    is_primary: currentChannels.length === 0
  };

  const updatedChannels = [...currentChannels, newChannel];

  const { error } = await sb.from('user_profiles')
    .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  setLoading('addChannelBtn', false);

  if (error) {
    errEl.textContent = 'Greška pri čuvanju kanala u bazu. Pokušaj ponovo.';
    errEl.style.display = 'block';
    return;
  }

  currentChannels = updatedChannels;
  setActiveChannel(newChannel);
  renderChannelList();
  closeModal('addChannelModal');
  document.getElementById('newChannelInput').value = '';
  showToast('success', `Kanal @${channelName} je uspešno dodat!`, '✅');
  await loadAllData();
}

// ═══════════════════════════════════════════════════════════
// DATA LOADERS
// ═══════════════════════════════════════════════════════════
async function loadAllData() {
  if (!activeChannel) return;

  // Pokrećemo učitavanje asinhrono bez blokiranja celog toka (non-blocking)
  loadCommands();
  loadLeaderboard();
  loadWatchtime();
  loadMarriages();
  loadLoveStatuses();
  loadBotConfig();
  loadBotStatus();
  loadChannelLiveStatus();

  setupRealtimeChannels();
}

async function refreshAllData() {
  if (!activeChannel) return;
  showToast('info', 'Osvežavam podatke...', '🔄');
  await loadAllData();
  showToast('success', 'Podaci osveženi!', '✅');
}

// ── Commands ──────────────────────────────────────────────
// ── Commands ──────────────────────────────────────────────
async function loadCommands() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('custom_commands')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('channel_id', activeChannel.id)
    .order('created_at', { ascending: false });

  if (error) { console.error('Commands:', error); return; }
  allCommands = data || [];
  renderMiniCommands(allCommands);
  document.getElementById('cmdCount').textContent = allCommands.length;
  document.getElementById('statCmdCount').textContent = allCommands.length;

  renderUnifiedCommands();
}

function setCommandsTab(tab) {
  activeCommandsTab = tab;

  // Promeni aktivne klase na tab dugmadima
  const tabs = {
    all: document.getElementById('cmdTabAll'),
    system: document.getElementById('cmdTabSystem'),
    custom: document.getElementById('cmdTabCustom'),
    builtin: document.getElementById('cmdTabBuiltin')
  };

  Object.keys(tabs).forEach(k => {
    if (tabs[k]) {
      tabs[k].className = k === tab ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    }
  });

  // Očisti pretragu
  const searchInput = document.getElementById('cmdSearchInput');
  if (searchInput) searchInput.value = '';

  renderUnifiedCommands();
}

function renderUnifiedCommands(customCmds = null) {
  const tbody = document.getElementById('commandsBody');
  if (!tbody) return;

  let rows = [];
  const tab = activeCommandsTab;

  if (tab === 'builtin') {
    // Renderovanje ugrađenih bot komandi
    rows = BUILTIN_COMMANDS.map(c => ({
      command: c.cmd.slice(1),
      response: c.desc,
      cooldown_ms: 3000,
      uses_count: '—',
      enabled: true,
      is_default: false,
      is_builtin: true
    }));
  } else {
    // Filtriranje podataka iz baze
    let source = customCmds || allCommands;
    if (tab === 'system') {
      rows = source.filter(c => c.is_default);
    } else if (tab === 'custom') {
      rows = source.filter(c => !c.is_default);
    } else {
      rows = source;
    }
  }

  updateCmdTableMeta(rows.length);

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nema komandi za prikaz u ovoj kategoriji.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(cmd => {
    // Više aliasa prikazujemo kao zasebne bedževe
    const cmdBadges = cmd.command.split(',').map(c => `<span class="td-cmd">!${escapeHtml(c.trim())}</span>`).join(' ');

    // Tip bedž
    let typeBadge = '';
    if (cmd.is_builtin) {
      typeBadge = '<span class="badge-type badge-builtin">🤖 Default (Bot)</span>';
    } else if (cmd.is_default) {
      typeBadge = '<span class="badge-type badge-system">⭐ Specijalna (Kanal)</span>';
    } else {
      typeBadge = '<span class="badge-type badge-custom">👤 Korisnička</span>';
    }

    // Akcije i prebacivanje statusa su onemogućeni za ugrađene komande
    let actionsHtml = '—';
    let statusHtml = '';

    if (cmd.is_builtin) {
      statusHtml = `
        <span class="status-pill status-active" style="opacity: 0.7">
          <span class="status-dot status-on"></span>
          Aktivna
        </span>
      `;
    } else {
      statusHtml = `
        <span class="status-pill ${cmd.enabled ? 'status-active' : 'status-inactive'}">
          <span class="status-dot ${cmd.enabled ? 'status-on' : 'status-off'}"></span>
          ${cmd.enabled ? 'Aktivna' : 'Isključena'}
        </span>
      `;

      const toggleIcon = cmd.enabled
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;

      const editIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

      const deleteIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

      actionsHtml = `
        <div class="actions-cell">
          <button class="action-btn" onclick="toggleCommand('${cmd.id}', ${cmd.enabled})" title="${cmd.enabled ? 'Isključi' : 'Uključi'}">
            ${toggleIcon}
          </button>
          <button class="action-btn" onclick="editCommand('${cmd.id}')" title="Izmeni">
            ${editIcon}
          </button>
          <button class="action-btn danger" onclick="deleteCommandConfirm('${cmd.id}', '!${escapeHtml(cmd.command)}')" title="Obriši">
            ${deleteIcon}
          </button>
        </div>
      `;
    }

    return `
      <tr>
        <td><div class="cmd-badge-list">${cmdBadges}</div></td>
        <td>${typeBadge}</td>
        <td><span class="td-response" title="${escapeHtml(cmd.response)}">${escapeHtml(cmd.response)}</span></td>
        <td class="td-num">${(cmd.cooldown_ms / 1000).toFixed(0)}s</td>
        <td class="td-num">${cmd.uses_count ?? 0}</td>
        <td>${statusHtml}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join('');
}

function renderMiniCommands(cmds) {
  const el = document.getElementById('miniCommands');
  if (!el) return;

  if (cmds.length === 0) {
    el.innerHTML = '<div class="mini-empty">Nema prilagođenih komandi</div>';
    return;
  }

  el.innerHTML = cmds.slice(0, 6).map(cmd => {
    const cmdBadges = cmd.command.split(',').map(c => `<span class="td-cmd" style="font-size:0.75rem; padding: 0.1rem 0.25rem;">!${escapeHtml(c.trim())}</span>`).join(' ');
    return `
      <div class="mini-item" style="display:flex; justify-content:space-between; align-items:center;">
        <div class="cmd-badge-list" style="max-width: 40%;">${cmdBadges}</div>
        <span class="mini-username" style="color:var(--text-muted);font-size:0.8rem;flex:1;margin-left:0.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(cmd.response)}</span>
        <span class="status-pill ${cmd.enabled ? 'status-active' : 'status-inactive'}" style="font-size:0.6rem; flex-shrink:0; padding: 0.2rem 0.4rem; display: inline-flex; align-items: center; justify-content: center;">
          <span class="status-dot ${cmd.enabled ? 'status-on' : 'status-off'}" style="width: 5px; height: 5px;"></span>
        </span>
      </div>
    `;
  }).join('');
}

function filterCommands(query) {
  const q = query.toLowerCase();
  const tab = activeCommandsTab;

  if (tab === 'builtin') {
    // Filtriranje ugrađenih
    const filtered = BUILTIN_COMMANDS.filter(c =>
      c.cmd.toLowerCase().includes(q) ||
      c.desc.toLowerCase().includes(q)
    ).map(c => ({
      command: c.cmd.slice(1),
      response: c.desc,
      cooldown_ms: 3000,
      uses_count: '—',
      enabled: true,
      is_default: false,
      is_builtin: true
    }));
    renderUnifiedCommands(filtered);
  } else {
    // Filtriranje custom iz baze
    let source = allCommands;
    if (tab === 'system') {
      source = allCommands.filter(c => c.is_default);
    } else if (tab === 'custom') {
      source = allCommands.filter(c => !c.is_default);
    }

    const filtered = source.filter(c =>
      c.command.toLowerCase().includes(q) ||
      c.response.toLowerCase().includes(q)
    );
    renderUnifiedCommands(filtered);
  }
}

function updateCmdTableMeta(n) {
  const tab = activeCommandsTab;
  const label = tab === 'builtin' ? 'ugrađenih komandi' : 'prilagođenih komandi';
  document.getElementById('cmdTableMeta').textContent = `${n} ${label}`;
}

// ── Leaderboard ───────────────────────────────────────────
function populateMonthSelector() {
  const sel = document.getElementById('lbMonthSelect');
  if (!sel) return;

  const now = new Date();
  const months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    months.push({ value: `${m}-${y}`, label: `${m}/${y}` });
  }

  sel.innerHTML = months.map(m =>
    `<option value="${m.value}">${m.label}</option>`
  ).join('');
}

async function loadLeaderboard() {
  if (!activeChannel) return;
  const sel = document.getElementById('lbMonthSelect');
  const month = sel?.value || getCurrentMonth();

  const { data, error } = await sb.from('leaderboard')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .eq('month', month)
    .order('points', { ascending: false })
    .limit(200);

  if (error) { console.error('Leaderboard:', error); return; }
  allLeaderboard = data || [];
  renderMiniLeaderboard(allLeaderboard.slice(0, 5));
  if (allLeaderboard.length > 0) {
    document.getElementById('statTopPoints').textContent = allLeaderboard[0]?.points ?? '—';
  }

  // Nakon učitavanja leaderboarda, ako je aktivni tab 'chatters', renderujemo ga
  if (activeLeaderboardType === 'chatters') {
    renderUnifiedLeaderboard();
  }
}

async function loadWatchtime() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('watchtime')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .order('minutes', { ascending: false })
    .limit(200);

  if (error) { console.error('Watchtime:', error); return; }
  allWatchtime = data || [];
  renderMiniWatchtime(allWatchtime.slice(0, 5));

  const totalMins = allWatchtime.reduce((s, r) => s + (r.minutes || 0), 0);
  document.getElementById('statTotalWatchtime').textContent =
    totalMins >= 60 ? `${Math.round(totalMins / 60)}h` : `${totalMins}min`;

  // Nakon učitavanja watchtime-a, ako je aktivni tab 'watchtime', renderujemo ga
  if (activeLeaderboardType === 'watchtime') {
    renderUnifiedLeaderboard();
  }
}
function setLeaderboardType(type) {
  activeLeaderboardType = type;
  localStorage.setItem('active-leaderboard-tab', type);

  // Izmeni klase na tab dugmadima
  const tabChatters = document.getElementById('lbTabChatters');
  const tabWatchtime = document.getElementById('lbTabWatchtime');

  if (tabChatters && tabWatchtime) {
    if (type === 'chatters') {
      tabChatters.className = 'btn btn-sm btn-primary';
      tabWatchtime.className = 'btn btn-sm btn-outline';
    } else {
      tabChatters.className = 'btn btn-sm btn-outline';
      tabWatchtime.className = 'btn btn-sm btn-primary';
    }
  }

  // Izmeni klase u sidebar navigaciji
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`[data-panel="leaderboard"]`);
  if (navItem) navItem.classList.add('active');
  document.getElementById('breadcrumbPage').textContent = type === 'chatters' ? 'Leaderboard' : 'Watchtime';

  // Izmeni zaglavlje tabele
  const header = document.getElementById('leaderboardTableHeader');
  if (header) {
    if (type === 'chatters') {
      header.innerHTML = `
        <th style="width:60px">#</th>
        <th>Korisnik</th>
        <th>Poeni</th>
        <th>Mesec</th>
        <th>Ažurirano</th>
      `;
    } else {
      header.innerHTML = `
        <th style="width:60px">#</th>
        <th>Korisnik</th>
        <th>Ukupno minuta</th>
        <th>Sati gledanja</th>
        <th>Ažurirano</th>
      `;
    }
  }

  // Očisti input za pretragu
  const searchInput = document.getElementById('leaderboardSearchInput');
  if (searchInput) searchInput.value = '';

  renderUnifiedLeaderboard();
}

function renderUnifiedLeaderboard(customRows = null) {
  const isChatters = activeLeaderboardType === 'chatters';
  const rows = customRows || (isChatters ? allLeaderboard : allWatchtime);

  // Renderovanje podijuma (top 3)
  renderPodium(rows.slice(0, 3));

  const tbody = document.getElementById('leaderboardBody');
  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">Nema podataka za prikaz.</td></tr>`;
    document.getElementById('lbTableMeta').textContent = '0 korisnika';
    return;
  }

  document.getElementById('lbTableMeta').textContent = `${rows.length} korisnika`;

  tbody.innerHTML = rows.map((row, i) => {
    if (isChatters) {
      return `
        <tr>
          <td><strong style="color:${rankColor(i)}">${i + 1}.</strong></td>
          <td>
            <div style="display:flex;align-items:center;gap:0.5rem">
              <div style="width:24px;height:24px;border-radius:50%;background:var(--app-gradient);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0">
                ${(row.display_name || row.username || '?').charAt(0).toUpperCase()}
              </div>
              <span style="font-weight:600">${escapeHtml(row.display_name || row.username)}</span>
            </div>
          </td>
          <td class="td-num" style="color:${rankColor(i)}">${row.points} pt</td>
          <td style="color:var(--text-muted)">${row.month}</td>
          <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
        </tr>
      `;
    } else {
      const hours = Math.floor((row.minutes || 0) / 60);
      const mins = (row.minutes || 0) % 60;
      return `
        <tr>
          <td><strong style="color:${rankColor(i)}">${i + 1}.</strong></td>
          <td>
            <div style="display:flex;align-items:center;gap:0.5rem">
              <div style="width:24px;height:24px;border-radius:50%;background:var(--app-gradient);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0">
                ${(row.display_name || row.username || '?').charAt(0).toUpperCase()}
              </div>
              <span style="font-weight:600">${escapeHtml(row.display_name || row.username)}</span>
            </div>
          </td>
          <td class="td-num">${row.minutes} min</td>
          <td class="td-num" style="color:var(--kick-green); font-weight: 600;">${hours}h ${mins}min</td>
          <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
        </tr>
      `;
    }
  }).join('');
}

function renderPodium(top3) {
  const el = document.getElementById('lbPodium');
  if (!el) return;

  if (top3.length === 0) {
    el.innerHTML = '';
    return;
  }

  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const classes = ['podium-2', 'podium-1', 'podium-3'];
  const nums = ['2.', '🥇', '3.'];
  const isChatters = activeLeaderboardType === 'chatters';

  el.innerHTML = order.map((row, i) => {
    const cls = top3.length > 1 ? classes[i] : 'podium-1';
    const num = top3.length > 1 ? nums[i] : '🥇';
    let valStr = '';
    if (isChatters) {
      valStr = `${row.points} pt`;
    } else {
      const h = Math.floor((row.minutes || 0) / 60);
      valStr = `${h}h`;
    }
    return `
      <div class="podium-item ${cls}">
        <div class="podium-avatar">${(row.display_name || row.username || '?').charAt(0).toUpperCase()}</div>
        <div class="podium-name">${escapeHtml(row.display_name || row.username)}</div>
        <div class="podium-points">${valStr}</div>
        <div class="podium-base">${num}</div>
      </div>
    `;
  }).join('');
}

function renderMiniLeaderboard(rows) {
  const el = document.getElementById('miniLeaderboard');
  if (!el) return;
  if (rows.length === 0) { el.innerHTML = '<div class="mini-empty">Nema podataka</div>'; return; }
  el.innerHTML = rows.map((row, i) => `
    <div class="mini-item">
      <div class="mini-rank rank-${i < 3 ? i + 1 : 'n'}">${i + 1}</div>
      <span class="mini-username">${escapeHtml(row.display_name || row.username)}</span>
      <span class="mini-value">${row.points} pt</span>
    </div>
  `).join('');
}

function filterLeaderboard(q) {
  const isChatters = activeLeaderboardType === 'chatters';
  const source = isChatters ? allLeaderboard : allWatchtime;
  const filtered = source.filter(r =>
    (r.display_name || r.username || '').toLowerCase().includes(q.toLowerCase())
  );
  renderUnifiedLeaderboard(filtered);
}

function exportLeaderboard() {
  const isChatters = activeLeaderboardType === 'chatters';
  if (isChatters) {
    if (allLeaderboard.length === 0) { showToast('error', 'Nema podataka za export', '❌'); return; }
    const csv = ['Rank,Username,Points,Month,Updated']
      .concat(allLeaderboard.map((r, i) => `${i + 1},${r.display_name || r.username},${r.points},${r.month},${r.updated_at}`))
      .join('\n');
    downloadCsv(csv, `leaderboard_chatters_${activeChannel?.username}_${getCurrentMonth()}.csv`);
  } else {
    if (allWatchtime.length === 0) { showToast('error', 'Nema podataka za export', '❌'); return; }
    const csv = ['Rank,Username,Minutes,Hours,Updated']
      .concat(allWatchtime.map((r, i) => `${i + 1},${r.display_name || r.username},${r.minutes},${Math.floor(r.minutes / 60)},${r.updated_at}`))
      .join('\n');
    downloadCsv(csv, `leaderboard_watchtime_${activeChannel?.username}.csv`);
  }
}

function renderMiniWatchtime(rows) {
  const el = document.getElementById('miniWatchtime');
  if (!el) return;
  if (rows.length === 0) { el.innerHTML = '<div class="mini-empty">Nema podataka</div>'; return; }
  el.innerHTML = rows.map((row, i) => {
    const h = Math.floor((row.minutes || 0) / 60);
    return `
      <div class="mini-item">
        <div class="mini-rank rank-${i < 3 ? i + 1 : 'n'}">${i + 1}</div>
        <span class="mini-username">${escapeHtml(row.display_name || row.username)}</span>
        <span class="mini-value">${h}h</span>
      </div>
    `;
  }).join('');
}

// ── Marriages ─────────────────────────────────────────────
async function loadMarriages() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('marriages')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .order('married_at', { ascending: false });

  if (error) { console.error('Marriages:', error); return; }
  allMarriages = data || [];
  renderMarriages(allMarriages);
  document.getElementById('marriageTableMeta').textContent = `${allMarriages.length} aktivnih brakova`;
  document.getElementById('statMarriages').textContent = allMarriages.length;
}

async function loadLoveStatuses() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('love_modifiers')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) { console.error('Love modifiers:', error); return; }
  allLoveStatuses = data || [];
  renderLoveStatuses(allLoveStatuses);

  const meta = document.getElementById('loveStatusMeta');
  if (meta) meta.textContent = `${allLoveStatuses.length} statusa`;
}

function renderMarriages(rows) {
  const tbody = document.getElementById('marriagesBody');
  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nema aktivnih brakova u kanalu.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => `
    <tr>
      <td style="font-weight:600">${escapeHtml(row.user1_display || row.user1)}</td>
      <td style="text-align:center;font-size:1.125rem">💍</td>
      <td style="font-weight:600">${escapeHtml(row.user2_display || row.user2)}</td>
      <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.married_at)}</td>
      <td>
        <div class="actions-cell">
          <button class="action-btn danger" onclick="divorceConfirm('${row.id}', '${escapeHtml(row.user1)}', '${escapeHtml(row.user2)}')" title="Razvod (Admin)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="9.8" y1="8.2" x2="21" y2="19"/><line x1="9.8" y1="15.8" x2="21" y2="5"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function getLoveStatusLabel(modifier) {
  if (modifier >= 50) return 'Sjajno';
  if (modifier >= 25) return 'Visoko';
  if (modifier >= 1) return 'Pozitivno';
  if (modifier === 0) return 'Neutralno';
  if (modifier > -25) return 'Nestabilno';
  if (modifier > -50) return 'Loše';
  return 'Toksično';
}

function renderLoveStatuses(rows) {
  const tbody = document.getElementById('loveStatusesBody');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nema ljubavnih statusa za prikaz.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const modifier = Number(row.modifier || 0);
    const statusClass = modifier > 0 ? 'status-active' : modifier < 0 ? 'status-inactive' : 'status-neutral';
    const displayModifier = modifier >= 0 ? `+${modifier}` : `${modifier}`;

    return `
      <tr>
        <td style="font-weight:600">${escapeHtml(row.user1)}</td>
        <td style="text-align:center;font-size:1.125rem">💞</td>
        <td style="font-weight:600">${escapeHtml(row.user2)}</td>
        <td><span class="status-pill ${statusClass}">${getLoveStatusLabel(modifier)}</span></td>
        <td class="td-num" style="color:${modifier > 0 ? 'var(--kick-green)' : modifier < 0 ? '#FCA5A5' : 'var(--text-muted)'}">${displayModifier}</td>
        <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
      </tr>
    `;
  }).join('');
}

function filterLoveStatuses(q) {
  const query = (q || '').toLowerCase();
  const filtered = allLoveStatuses.filter(r =>
    (r.user1 || '').toLowerCase().includes(query) ||
    (r.user2 || '').toLowerCase().includes(query)
  );
  renderLoveStatuses(filtered);
}

function filterMarriages(q) {
  const filtered = allMarriages.filter(r =>
    (r.user1 || '').toLowerCase().includes(q.toLowerCase()) ||
    (r.user2 || '').toLowerCase().includes(q.toLowerCase())
  );
  renderMarriages(filtered);
}

async function divorceConfirm(id, u1, u2) {
  confirmCallback = async () => {
    const { error } = await sb.from('marriages').delete().eq('id', id);
    if (error) { showToast('error', 'Greška pri brisanju', '❌'); return; }
    showToast('success', `Brak ${u1} & ${u2} je raskinut`, '✂️');
    await loadMarriages();
  };
  document.getElementById('confirmMsg').textContent = `Admin razvod: ${u1} & ${u2}? Ovo se ne može poništiti.`;
  document.getElementById('confirmDeleteBtn').onclick = () => { closeModal('confirmModal'); confirmCallback(); };
  openModal('confirmModal');
}

// ── Bot Config ────────────────────────────────────────────
async function loadBotConfig() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('bot_config')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('channel_id', activeChannel.id)
    .maybeSingle();

  if (error) { console.error('Config:', error); return; }

  if (data) {
    document.getElementById('cfgPrefix').value = data.prefix || '!';
    document.getElementById('cfgLanguage').value = data.language || 'sr';
    document.getElementById('cfgCooldown').value = data.cooldown_ms ?? 3000;
    document.getElementById('cfgLeaderboard').checked = data.feature_leaderboard ?? true;
    document.getElementById('cfgWatchtime').checked = data.feature_watchtime ?? true;
    document.getElementById('cfgGames').checked = data.feature_games ?? true;
    document.getElementById('cfgLove').checked = data.feature_love ?? true;
    document.getElementById('cfgModeration').checked = data.feature_moderation ?? false;
    document.getElementById('cfgAutoresponse').checked = data.feature_autoresponse ?? true;
    document.getElementById('cfgSpamThreshold').value = data.spam_threshold ?? 3;
    document.getElementById('cfgSpamWindow').value = data.spam_window_ms ?? 15000;
    document.getElementById('cfgPinMsg').value = data.stream_pin_msg || '';
    document.getElementById('cfgWelcomeMsg').value = data.welcome_message || '';

    // Load auto announce list
    localAnnounces = Array.isArray(data.auto_announces) ? data.auto_announces : [];
    renderAnnounceList();

    // Update bot status
    updateBotStatusUI(data.bot_active || false);
    document.getElementById('botActiveToggle').checked = data.bot_active || false;
  } else {
    localAnnounces = [];
    renderAnnounceList();
  }
  configLoaded = true;
}

async function saveBotConfig() {
  if (!activeChannel) { showToast('error', 'Nema izabranog kanala', '❌'); return; }

  const config = {
    user_id: currentUser.id,
    channel_id: activeChannel.id,
    channel_name: activeChannel.username,
    prefix: document.getElementById('cfgPrefix').value || '!',
    language: document.getElementById('cfgLanguage').value,
    cooldown_ms: parseInt(document.getElementById('cfgCooldown').value) || 3000,
    feature_leaderboard: document.getElementById('cfgLeaderboard').checked,
    feature_watchtime: document.getElementById('cfgWatchtime').checked,
    feature_games: document.getElementById('cfgGames').checked,
    feature_love: document.getElementById('cfgLove').checked,
    feature_moderation: document.getElementById('cfgModeration').checked,
    feature_autoresponse: document.getElementById('cfgAutoresponse').checked,
    spam_threshold: parseInt(document.getElementById('cfgSpamThreshold').value) || 3,
    spam_window_ms: parseInt(document.getElementById('cfgSpamWindow').value) || 15000,
    stream_pin_msg: document.getElementById('cfgPinMsg').value || null,
    welcome_message: document.getElementById('cfgWelcomeMsg').value || null,
    auto_announces: localAnnounces,
    updated_at: new Date().toISOString(),
  };

  setLoading('saveConfigBtn', true);
  const { error } = await sb.from('bot_config')
    .upsert(config, { onConflict: 'user_id,channel_id' });
  setLoading('saveConfigBtn', false);

  if (error) { showToast('error', 'Greška pri čuvanju config-a', '❌'); console.error(error); return; }
  showToast('success', 'Bot config sačuvan!', '✅');
}

function renderAnnounceList() {
  const el = document.getElementById('announceList');
  if (!el) return;

  if (localAnnounces.length === 0) {
    el.innerHTML = '<div class="mini-empty" style="padding:1rem 0;">Nema automatskih najava. Dodaj prvu ispod.</div>';
    return;
  }

  el.innerHTML = localAnnounces.map((msg, i) => `
    <div class="mini-item" style="border: 1px solid var(--border-subtle); padding: 0.625rem 0.875rem; border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.75rem; background: var(--bg-surface);">
      <span class="mini-username" style="font-size:0.875rem; color: var(--text-secondary); line-height: 1.4;">${escapeHtml(msg)}</span>
      <button type="button" class="action-btn danger" onclick="deleteAnnounceMessage(${i})" style="flex-shrink:0; margin-left:auto;" title="Obriši poruku">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
      </button>
    </div>
  `).join('');
}

function addAnnounceMessage() {
  const input = document.getElementById('newAnnounceInput');
  if (!input) return;
  const msg = input.value.trim();

  if (!msg) {
    showToast('error', 'Poruka ne može biti prazna.', '⚠️');
    return;
  }

  if (localAnnounces.includes(msg)) {
    showToast('error', 'Ova poruka već postoji.', '⚠️');
    return;
  }

  localAnnounces.push(msg);
  input.value = '';
  renderAnnounceList();
  showToast('info', 'Poruka dodata u listu (klikni "Sačuvaj" gore da primeniš izmene)', '📝');
}

function deleteAnnounceMessage(i) {
  localAnnounces.splice(i, 1);
  renderAnnounceList();
  showToast('info', 'Poruka uklonjena (klikni "Sačuvaj" gore da primeniš izmene)', '🗑');
}

async function loadBotStatus() {
  if (!activeChannel) return;
  const { data } = await sb.from('bot_config')
    .select('bot_active')
    .eq('user_id', currentUser.id)
    .eq('channel_id', activeChannel.id)
    .maybeSingle();
  if (data) updateBotStatusUI(data.bot_active || false);
}

function updateBotStatusUI(active) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const label = document.getElementById('botToggleLabel');
  const toggle = document.getElementById('botActiveToggle');

  if (dot) { dot.className = `status-dot ${active ? 'status-on' : 'status-off'}`; }
  if (text) { text.textContent = active ? 'Online' : 'Offline'; }
  if (label) { label.textContent = `Bot: ${active ? 'ON' : 'OFF'}`; label.style.color = active ? 'var(--kick-green)' : 'var(--text-muted)'; }
  if (toggle && toggle.checked !== active) { toggle.checked = active; }
}

async function toggleBotActive() {
  if (!activeChannel) return;
  const active = document.getElementById('botActiveToggle').checked;
  updateBotStatusUI(active);

  const { error } = await sb.from('bot_config')
    .upsert({
      user_id: currentUser.id,
      channel_id: activeChannel.id,
      channel_name: activeChannel.username,
      bot_active: active,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,channel_id' });

  if (error) {
    showToast('error', 'Greška pri promeni statusa', '❌');
    document.getElementById('botActiveToggle').checked = !active;
    updateBotStatusUI(!active);
  } else {
    showToast(active ? 'success' : 'info', `Bot ${active ? 'pokrenut' : 'zaustavljen'}`, active ? '🟢' : '⭕');
  }
}

async function loadChannelLiveStatus() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('channels')
    .select('is_active')
    .eq('id', activeChannel.id)
    .maybeSingle();

  if (error) {
    console.error('Greška pri učitavanju live statusa kanala:', error);
    return;
  }

  const isLive = data ? data.is_active : false;
  updateLiveStatusUI(isLive);
}

function updateLiveStatusUI(isLive) {
  const kickDot = document.querySelector('.kick-dot');
  if (kickDot) {
    if (isLive) {
      kickDot.style.background = '#EF4444'; // Crvena boja za LIVE
      kickDot.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.7)';
      kickDot.style.animation = 'pulse-red 1.5s infinite';
    } else {
      kickDot.style.background = 'var(--text-muted)'; // Siva boja za OFFLINE
      kickDot.style.boxShadow = 'none';
      kickDot.style.animation = 'none';
    }
  }

  const badgeText = document.getElementById('topbarChannel');
  if (badgeText && activeChannel) {
    badgeText.textContent = `@${activeChannel.username}${isLive ? ' (LIVE)' : ''}`;
  }
}

function setupRealtimeChannels() {
  if (realtimeSub) {
    sb.removeChannel(realtimeSub);
  }

  if (!activeChannel) return;

  realtimeSub = sb.channel('public:channels')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'channels',
      filter: `id=eq.${activeChannel.id}`
    }, payload => {
      if (payload.new) {
        updateLiveStatusUI(payload.new.is_active);
      }
    })
    .subscribe();
}

// ═══════════════════════════════════════════════════════════
// COMMANDS CRUD
// ═══════════════════════════════════════════════════════════
function openNewCmdModal() {
  editingCmdId = null;
  document.getElementById('cmdModalTitle').textContent = 'Nova komanda';
  document.getElementById('cmdName').value = '';
  document.getElementById('cmdResponse').value = '';
  document.getElementById('cmdCooldown').value = '5000';
  document.getElementById('cmdEnabled').checked = true;
  document.getElementById('cmdCharCount').textContent = '0';
  document.getElementById('cmdModalError').style.display = 'none';
  document.getElementById('saveCmdBtn').textContent = 'Sačuvaj';
  openModal('cmdModal');
}

function editCommand(id) {
  const cmd = allCommands.find(c => c.id === id);
  if (!cmd) return;

  editingCmdId = id;
  document.getElementById('cmdModalTitle').textContent = 'Izmeni komandu';
  document.getElementById('cmdName').value = cmd.command;
  document.getElementById('cmdResponse').value = cmd.response;
  document.getElementById('cmdCooldown').value = cmd.cooldown_ms;
  document.getElementById('cmdEnabled').checked = cmd.enabled;
  document.getElementById('cmdCharCount').textContent = cmd.response.length;
  document.getElementById('cmdModalError').style.display = 'none';
  document.getElementById('saveCmdBtn').textContent = 'Sačuvaj izmene';
  openModal('cmdModal');
}

async function saveCommand() {
  const rawCommand = document.getElementById('cmdName').value.trim();
  const response = document.getElementById('cmdResponse').value.trim();
  const cooldown = parseInt(document.getElementById('cmdCooldown').value) || 5000;
  const enabled = document.getElementById('cmdEnabled').checked;
  const errEl = document.getElementById('cmdModalError');
  errEl.style.display = 'none';

  if (!rawCommand) { errEl.textContent = 'Unesi naziv komande.'; errEl.style.display = 'block'; return; }
  if (!response) { errEl.textContent = 'Unesi odgovor bota.'; errEl.style.display = 'block'; return; }
  if (response.length > 500) { errEl.textContent = 'Odgovor ne sme biti duži od 500 karaktera.'; errEl.style.display = 'block'; return; }

  // Normalizacija: razbijamo po zarezu, čistimo uzvičnike i space, i spajamo nazad
  const enteredAliases = rawCommand.split(',')
    .map(c => c.trim().replace(/^!/, '').toLowerCase())
    .filter(Boolean);

  if (enteredAliases.length === 0) {
    errEl.textContent = 'Unesi bar jedan validan alias.';
    errEl.style.display = 'block'; return;
  }

  const command = enteredAliases.join(', ');

  // Check builtin conflict za svaki uneti alias
  const builtinNames = BUILTIN_COMMANDS.map(c => c.cmd.slice(1));
  const conflictBuiltin = enteredAliases.find(a => builtinNames.includes(a));
  if (conflictBuiltin) {
    errEl.textContent = `Komanda "!${conflictBuiltin}" je ugrađena i ne može se zameniti.`;
    errEl.style.display = 'block'; return;
  }

  // Check duplicate za svaki uneti alias sa drugim custom komandama
  const otherCmds = allCommands.filter(c => c.id !== editingCmdId);
  let conflictDuplicate = null;
  for (const other of otherCmds) {
    const otherAliases = other.command.split(',').map(c => c.trim().toLowerCase());
    const duplicate = enteredAliases.find(a => otherAliases.includes(a));
    if (duplicate) {
      conflictDuplicate = duplicate;
      break;
    }
  }

  if (conflictDuplicate) {
    errEl.textContent = `Komanda "!${conflictDuplicate}" već postoji u drugoj grupi.`;
    errEl.style.display = 'block'; return;
  }

  if (!activeChannel) { errEl.textContent = 'Nema aktivnog kanala.'; errEl.style.display = 'block'; return; }

  setLoading('saveCmdBtn', true);

  const payload = {
    user_id: currentUser.id,
    channel_id: activeChannel.id,
    command,
    response,
    cooldown_ms: cooldown,
    enabled,
    updated_at: new Date().toISOString(),
  };

  let error;
  if (editingCmdId) {
    ({ error } = await sb.from('custom_commands').update(payload).eq('id', editingCmdId));
  } else {
    // Nova komanda dobija is_default = false
    ({ error } = await sb.from('custom_commands').insert({
      ...payload,
      is_default: false,
      created_at: new Date().toISOString()
    }));
  }

  setLoading('saveCmdBtn', false);

  if (error) {
    errEl.textContent = 'Greška pri čuvanju. Pokušaj ponovo.';
    errEl.style.display = 'block';
    console.error(error); return;
  }

  showToast('success', editingCmdId ? 'Komanda uspešno izmenjena' : 'Komanda uspešno kreirana!', '⚡');
  closeModal('cmdModal');
  await loadCommands();
}

async function toggleCommand(id, currentEnabled) {
  const { error } = await sb.from('custom_commands')
    .update({ enabled: !currentEnabled, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { showToast('error', 'Greška', '❌'); return; }
  showToast('info', !currentEnabled ? 'Komanda uključena' : 'Komanda isključena', !currentEnabled ? '✅' : '⏸');
  await loadCommands();
}

function deleteCommandConfirm(id, cmd) {
  confirmCallback = async () => {
    const { error } = await sb.from('custom_commands').delete().eq('id', id);
    if (error) { showToast('error', 'Greška pri brisanju', '❌'); return; }
    showToast('success', `${cmd} je obrisana`, '🗑');
    await loadCommands();
  };
  document.getElementById('confirmMsg').textContent = `Da li sigurno želiš da obrišeš komandu ${cmd}? Ovo se ne može poništiti.`;
  document.getElementById('confirmDeleteBtn').onclick = () => { closeModal('confirmModal'); confirmCallback(); };
  openModal('confirmModal');
}

// ── Char counter for cmd response ──────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const resp = document.getElementById('cmdResponse');
  if (resp) {
    resp.addEventListener('input', () => {
      document.getElementById('cmdCharCount').textContent = resp.value.length;
    });
  }
});

// ── Built-in commands reference ────────────────────────────
function renderBuiltinCommands() {
  const grid = document.getElementById('builtinGrid');
  if (!grid) return;

  grid.innerHTML = BUILTIN_COMMANDS.map(c => `
    <div class="builtin-card">
      <span class="builtin-cmd">${c.cmd}</span>
      <span class="builtin-desc">${c.desc}</span>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
const PANEL_NAMES = {
  overview: 'Overview',
  commands: 'Komande',
  leaderboard: 'Leaderboard',
  watchtime: 'Watchtime',
  marriages: 'Ljubav i brakovi',
  games: 'Mini igre',
  autoresponse: 'Auto odgovori',
  config: 'Bot Config',
  moderation: 'Moderacija',
};

function switchPanel(panelId) {
  // Sačuvaj aktivni panel u localStorage
  localStorage.setItem('active-dashboard-panel', panelId);

  // Deactivate all
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activate target
  const panel = document.getElementById(`panel-${panelId}`);
  const navItem = document.querySelector(`[data-panel="${panelId}"]`);
  if (panel) panel.classList.add('active');
  if (navItem) navItem.classList.add('active');

  // Breadcrumb
  document.getElementById('breadcrumbPage').textContent = PANEL_NAMES[panelId] || panelId;

  // Lazy load panel data
  if (panelId === 'leaderboard') {
    loadLeaderboard();
    loadWatchtime();
  }
  if (panelId === 'marriages') {
    loadMarriages();
    loadLoveStatuses();
  }
  if (panelId === 'autoresponse' && !configLoaded) loadBotConfig();
  if (panelId === 'config' && !configLoaded) loadBotConfig();

  // Close mobile sidebar
  if (window.innerWidth < 768) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
}

// ── Sidebar Toggle ─────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth < 768) {
    sidebar.classList.toggle('mobile-open');
  }
}

// ── Channel Menu ───────────────────────────────────────────
function toggleChannelMenu() {
  const menu = document.getElementById('channelMenu');
  menu.classList.toggle('open');
}

document.addEventListener('click', e => {
  const sw = document.getElementById('channelSwitcher');
  if (sw && !sw.contains(e.target)) {
    document.getElementById('channelMenu')?.classList.remove('open');
  }
  const pill = document.getElementById('userPill');
  if (pill && !pill.contains(e.target)) {
    document.getElementById('userMenuSm')?.classList.remove('open');
  }
});

// ── User Menu ──────────────────────────────────────────────
function toggleUserMenu() {
  document.getElementById('userMenuSm').classList.toggle('open');
}
async function handleSignOut() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}
function goToSettings() { showToast('info', 'Podešavanja dolaze uskoro', 'ℹ️'); }

// ═══════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}
function handleModalBg(e, id) {
  if (e.target.id === id) closeModal(id);
}
function showAddChannelModal() {
  document.getElementById('addChannelError').style.display = 'none';
  const inp = document.getElementById('newChannelInput');
  if (inp) inp.value = '';
  openModal('addChannelModal');
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['cmdModal', 'addChannelModal', 'confirmModal'].forEach(id => {
      document.getElementById(id)?.classList.remove('open');
    });
    document.body.style.overflow = '';
  }
});

// ═══════════════════════════════════════════════════════════
// TOASTS
// ═══════════════════════════════════════════════════════════
let toastId = 0;
function showToast(type, msg, icon = '💬', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const id = ++toastId;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.id = `toast-${id}`;
  el.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-msg">${msg}</div>
    <button class="toast-close" onclick="removeToast(${id})">✕</button>
  `;
  container.appendChild(el);
  setTimeout(() => removeToast(id), duration);
}
function removeToast(id) {
  const el = document.getElementById(`toast-${id}`);
  if (el) { el.style.opacity = '0'; el.style.transform = 'translateX(16px)'; setTimeout(() => el.remove(), 250); }
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn._originalText = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;animation:spin 0.65s linear infinite"></span>';
  } else {
    if (btn._originalText) btn.innerHTML = btn._originalText;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
}

function getCurrentMonth() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
}

function rankColor(i) {
  if (i === 0) return '#FBBF24';
  if (i === 1) return '#94A3B8';
  if (i === 2) return '#92400E';
  return 'var(--text-primary)';
}

function downloadCsv(content, filename) {
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

// ── Add spinner keyframe to document ──────────────────────
const style = document.createElement('style');
style.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
document.head.appendChild(style);

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
initAuth();
