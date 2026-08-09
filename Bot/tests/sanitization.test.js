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
