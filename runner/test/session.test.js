import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, classifyText } from '../src/session.js';

test('logged-in pages', () => {
  for (const u of ['https://www.linkedin.com/feed/', 'https://www.linkedin.com/in/someone/', 'https://www.linkedin.com/mynetwork/invitation-manager/sent/']) {
    assert.equal(classifyUrl(u), 'ok', u);
  }
});

test('logged-out pages', () => {
  for (const u of ['https://www.linkedin.com/login', 'https://www.linkedin.com/checkpoint/lg/login-submit', 'https://www.linkedin.com/authwall?trk=x', 'https://www.linkedin.com/']) {
    assert.equal(classifyUrl(u), 'logged_out', u);
  }
});

test('security checkpoints', () => {
  assert.equal(classifyUrl('https://www.linkedin.com/checkpoint/challenge/AgF123'), 'checkpoint');
});

test('other sites and junk', () => {
  assert.equal(classifyUrl('https://evil-linkedin.com/feed/'), 'unknown');
  assert.equal(classifyUrl('about:blank'), 'unknown');
  assert.equal(classifyUrl('not a url'), 'unknown');
});

test('warning text', () => {
  assert.equal(classifyText('Your account has been temporarily restricted').state, 'restricted');
  assert.equal(classifyText('Let’s do a quick security check').state, 'checkpoint');
  assert.equal(classifyText('We noticed some unusual activity on your account').state, 'checkpoint');
  assert.equal(classifyText('Welcome to your feed'), null);
});
