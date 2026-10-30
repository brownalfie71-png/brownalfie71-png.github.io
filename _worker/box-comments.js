// The Box comments
// A small Cloudflare Worker that stores comments for alfiebrowndesign.co.uk in a D1 database.
// Every new comment is hidden until it's approved on the private /admin page.
//
// Set up in the Cloudflare dashboard (see README.md next to this file):
//   DB              D1 database binding
//   ADMIN_KEY       secret: the password for /admin (only you know it)
//   NTFY_TOPIC      optional: an ntfy.sh topic name, to get a phone notification for each new comment
//   ALLOWED_ORIGINS optional: comma-separated sites allowed to use the comments (defaults below)

const DEFAULT_ORIGINS = [
  'https://alfiebrowndesign.co.uk',
  'https://www.alfiebrowndesign.co.uk',
  'https://brownalfie71-png.github.io',
];
const SLUG = /^[a-z0-9-]{1,80}$/;
const MAX_NAME = 60;
const MAX_BODY = 2000;
const RATE_LIMIT = { count: 3, minutes: 10 }; // per visitor

let schemaReady = false;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/admin') return adminPage();
    if (!env.DB) return json({ error: 'The D1 database is not connected yet (binding name: DB).' }, 503);
    await ensureSchema(env.DB);

    if (path.startsWith('/admin/api/')) return adminApi(request, env, path);

    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    try {
      if (path === '/comments' && request.method === 'GET') return await listComments(url, env, headers);
      if (path === '/comments' && request.method === 'POST') return await addComment(request, url, env, ctx, headers);
      if (path === '/counts' && request.method === 'GET') return await countComments(url, env, headers);
    } catch (error) {
      return json({ error: 'Something went wrong. Please try again.' }, 500, headers);
    }
    return json({ error: 'Not found' }, 404, headers);
  },
};

// ---------- Public API (used by the website)

async function listComments(url, env, headers) {
  const post = url.searchParams.get('post') || '';
  if (!SLUG.test(post)) return json({ error: 'Unknown post' }, 400, headers);
  const { results } = await env.DB
    .prepare('SELECT id, name, body, created_at FROM comments WHERE post = ? AND approved = 1 ORDER BY id LIMIT 500')
    .bind(post)
    .all();
  return json({ comments: results }, 200, headers);
}

async function addComment(request, url, env, ctx, headers) {
  if (Number(request.headers.get('Content-Length') || 0) > 10000) return json({ error: 'That comment is too long.' }, 413, headers);

  let data;
  try {
    data = await request.json();
  } catch (error) {
    return json({ error: 'Invalid request' }, 400, headers);
  }

  // Hidden "website" field: people never see it, spam bots fill it in. Pretend it worked.
  if (data.website) return json({ status: 'pending' }, 202, headers);

  const post = String(data.post || '');
  const name = cleanText(data.name);
  const body = cleanText(data.body);
  if (!SLUG.test(post)) return json({ error: 'Unknown post' }, 400, headers);
  if (!name || name.length > MAX_NAME) return json({ error: `Please add your name (up to ${MAX_NAME} characters).` }, 400, headers);
  if (!body || body.length > MAX_BODY) return json({ error: `Please write a comment (up to ${MAX_BODY.toLocaleString('en-GB')} characters).` }, 400, headers);

  // Rate limit by a one-way hash of the visitor's IP address (the address itself is never stored)
  const ipHash = await hashText(`${env.ADMIN_KEY || 'the-box'}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);
  const since = new Date(Date.now() - RATE_LIMIT.minutes * 60 * 1000).toISOString();
  const recent = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, since)
    .first('n');
  if (recent >= RATE_LIMIT.count) return json({ error: 'Too many comments in a short time. Please try again later.' }, 429, headers);

  await env.DB
    .prepare('INSERT INTO comments (post, name, body, created_at, ip_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(post, name, body, new Date().toISOString(), ipHash)
    .run();

  if (env.NTFY_TOPIC) {
    ctx.waitUntil(
      fetch(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, {
        method: 'POST',
        headers: { Title: 'New comment waiting for approval', Click: `${url.origin}/admin` },
        body: `${name} on ${post}: ${body.slice(0, 140)}`,
      }).catch(() => {}),
    );
  }

  return json({ status: 'pending' }, 202, headers);
}

async function countComments(url, env, headers) {
  const posts = (url.searchParams.get('posts') || '').split(',').filter((p) => SLUG.test(p)).slice(0, 50);
  const counts = Object.fromEntries(posts.map((p) => [p, 0]));
  if (posts.length) {
    const { results } = await env.DB
      .prepare(`SELECT post, COUNT(*) AS n FROM comments WHERE approved = 1 AND post IN (${posts.map(() => '?').join(',')}) GROUP BY post`)
      .bind(...posts)
      .all();
    results.forEach((row) => { counts[row.post] = row.n; });
  }
  return json({ counts }, 200, headers);
}

// ---------- Admin API (used by the /admin page, needs ADMIN_KEY)

async function adminApi(request, env, path) {
  if (!env.ADMIN_KEY) return json({ error: 'Set the ADMIN_KEY secret in Cloudflare first.' }, 503);
  if (!(await isAdmin(request, env))) return json({ error: 'Wrong key' }, 401);

  if (path === '/admin/api/comments' && request.method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id, post, name, body, created_at, approved FROM comments ORDER BY approved ASC, id DESC LIMIT 500')
      .all();
    return json({ comments: results });
  }

  if (request.method === 'POST') {
    let id;
    try {
      id = Number((await request.json()).id);
    } catch (error) {
      return json({ error: 'Invalid request' }, 400);
    }
    if (!Number.isInteger(id)) return json({ error: 'Invalid id' }, 400);

    const statements = {
      '/admin/api/approve': 'UPDATE comments SET approved = 1 WHERE id = ?',
      '/admin/api/hide': 'UPDATE comments SET approved = 0 WHERE id = ?',
      '/admin/api/delete': 'DELETE FROM comments WHERE id = ?',
    };
    if (statements[path]) {
      await env.DB.prepare(statements[path]).bind(id).run();
      return json({ ok: true });
    }
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- Helpers

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      ip_hash TEXT
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS comments_by_post ON comments (post, approved)'),
  ]);
  schemaReady = true;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function hashText(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function isAdmin(request, env) {
  const given = new TextEncoder().encode((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
  const expected = new TextEncoder().encode(env.ADMIN_KEY);
  if (given.byteLength !== expected.byteLength) return false;
  return crypto.subtle.timingSafeEqual(given, expected);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS;
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

// ---------- The /admin page

function adminPage() {
  return new Response(ADMIN_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>The Box comments</title>
<style>
  :root { --bg: #1F1F1F; --raised: #2C2C2C; --ink: #DADAD7; --strong: #F4F4F2; --muted: #9A9A96; --rule: #383838; --accent: #E96D26; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, sans-serif; }
  main { width: min(860px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 80px; }
  h1 { margin: 0 0 24px; color: var(--accent); font-size: 2rem; }
  h2 { margin: 40px 0 12px; color: var(--strong); font-size: 1.1rem; }
  form, .bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  input[type=password] { flex: 1 1 260px; min-height: 44px; padding: 0 12px; border: 1px solid var(--muted); border-radius: 10px; background: var(--raised); color: var(--strong); font: inherit; }
  label { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); font-size: 0.9rem; }
  button { min-height: 40px; padding: 0 16px; border: 1px solid var(--muted); border-radius: 10px; background: transparent; color: var(--strong); font: inherit; cursor: pointer; }
  button.primary { border-color: var(--accent); background: var(--accent); color: var(--bg); font-weight: 600; }
  button:hover, button:focus-visible { border-color: var(--strong); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { padding: 16px 0; border-top: 1px solid var(--rule); }
  .meta { color: var(--muted); font-size: 0.85rem; }
  .meta strong { color: var(--strong); }
  .body { margin: 8px 0 12px; white-space: pre-line; }
  .empty, .status { color: var(--muted); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>The Box comments</h1>
  <form id="login">
    <input id="key" type="password" autocomplete="current-password" placeholder="Admin key" aria-label="Admin key" required>
    <label><input id="remember" type="checkbox"> Remember on this device</label>
    <button class="primary" type="submit">Open</button>
  </form>
  <p class="status" id="status" role="status"></p>
  <section id="lists" hidden>
    <div class="bar"><button id="refresh" type="button">Refresh</button><button id="logout" type="button">Log out</button></div>
    <h2>Waiting for approval (<span id="pending-count">0</span>)</h2>
    <ul id="pending"></ul>
    <h2>Live on the site (<span id="live-count">0</span>)</h2>
    <ul id="live"></ul>
  </section>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  let key = '';
  try { key = localStorage.getItem('box-admin-key') || sessionStorage.getItem('box-admin-key') || ''; } catch (e) {}

  const call = async (path, body) => {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const item = (c) => {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const who = document.createElement('strong');
    who.textContent = c.name;
    meta.append(who, ' on ' + c.post + ' · ' + new Date(c.created_at).toLocaleString('en-GB'));
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = c.body;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const act = (label, path, primary, ask) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.onclick = async () => {
        if (ask && !confirm(ask)) return;
        b.disabled = true;
        try { await call(path, { id: c.id }); await load(); } catch (e) { $('status').textContent = e.message; b.disabled = false; }
      };
      return b;
    };
    if (c.approved) bar.append(act('Hide', '/admin/api/hide'), act('Delete', '/admin/api/delete', false, 'Delete this comment for good?'));
    else bar.append(act('Approve', '/admin/api/approve', true), act('Delete', '/admin/api/delete', false, 'Delete this comment for good?'));
    li.append(meta, body, bar);
    return li;
  };

  const fill = (id, list) => {
    const ul = $(id);
    ul.replaceChildren(...list.map(item));
    if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nothing here.'; ul.append(li); }
    $(id + '-count').textContent = list.length;
  };

  async function load() {
    $('status').textContent = 'Loading...';
    try {
      const { comments } = await call('/admin/api/comments');
      fill('pending', comments.filter((c) => !c.approved));
      fill('live', comments.filter((c) => c.approved));
      $('login').hidden = true;
      $('lists').hidden = false;
      $('status').textContent = '';
    } catch (e) {
      $('status').textContent = e.message === 'Wrong key' ? 'That key is wrong.' : e.message;
      $('login').hidden = false;
      $('lists').hidden = true;
    }
  }

  $('login').onsubmit = (e) => {
    e.preventDefault();
    key = $('key').value;
    try { ($('remember').checked ? localStorage : sessionStorage).setItem('box-admin-key', key); } catch (err) {}
    $('key').value = '';
    load();
  };
  $('refresh').onclick = load;
  $('logout').onclick = () => {
    key = '';
    try { localStorage.removeItem('box-admin-key'); sessionStorage.removeItem('box-admin-key'); } catch (e) {}
    $('lists').hidden = true;
    $('login').hidden = false;
  };
  if (key) load();
</script>
</body>
</html>`;
