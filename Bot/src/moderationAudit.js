// Audit log automatske moderacije (ring buffer po kanalu) i dry-run podrška.
// Svaka automatska akcija (ban, timeout, brisanje, opomena) se beleži sa razlogom,
// tako da strimer može da proveri i ispravi eventualni pogrešan ban.

const MAX_ENTRIES_PER_CHANNEL = 200;
const logs = new Map();

function zabelezi(chatroomId, entry) {
    if (!chatroomId || !entry) return null;
    const key = String(chatroomId);
    if (!logs.has(key)) logs.set(key, []);
    const list = logs.get(key);

    const record = {
        ts: new Date().toISOString(),
        action: String(entry.action || 'unknown'),
        username: String(entry.username || ''),
        reason: String(entry.reason || ''),
        message: entry.message ? String(entry.message).slice(0, 300) : '',
        dryRun: !!entry.dryRun,
        source: String(entry.source || 'moderation')
    };

    list.push(record);
    if (!record.dryRun) {
        require('./metrics').inc(`moderation_${record.action.toLowerCase()}`);
    }
    if (list.length > MAX_ENTRIES_PER_CHANNEL) {
        list.splice(0, list.length - MAX_ENTRIES_PER_CHANNEL);
    }
    return record;
}

function dohvati(chatroomId, limit = 50) {
    const list = logs.get(String(chatroomId)) || [];
    const n = Math.max(1, Math.min(MAX_ENTRIES_PER_CHANNEL, Number(limit) || 50));
    return list.slice(-n).reverse();
}

function obrisi(chatroomId) {
    logs.delete(String(chatroomId));
}

/**
 * Dry-run režim: kada je uključen u moderation_settings (dry_run: true),
 * bot samo beleži šta bi uradio, bez ikakve stvarne kazne.
 */
function jeDryRun(channelState) {
    return !!(channelState && channelState.moderationSettings && channelState.moderationSettings.dry_run === true);
}

module.exports = { zabelezi, dohvati, obrisi, jeDryRun, MAX_ENTRIES_PER_CHANNEL };
