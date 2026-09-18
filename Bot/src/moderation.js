const { posaljiPoruku, obrisiPoruku, banujKorisnika, timeoutKorisnika } = require('./messenger');
const { log } = require('./utils');
const state = require('./state');
const { normalizujZaPoredjenje, despaceText } = require('./spam');

const VIEW_BOT_SPAM_REGEX = /\b(viewbot|view-bot|viewer\s*bot|follower\s*bot|chat\s*bot|typical\s*panels|save\s*99%|buy\s*followers|kickbotting|ownkick|kickview|cheap\s*viewers|cheap\s*chatters|chatters\s*with\s*custom|pay\s*only\s*for\s*what\s*you\s*use|free\s*trial\s*available)\b/i;
const DOMAIN_URL_REGEX = /(https?:\/\/[^\s]+|([a-zA-Z0-9-]{2,}\.)+(com|net|org|io|gg|xyz|site|ru|tv|me|info|biz|live|top|online|store|club|app|dev)\b[^\s]*)/gi;

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
    
    // ── 2. LINK & VIEWBOT PROTECTION ───────────────────────────────────────
    const despaced = despaceText(content);
    if (!triggerReason && (VIEW_BOT_SPAM_REGEX.test(content) || VIEW_BOT_SPAM_REGEX.test(despaced))) {
        triggerReason = 'Viewbot / nedozvoljena reklama';
        filterAction = 'ban';
        filterTimeout = null;
    }

    if (!triggerReason && settings.links_enabled) {
        const matchesOriginal = content.match(DOMAIN_URL_REGEX) || [];
        const matchesDespaced = despaced.match(DOMAIN_URL_REGEX) || [];
        const allUrls = Array.from(new Set([...matchesOriginal, ...matchesDespaced]));

        if (allUrls.length > 0) {
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
                    
                let allowedAll = true;
                
                for (const urlStr of allUrls) {
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
            const normalizedContent = normalizujZaPoredjenje(content);
            const cleanContentLC = contentLC
                .replace(/š/g, 's').replace(/đ/g, 'd').replace(/č/g, 'c').replace(/ć/g, 'c').replace(/ž/g, 'z');
            const cleanNormalized = normalizedContent
                .replace(/š/g, 's').replace(/đ/g, 'd').replace(/č/g, 'c').replace(/ć/g, 'c').replace(/ž/g, 'z');
                
            const hasBadWord = badWords.some(word => {
                const wordLC = word.toLowerCase();
                const wordLCAlt = wordLC
                    .replace(/š/g, 's').replace(/đ/g, 'd').replace(/č/g, 'c').replace(/ć/g, 'c').replace(/ž/g, 'z');
                return contentLC.includes(wordLC) || cleanContentLC.includes(wordLCAlt) ||
                       normalizedContent.includes(wordLC) || cleanNormalized.includes(wordLCAlt);
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
        kazniKorisnika(chatroomId, username, messageId, triggerReason, finalAction, finalTimeout, senderObj);
        return true;
    }
    
    return false;
}

function kazniKorisnika(chatroomId, username, messageId, reason, actionType, timeoutDuration, senderObj = null) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const act = actionType || 'delete';
    const duration = timeoutDuration !== undefined ? timeoutDuration : 600;
    const userKey = username.toLowerCase();
    const userId = senderObj?.id || senderObj?.user_id || null;

    // Beleži u streamAnalytics za Kickan
    try {
        const streamAnalytics = require('./streamAnalytics');
        streamAnalytics.recordModerationAction(chatroomId, act.toUpperCase(), username, 'Kickot Bot', reason);
    } catch (_) {}

    if (act === 'ban') {
        if (!channelState.bannedUsers) {
            channelState.bannedUsers = new Set();
        }
        channelState.bannedUsers.add(userKey);

        if (messageId) obrisiPoruku(chatroomId, messageId);
        banujKorisnika(chatroomId, username, reason, userId);
        posaljiPoruku(chatroomId, `[MOD] @${username} je trajno banovan.`);
        log('MOD', `[${channelState.channelUsername || chatroomId}] Ban ${username}. Reason: ${reason}`);
    } else if (act === 'timeout') {
        if (messageId) obrisiPoruku(chatroomId, messageId);
        const minuti = Math.max(1, Math.round(duration / 60));
        timeoutKorisnika(chatroomId, username, duration, reason, userId);
        posaljiPoruku(chatroomId, `[MOD] @${username} je utišan na ${minuti} min.`);
        log('MOD', `[${channelState.channelUsername || chatroomId}] Timeout ${username} for ${duration}s (${minuti}m). Reason: ${reason}`);
    } else if (act === 'warn') {
        if (!channelState.warningsCount) {
            channelState.warningsCount = new Map();
        }
        const warnCount = (channelState.warningsCount.get(userKey) || 0) + 1;
        channelState.warningsCount.set(userKey, warnCount);
        
        if (warnCount >= 3) {
            timeoutKorisnika(chatroomId, username, duration, 'Prekoracen broj opomena (3/3)', userId).then((ok) => {
                if (ok) {
                    posaljiPoruku(chatroomId, `[MOD] @${username} je privremeno utisan zbog 3 opomene.`);
                } else {
                    log('WARN', `[${channelState.channelUsername || chatroomId}] Timeout (warn 3/3) ${username} nije uspeo na Kick API-ju.`);
                }
            }).catch(() => {});
            channelState.warningsCount.set(userKey, 0); // reset
            log('MOD', `[${channelState.channelUsername || chatroomId}] Timeout ${username} due to 3 warnings.`);
        } else {
            posaljiPoruku(chatroomId, `[MOD] @${username}, opomena (${warnCount}/3).`);
            log('MOD', `[${channelState.channelUsername || chatroomId}] Warned ${username} (${warnCount}/3). Reason: ${reason}`);
        }
    } else {
        // Samo upozorenje u chatu, bez brisanja poruke
        posaljiPoruku(chatroomId, `[MOD] @${username}, molim te postuj pravila chata.`);
        log('MOD', `[${channelState.channelUsername || chatroomId}] Upozoren ${username}. Reason: ${reason}`);
    }
}

module.exports = {
    proveriModeraciju
};
