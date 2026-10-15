// Works out the LinkedIn session state from what the browser is showing.
// It only reads the current page; it never navigates on its own.

const LOGGED_OUT_PATHS = [/^\/login/, /^\/uas\/login/, /^\/checkpoint\/lg\//, /^\/authwall/, /^\/signup/, /^\/$/];
const LOGGED_IN_PATHS = [/^\/feed/, /^\/in\//, /^\/mynetwork/, /^\/messaging/, /^\/notifications/, /^\/search\//, /^\/company\//, /^\/sales\//, /^\/jobs/];

const WARNING_PATTERNS = [
  ['restricted', /account (has been|is|was) (temporarily )?restricted/i],
  ['restricted', /we('|’)ve restricted your account/i],
  ['checkpoint', /let('|’)s do a quick security check/i],
  ['checkpoint', /verify (your|it('|’)s really) (identity|you)/i],
  ['checkpoint', /unusual activity/i],
];

export function classifyUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'unknown';
  }
  if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return 'unknown';
  const path = url.pathname;
  if (path.startsWith('/checkpoint/') && !path.startsWith('/checkpoint/lg/')) return 'checkpoint';
  if (LOGGED_OUT_PATHS.some((re) => re.test(path))) return 'logged_out';
  if (LOGGED_IN_PATHS.some((re) => re.test(path))) return 'ok';
  return 'unknown';
}

// Returns a warning state if the page text shows one, else null.
export function classifyText(text) {
  for (const [state, re] of WARNING_PATTERNS) {
    const m = text.match(re);
    if (m) return { state, detail: m[0] };
  }
  return null;
}
