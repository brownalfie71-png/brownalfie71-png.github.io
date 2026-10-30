// The Box: view counts, comment counts, and comments on posts.
// Views are counted by Abacus (free counting service).
// Comments are stored by Alfie's own Cloudflare Worker (see _worker/ in this repo)
// and only appear once he has approved them.
(() => {
  const VIEWS_API = 'https://abacus.jasoncameron.dev';
  const VIEWS_NAMESPACE = 'alfiebrowndesign';

  // The Cloudflare Worker's address, e.g. 'https://box-comments.yourname.workers.dev'.
  // Until it's set, the comment section stays hidden and comment counts show 0.
  const COMMENTS_API = 'https://box-comments.brownalfie71.workers.dev';

  const formatNumber = (n) => Number(n).toLocaleString('en-GB');
  const show = (selector, value) => {
    document.querySelectorAll(selector).forEach((el) => { el.textContent = formatNumber(value); });
  };

  // ---- Views
  // A post page adds one view every time it's opened (data-count-view on <body>).
  // The Box page only reads the totals, so browsing the list doesn't inflate them.
  const counted = document.body.dataset.countView;
  const viewSlugs = new Set([...document.querySelectorAll('[data-views]')].map((el) => el.dataset.views));
  if (counted) viewSlugs.add(counted);

  viewSlugs.forEach(async (slug) => {
    const action = slug === counted ? 'hit' : 'get';
    try {
      const res = await fetch(`${VIEWS_API}/${action}/${VIEWS_NAMESPACE}/${slug}`);
      if (res.status === 404) return show(`[data-views="${slug}"]`, 0); // not opened yet
      if (!res.ok) return;
      const { value } = await res.json();
      show(`[data-views="${slug}"]`, value);
    } catch (error) {
      // Counter unreachable: leave the placeholder dash
    }
  });

  // ---- Comment counts (approved comments only)
  const countIds = [...new Set([...document.querySelectorAll('[data-comments]')].map((el) => el.dataset.comments))];
  if (countIds.length && !COMMENTS_API) {
    countIds.forEach((id) => show(`[data-comments="${id}"]`, 0));
  } else if (countIds.length) {
    fetch(`${COMMENTS_API}/counts?posts=${encodeURIComponent(countIds.join(','))}`)
      .then((res) => res.json())
      .then(({ counts }) => countIds.forEach((id) => show(`[data-comments="${id}"]`, counts[id] ?? 0)))
      .catch(() => {});
  }

  // ---- Comments on a post page
  const section = document.querySelector('[data-comments-for]');
  if (!section || !COMMENTS_API) return;
  section.hidden = false;

  const post = section.dataset.commentsFor;
  const list = section.querySelector('.comment-list');
  const empty = section.querySelector('.comment-empty');
  const form = section.querySelector('.comment-form');
  const status = section.querySelector('.comment-status');
  const submit = form.querySelector('button[type="submit"]');

  const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const renderComment = (comment) => {
    const li = document.createElement('li');
    li.className = 'comment';
    const meta = document.createElement('p');
    meta.className = 'comment-meta';
    const name = document.createElement('strong');
    name.textContent = comment.name;
    const time = document.createElement('time');
    time.dateTime = comment.created_at;
    time.textContent = dateFormat.format(new Date(comment.created_at));
    meta.append(name, time);
    const body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = comment.body; // plain text only, so nothing posted can run as code
    li.append(meta, body);
    return li;
  };

  const loadComments = async () => {
    try {
      const res = await fetch(`${COMMENTS_API}/comments?post=${encodeURIComponent(post)}`);
      if (!res.ok) throw new Error();
      const { comments } = await res.json();
      list.replaceChildren(...comments.map(renderComment));
      empty.hidden = comments.length > 0;
    } catch (error) {
      empty.hidden = false;
      empty.textContent = "Comments couldn't load right now.";
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    status.textContent = 'Sending...';
    try {
      const res = await fetch(`${COMMENTS_API}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post,
          name: form.elements.name.value,
          body: form.elements.body.value,
          website: form.elements.website.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Your comment couldn't be sent. Please try again.");
      form.reset();
      status.textContent = "Thanks! Your comment will appear once I've approved it.";
    } catch (error) {
      // A network failure throws a TypeError; anything else is a message from the server
      status.textContent = error instanceof TypeError
        ? "Your comment couldn't be sent. Please try again."
        : error.message;
    } finally {
      submit.disabled = false;
    }
  });

  loadComments();
})();
