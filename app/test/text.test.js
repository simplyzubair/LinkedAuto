import { test } from 'node:test';
import assert from 'node:assert/strict';
import { variants, pickVariant, render, clip, normalizeProfileUrl, firstNameOf, companyFromHeadline, parseCsv, toCsv, leadsFromCsv, isLinkedInSearchUrl } from '../src/text.js';

test('variants and picking', () => {
  assert.deepEqual(variants('Hi A\n---\nHi B\n'), ['Hi A', 'Hi B']);
  assert.equal(pickVariant('Hi A\n---\nHi B', () => 0.9).index, 1);
  assert.equal(pickVariant('', () => 0).text, '');
});

test('render fills fields and fallbacks', () => {
  const lead = { first_name: 'Sara', company: '' };
  assert.equal(render('Hi {{firstName}}, love what {{company|your team}} does.', lead), 'Hi Sara, love what your team does.');
  assert.equal(render('Hi {{ firstName }} {{lastName}}!', lead), 'Hi Sara!');
});

test('clip at word boundary', () => {
  assert.equal(clip('one two three four', 12), 'one two');
  assert.equal(clip('short', 200), 'short');
});

test('profile URLs normalize', () => {
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/in/Jane-Doe-123/?miniProfileUrn=x'), 'https://www.linkedin.com/in/jane-doe-123/');
  assert.equal(normalizeProfileUrl('linkedin.com/in/jane'), null);
  assert.equal(normalizeProfileUrl('/in/jane'), 'https://www.linkedin.com/in/jane/');
  assert.equal(normalizeProfileUrl('https://www.linkedin.com/company/x/'), null);
  assert.equal(isLinkedInSearchUrl('https://www.linkedin.com/search/results/people/?keywords=ceo'), true);
  assert.equal(isLinkedInSearchUrl('https://example.com/search/results/people/'), false);
});

test('names and companies', () => {
  assert.equal(firstNameOf('Dr. Ahmed Khan, PhD'), 'Ahmed');
  assert.equal(firstNameOf('Jane Doe 🚀 (She/Her)'), 'Jane');
  assert.equal(companyFromHeadline('CEO at Acme Realty | Investor'), 'Acme Realty');
  assert.equal(companyFromHeadline('Founder'), null);
});

test('csv round trip and lead mapping', () => {
  const csv = toCsv([['profile_url', 'Full Name', 'Title'], ['https://www.linkedin.com/in/a/', 'Ann "A" Lee', 'CTO at X, Inc'], ['bad', 'B', '']]);
  assert.deepEqual(parseCsv(csv)[1], ['https://www.linkedin.com/in/a/', 'Ann "A" Lee', 'CTO at X, Inc']);
  const leads = leadsFromCsv(csv);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].first_name, 'Ann');
  assert.equal(leads[0].company, 'X');
  assert.throws(() => leadsFromCsv('name\nx'));
});
