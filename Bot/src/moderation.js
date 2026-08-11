const { posaljiPoruku, obrisiPoruku } = require('./messenger');
const { log } = require('./utils');
const state = require('./state');
const { normalizujZaPoredjenje } = require('./spam');

/**
 * Checks a chat message against active moderation filters.
 * Returns true if moderation was triggered (and action taken), false otherwise.
 */
function proveriModeraciju(chatroomId, username, content, messageId, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.botActive) return false;
    
    // Ignore streamer
    const userKey = username.toLowerCase();
    if (userKey === channelState.channelUsername.toLowerCase()) {
        return false;
    }
    
    // Check if moderation feature is globally enabled for this channel
    if (!channelState.feature_moderation) return false;
    
    const settings = channelState.moderationSettings || {};
    
    // Check sender role and exemptions
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || [];
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster');
    const isVip = badges.some(b => b.type === 'vip');
    const isSub = badges.some(b => b.type === 'subscriber' || b.type === 'sub');
    
    const exemptRoles = settings.exempt_roles || ['moderator'];
    
    if (isMod) return false; // Moderators/streamer are always exempt
    if (isVip && exemptRoles.includes('vip')) return false;
    if (isSub && exemptRoles.includes('subscriber')) return false;
    
    let triggerReason = null;
    let filterAction = null;
    let filterTimeout = null;
    
    // ── 1. CAPS PROTECTION ──────────────────────────────────────────────────
    if (settings.caps_enabled) {
        const minLen = settings.caps_min_len || 5;
        const pct = settings.caps_pct || 70;
        
        const alphaChars = content.replace(/[^a-zA-Z]/g, '');
        if (alphaChars.length >= minLen) {
            const capsChars = alphaChars.replace(/[^A-Z]/g, '');
            const capsPct = (capsChars.length / alphaChars.length) * 100;
            if (capsPct >= pct) {
                triggerReason = 'Previše velikih slova (Caps)';
                filterAction = settings.caps_action_type;
                filterTimeout = settings.caps_timeout_duration_secs;
            }
        }
    }
    
    // ── 2. LINK PROTECTION ──────────────────────────────────────────────────
    if (!triggerReason && settings.links_enabled) {
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        if (urlRegex.test(content)) {
            // Check permits map
            const permitTime = channelState.permits ? channelState.permits.get(userKey) : null;
            const hasPermit = permitTime && (Date.now() - permitTime < 60000);
            
            if (hasPermit) {
                if (channelState.permits) channelState.permits.delete(userKey); // Consume permit
            } else {
                // Check domains whitelist
                const whitelist = (settings.links_whitelist || '')
                    .split(',')
                    .map(d => d.trim().toLowerCase())
                    .filter(Boolean);
                    
                const urls = content.match(urlRegex) || [];
                let allowedAll = true;
                
                for (const urlStr of urls) {
                    try {
                        let host = urlStr.toLowerCase();
                        if (!host.startsWith('http://') && !host.startsWith('https://')) {
                            host = 'http://' + host;
                        }
                        const parsedUrl = new URL(host);
                        const hostname = parsedUrl.hostname.replace(/^www\./, '');
                        
                        const isWhitelisted = whitelist.some(w => hostname === w || hostname.endsWith('.' + w));
                        if (!isWhitelisted) {
                            allowedAll = false;
                            break;
                        }
                    } catch {
                        allowedAll = false;
                        break;
                    }
                }
                
                if (!allowedAll) {
                    triggerReason = 'Linkovi nisu dozvoljeni';
                    filterAction = settings.links_action_type;
                    filterTimeout = settings.links_timeout_duration_secs;
                }
            }
        }
    }
    
    // ── 3. EMOTE PROTECTION ──────────────────────────────────────────────────
    if (!triggerReason && settings.emotes_enabled) {
        const maxEmotes = settings.emotes_max || 5;
        const emoteMatches = content.match(/\[emote:\d+:[^\]]+\]/g);
        const emoteCount = emoteMatches ? emoteMatches.length : 0;
        if (emoteCount > maxEmotes) {
            triggerReason = 'Previše emotikona';
            filterAction = settings.emotes_action_type;
            filterTimeout = settings.emotes_timeout_duration_secs;
        }
    }
    
    // ── 4. SYMBOL PROTECTION ─────────────────────────────────────────────────
    if (!triggerReason && settings.symbols_enabled) {
        const minLen = settings.symbols_min_len || 5;
        const pct = settings.symbols_pct || 60;
        
        const totalChars = content.length;
        if (totalChars >= minLen) {
            // Symbols are anything that is not alphanumeric, a space, or a cyrillic character
            const symbolsChars = content.replace(/[a-zA-Z0-9\sа-яА-ЯёЁđđžžććččššĐĐŽŽĆĆČČŠŠ]/g, '');
            const symbolsPct = (symbolsChars.length / totalChars) * 100;
            if (symbolsPct >= pct) {
                triggerReason = 'Previše simbola';
                filterAction = settings.symbols_action_type;
                filterTimeout = settings.symbols_timeout_duration_secs;
            }
        }
    }
    
    // ── 5. BAD WORDS PROTECTION ──────────────────────────────────────────────
    if (!triggerReason && settings.words_enabled) {
        const badWords = (settings.words_list || '')
            .split(',')
            .map(w => w.trim().toLowerCase())
            .filter(Boolean);
            
        if (badWords.length > 0) {
            const contentLC = content.toLowerCase();
            const cleanContentLC = contentLC
                .replace(/š/g, 's').replace(/đ/g, 'd').replace(/č/g, 'c').replace(/ć/g, 'c').replace(/ž/g, 'z');
                
            const hasBadWord = badWords.some(word => {
                const wordLC = word.toLowerCase();
                const wordLCAlt = wordLC
                    .replace(/š/g, 's').replace(/đ/g, 'd').replace(/č/g, 'c').replace(/ć/g, 'c').replace(/ž/g, 'z');
                return contentLC.includes(wordLC) || cleanContentLC.includes(wordLCAlt);
            });
            
            if (hasBadWord) {
                triggerReason = 'Zabranjene reči';
                filterAction = settings.words_action_type;
                filterTimeout = settings.words_timeout_duration_secs;
            }
        }
    }
    
    // ── 6. SPAM / DUPLICATE PROTECTION ───────────────────────────────────────
    if (!triggerReason && settings.spam_enabled) {
        const maxDuplicates = settings.spam_max_duplicates || 2;
        // Normalizujemo (skidamo zero-width/nevidljive karaktere) da raid nalozi
        // ne bi zaobišli detekciju duplikata dodavanjem nevidljivog znaka na kraj poruke.
        const key = `${userKey}::${normalizujZaPoredjenje(content)}`;
        
        if (!channelState.duplicateTracker) {
            channelState.duplicateTracker = new Map();
        }
        
        const now = Date.now();
        let tracker = channelState.duplicateTracker.get(key) || [];
        tracker = tracker.filter(t => now - t < 30000);
        tracker.push(now);
        channelState.duplicateTracker.set(key, tracker);
        
        if (tracker.length > maxDuplicates) {
            triggerReason = 'Ponavljanje iste poruke (Spam)';
            filterAction = settings.spam_action_type;
            filterTimeout = settings.spam_timeout_duration_secs;
        }
    }
    
    // ── 7. MAX LENGTH PROTECTION ─────────────────────────────────────────────
    if (!triggerReason && settings.max_len_enabled) {
        const maxLength = settings.max_len_limit || 300;
        if (content.length > maxLength) {
            triggerReason = 'Predugačka poruka';
            filterAction = settings.max_len_action_type;
            filterTimeout = settings.max_len_timeout_duration_secs;
        }
    }
    
    // ── 8. MASS MENTIONS PROTECTION ──────────────────────────────────────────
    if (!triggerReason && settings.mentions_enabled) {
        const maxMentions = settings.mentions_limit || 3;
        const mentionMatches = content.match(/@\w+/g);
        const mentionCount = mentionMatches ? mentionMatches.length : 0;
        if (mentionCount > maxMentions) {
            triggerReason = 'Previše tagovanja';
            filterAction = settings.mentions_action_type;
            filterTimeout = settings.mentions_timeout_duration_secs;
        }
    }

    if (triggerReason) {
        const finalAction = filterAction || settings.action_type || 'delete';
        const finalTimeout = (filterTimeout !== null && filterTimeout !== undefined && filterTimeout !== '') ? parseInt(filterTimeout) : (settings.timeout_duration_secs || 600);
        kazniKorisnika(chatroomId, username, messageId, triggerReason, finalAction, finalTimeout);
        return true;
    }
    
    return false;
}

function kazniKorisnika(chatroomId, username, messageId, reason, actionType, timeoutDuration) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const act = actionType || 'delete';
    const duration = timeoutDuration !== undefined ? timeoutDuration : 600;
    const userKey = username.toLowerCase();

    if (act === 'timeout') {
        if (messageId) obrisiPoruku(chatroomId, messageId);
        posaljiPoruku(chatroomId, `/timeout ${username} ${duration} Automatska moderacija: ${reason}`);
        posaljiPoruku(chatroomId, `@${username} je privremeno udaljen iz čata (Kazna: ${reason}).`);
        log('MOD', `[${channelState.channelUsername || chatroomId}] Timeout ${username} for ${duration}s. Reason: ${reason}`);
    } else if (act === 'warn') {
        if (messageId) obrisiPoruku(chatroomId, messageId);
        if (!channelState.warningsCount) {
            channelState.warningsCount = new Map();
        }
        const warnCount = (channelState.warningsCount.get(userKey) || 0) + 1;
        channelState.warningsCount.set(userKey, warnCount);
        
        if (warnCount >= 3) {
            posaljiPoruku(chatroomId, `/timeout ${username} ${duration} Previše upozorenja`);
            posaljiPoruku(chatroomId, `@${username} je privremeno udaljen zbog uzastopnih prekršaja pravila čata.`);
            channelState.warningsCount.set(userKey, 0); // reset
            log('MOD', `[${channelState.channelUsername || chatroomId}] Timeout ${username} due to 3 warnings.`);
        } else {
            posaljiPoruku(chatroomId, `@${username} upozorenje (${warnCount}/3): Nemojte kršiti pravila čata! (${reason})`);
            log('MOD', `[${channelState.channelUsername || chatroomId}] Warned ${username} (${warnCount}/3). Reason: ${reason}`);
        }
    } else {
        // Just delete: obrisiPoruku vrati true samo ako je poruka stvarno obrisana na Kick-u
        if (messageId) {
            obrisiPoruku(chatroomId, messageId).then((isDeleted) => {
                if (isDeleted) {
                    posaljiPoruku(chatroomId, `@${username} tvoja poruka je obrisana (Razlog: ${reason}).`);
                    log('MOD', `[${channelState.channelUsername || chatroomId}] Deleted message from ${username}. Reason: ${reason}`);
                } else {
                    log('WARN', `[${channelState.channelUsername || chatroomId}] Brisanje poruke korisnika ${username} nije uspelo na Kick-u (Security policy ili API greška). Poruka o brisanju nije poslata.`);
                }
            }).catch((err) => {
                log('ERR', `[${channelState.channelUsername || chatroomId}] Neočekivana greška pri brisanju: ${err.message}`);
            });
        } else {
            posaljiPoruku(chatroomId, `@${username} tvoja poruka je obrisana (Razlog: ${reason}).`);
            log('MOD', `[${channelState.channelUsername || chatroomId}] Deleted message from ${username}. Reason: ${reason}`);
        }
    }
}

module.exports = {
    proveriModeraciju
};
