const test = require('node:test');
const assert = require('node:assert/strict');
const {
    sanitizeInput,
    isValidUsername,
    dobijTrenutniMesec,
    proveraKulauna
} = require('../src/utils');

test('Sanitization & Utils - sanitizeInput uklanja HTML i nevidljive karaktere', () => {
    assert.equal(sanitizeInput('<b>Hello</b>'), 'Hello');
    assert.equal(sanitizeInput('<script>alert("xss")</script>'), 'alert("xss")');
    assert.equal(sanitizeInput('   <b>Bold</b>  '), 'Bold');
    assert.equal(sanitizeInput('Text\u200BWithZeroWidth'), 'TextWithZeroWidth');
    assert.equal(sanitizeInput(123), '');
});

test('Sanitization & Utils - isValidUsername proverava format korisničkog imena', () => {
    assert.equal(isValidUsername('Milan_567'), true);
    assert.equal(isValidUsername('KickALL-Bot'), true);
    assert.equal(isValidUsername('User@123!'), true);
    assert.equal(isValidUsername('Illegal Username With Spaces'), false);
    assert.equal(isValidUsername('<script>'), false);
    assert.equal(isValidUsername(null), false);
});

test('Sanitization & Utils - dobijTrenutniMesec formatira mesec i godinu', () => {
    const mesec = dobijTrenutniMesec();
    assert.match(mesec, /^\d{2}-\d{4}$/);
});

test('Sanitization & Utils - proveraKulauna sprečava brzinske komande', () => {
    const chatroomId = 'test_room_cooldown_1';
    const key = '!roll_testuser';

    // Prvi poziv ne treba da bude u cooldownu
    const res1 = proveraKulauna(chatroomId, key, 'TestUser', 5000);
    assert.equal(res1, false);

    // Drugi poziv odmah nakon toga MORA biti u cooldownu
    const res2 = proveraKulauna(chatroomId, key, 'TestUser', 5000);
    assert.equal(res2, true);
});

test('Sanitization & Utils - proveraKulauna razdvaja cooldown po korisnicima za igre', () => {
    const chatroomId = 'test_room_cooldown_multiuser';
    
    // Korisnik 1 (Anastasija) pokreće točak
    const res1 = proveraKulauna(chatroomId, '!wheel', 'anastasijauser055', 3000);
    assert.equal(res1, false); // Nije u cooldownu

    // Korisnik 2 (Milan) pokreće točak u istoj sekundi
    const res2 = proveraKulauna(chatroomId, '!wheel', 'Milan_567', 3000);
    assert.equal(res2, false); // Nije u cooldownu jer ima sopstveni cooldown!

    // Korisnik 1 odmah ponovo pokušava
    const res3 = proveraKulauna(chatroomId, '!wheel', 'anastasijauser055', 3000);
    assert.equal(res3, true); // Korisnik 1 jeste u cooldownu
});

test('Sanitization & Utils - proveraKulauna stavlja komandu u red čekanja i izvršava je nakon cooldown-a', async () => {
    const chatroomId = 'test_room_cooldown_queue';
    const username = 'QueuePlayer';
    let executed = false;

    // 1. Prvi poziv prolazi odmah (cooldown 100ms radi brzog testa)
    const res1 = proveraKulauna(chatroomId, '!slots', username, 100);
    assert.equal(res1, false);

    // 2. Drugi poziv je u cooldown-u, prosleđujemo callback
    const res2 = proveraKulauna(chatroomId, '!slots', username, 100, () => {
        executed = true;
    });
    assert.equal(res2, true);
    assert.equal(executed, false);

    // 3. Čekamo 120ms da tajmer u redu čekanja okine
    await new Promise(r => setTimeout(r, 120));
    assert.equal(executed, true);
});

test('Sanitization & Utils - formatTemplateMessage zamenjuje sve varijante template varijabli', () => {
    const { formatTemplateMessage } = require('../src/utils');

    assert.equal(
        formatTemplateMessage('Dobrodošao/la @$(name)! u strim', 'Karliicaa'),
        'Dobrodošao/la @Karliicaa! u strim'
    );
    assert.equal(
        formatTemplateMessage('Pozdrav $(user) na kanalu', 'Karliicaa'),
        'Pozdrav Karliicaa na kanalu'
    );
    assert.equal(
        formatTemplateMessage('Dobrodošao {name}!', 'Karliicaa'),
        'Dobrodošao Karliicaa!'
    );
    assert.equal(
        formatTemplateMessage('Dobrodošao {username}!', 'Karliicaa'),
        'Dobrodošao Karliicaa!'
    );
    assert.equal(
        formatTemplateMessage('Welcome @%user% to stream', 'Karliicaa'),
        'Welcome @Karliicaa to stream'
    );
    assert.equal(
        formatTemplateMessage('Dobrodošao u strim', 'Karliicaa'),
        '@Karliicaa, Dobrodošao u strim'
    );
});
