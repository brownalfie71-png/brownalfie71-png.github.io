// The Box: view counts, approved-comment counts and the comment thread.
// Views are stored by Abacus (free counting service) and comments by Cusdis.
(() => {
  const VIEWS_API = 'https://abacus.jasoncameron.dev';
  const VIEWS_NAMESPACE = 'alfiebrowndesign';

  const CUSDIS_HOST = 'https://cusdis.com';
  // Paste the App ID from the Cusdis dashboard here. Until then the comment
  // section stays hidden and comment counts show 0.
  const CUSDIS_APP_ID = '';

  const show = (selector, value) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.textContent = Number(value).toLocaleString('en-GB');
    });
  };

  // ---- Views
  // A post page adds one view every time it is opened (data-count-view on <body>).
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

  // ---- Comment counts (Cusdis only counts approved comments)
  const commentIds = [...new Set([...document.querySelectorAll('[data-comments]')].map((el) => el.dataset.comments))];
  if (commentIds.length && !CUSDIS_APP_ID) {
    commentIds.forEach((id) => show(`[data-comments="${id}"]`, 0));
  } else if (commentIds.length) {
    fetch(`${CUSDIS_HOST}/api/open/project/${CUSDIS_APP_ID}/comments/count?pageIds=${encodeURIComponent(commentIds.join(','))}`)
      .then((res) => res.json())
      .then(({ data }) => commentIds.forEach((id) => show(`[data-comments="${id}"]`, data[id] ?? 0)))
      .catch(() => {});
  }

  // ---- Comment thread on a post page
  const thread = document.getElementById('cusdis_thread');
  if (thread && CUSDIS_APP_ID) {
    thread.dataset.appId = CUSDIS_APP_ID;
    thread.closest('[hidden]')?.removeAttribute('hidden');
    const sdk = document.createElement('script');
    sdk.src = `${CUSDIS_HOST}/js/cusdis.es.js`;
    sdk.async = true;
    document.body.appendChild(sdk);
  }
})();
