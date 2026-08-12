/**
 * Jednokratna skripta: uloguj BOT nalog na Kick i dobij access_token + refresh_token.
 *
 * Pokretanje:
 *   1. Uloguj se u browseru na kick.com KAO BOT nalog (ne kao tvoj glavni nalog).
 *   2. node scripts/kick-login.js
 *   3. Otvori link koji skripta ispiše, odobri pristup dok si ulogovan kao bot.
 *   4. Kick će te vratiti na localhost:8890, skripta čuva tokene u Supabase.
 */

require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const CLIENT_ID = process.env.KICK_CLIENT_ID;
const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const REDIRECT_URI = 'http://localhost:8890/callback';
const SCOPES = 'chat:write moderation:chat_message:manage moderation:ban channel:read';

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Nedostaje KICK_CLIENT_ID ili KICK_CLIENT_SECRET u .env fajlu.');
    process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Nedostaje SUPABASE_URL ili SUPABASE_KEY u .env fajlu. Tokeni se čuvaju isključivo u Supabase.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function base64url(buffer) {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const codeVerifier = base64url(crypto.randomBytes(32));
const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
const state = base64url(crypto.randomBytes(16));

const authUrl = `https://id.kick.com/oauth/authorize?` + new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
}).toString();

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, REDIRECT_URI);
    if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
    }

    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');

    if (!code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Greška: nedostaje kod ili se state ne poklapa.');
        return;
    }

    try {
        const tokenRes = await fetch('https://id.kick.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                code_verifier: codeVerifier,
                code
            }).toString()
        });

        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Greška pri razmeni koda: ' + errText);
            console.error('Token exchange error:', errText);
            server.close();
            return;
        }

        const data = await tokenRes.json();
        const tokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + ((data.expires_in || 3600) * 1000)
        };

        const { error } = await supabase
            .from('bot_kick_tokens')
            .upsert({
                id: 1,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: new Date(tokens.expires_at).toISOString(),
                updated_at: new Date().toISOString()
            });

        if (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Greška pri upisivanju u Supabase: ' + error.message);
            console.error('Supabase upsert greška:', error.message);
            server.close();
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Uspešno! Tokeni su sačuvani u Supabase. Možeš zatvoriti ovaj tab.');

        console.log('\nUSPEŠNO! Tokeni upisani u Supabase (tabela bot_kick_tokens).');
        console.log('Bot na Renderu će automatski koristiti nove tokene bez ponovnog deploya.\n');
        server.close();
        process.exit(0);
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Interna greška: ' + err.message);
        console.error(err);
        server.close();
        process.exit(1);
    }
});

server.listen(8890, () => {
    console.log('\n1. Uveri se da si u browseru ulogovan na kick.com KAO BOT NALOG (ne tvoj glavni nalog).');
    console.log('2. Otvori sledeći link i odobri pristup:\n');
    console.log(authUrl);
    console.log('\nČekam callback na http://localhost:8890/callback ...\n');
});
