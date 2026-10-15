// Templates, LinkedIn profile URLs and CSV, all pure helpers.

export const INVITE_NOTE_MAX = 200;

// A template can hold several variants separated by a line containing only ---.
export function variants(template) {
  return String(template || '')
    .split(/^\s*---\s*$/m)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function pickVariant(template, rand = Math.random) {
  const list = variants(template);
  if (!list.length) return { index: null, text: '' };
  const index = Math.floor(rand() * list.length);
  return { index, text: list[index] };
}

// {{firstName}}, {{company|your team}} and so on. Unknown fields render empty.
export function render(text, lead) {
  const fields = {
    firstName: lead.first_name,
    fullName: lead.full_name,
    company: lead.company,
    headline: lead.headline,
    location: lead.location,
  };
  return text
    .replace(/\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g, (_, key, fallback) => {
      const v = fields[key];
      return v && String(v).trim() ? String(v).trim() : (fallback ?? '').trim();
    })
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Cut to the limit at a word boundary.
export function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space >= max * 0.5 ? cut.slice(0, space) : cut).trim();
}

// Canonical form: https://www.linkedin.com/in/<slug>/
export function normalizeProfileUrl(raw) {
  try {
    const u = new URL(String(raw).trim(), 'https://www.linkedin.com');
    const m = u.pathname.match(/^\/in\/([^/?#]+)/);
    if (!m) return null;
    const slug = decodeURIComponent(m[1]).toLowerCase();
    return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
  } catch {
    return null;
  }
}

export function isLinkedInSearchUrl(raw) {
  try {
    const u = new URL(raw);
    // Sales Navigator lists use /sales/lead/ links, not profiles; export those to CSV instead.
    return /(^|\.)linkedin\.com$/.test(u.hostname) && u.pathname.startsWith('/search/results/people');
  } catch {
    return false;
  }
}

const CREDENTIALS = /,?\s*\b(MBA|PhD|CPA|PMP|CFA|MD|Jr\.?|Sr\.?|II|III)\b\.?/g;

export function firstNameOf(fullName) {
  const clean = String(fullName || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\(.*?\)/g, '')
    .replace(CREDENTIALS, '')
    .trim();
  const first = clean.split(/\s+/)[0] || '';
  if (/^(dr|mr|mrs|ms|eng|engr)\.?$/i.test(first)) return clean.split(/\s+/)[1] || '';
  return first;
}

export function companyFromHeadline(headline) {
  const m = String(headline || '').match(/\s(?:at|@)\s+([^|•·,]+)/i);
  return m ? m[1].trim() : null;
}

// Minimal RFC 4180 CSV parser: quotes, escaped quotes, commas and newlines in quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export function toCsv(rows) {
  const cell = (v) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join(';') : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// Maps CSV rows (with a header) to lead fields. Accepts common header names.
export function leadsFromCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const idx = (...names) => header.findIndex((h) => names.includes(h.trim().toLowerCase().replace(/[\s_-]+/g, '')));
  const col = {
    url: idx('profileurl', 'linkedinurl', 'url', 'linkedin', 'profile'),
    name: idx('fullname', 'name'),
    first: idx('firstname'),
    last: idx('lastname'),
    headline: idx('headline', 'title', 'jobtitle'),
    company: idx('company', 'companyname'),
    location: idx('location'),
  };
  if (col.url < 0) throw new Error('The CSV needs a column with LinkedIn profile URLs (e.g. "profile_url").');
  return rows
    .map((r) => {
      const get = (i) => (i >= 0 ? (r[i] || '').trim() : '');
      const full = get(col.name) || [get(col.first), get(col.last)].filter(Boolean).join(' ');
      return {
        profile_url: normalizeProfileUrl(get(col.url)),
        full_name: full || null,
        first_name: get(col.first) || firstNameOf(full) || null,
        headline: get(col.headline) || null,
        company: get(col.company) || companyFromHeadline(get(col.headline)) || null,
        location: get(col.location) || null,
      };
    })
    .filter((l) => l.profile_url);
}
