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
