(function () {
  const isAboutPage = window.location.pathname.toLowerCase().endsWith('/about.html');
  const aboutHref = isAboutPage ? '#about' : '/#about';
  const contactHref = isAboutPage ? '#contact' : '/#contact';

  if (!document.querySelector('link[href="site-header.css"]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'site-header.css';
    document.head.appendChild(stylesheet);
  }

  let header = document.querySelector('.site-header, .project-header, .sticky-header');
  if (!header) {
    header = document.querySelector('.project-header');
  }
  if (!header) {
    header = document.createElement('header');
    document.body.prepend(header);
  }

  header.className = 'site-header';
  header.innerHTML = `<a class="site-header-brand" href="/" aria-label="Back to home"><img class="site-header-logo" src="assets/logos/a-logo.svg" alt="Alfie Brown logo"><span>Alfie Brown</span></a><nav class="site-header-nav" aria-label="Portfolio navigation"><a href="${aboutHref}">About</a><a href="/the-box/">The Box</a><a href="/#work">Work</a><a href="${contactHref}">Contact</a></nav><button class="site-header-menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="menu-panel"><span></span><span></span><span></span></button>`;

  let panel = document.querySelector('.site-header-menu-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'site-header-menu-panel';
    panel.id = 'menu-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `<nav class="site-header-menu-links" aria-label="Mobile navigation"><a href="${aboutHref}">About</a><a href="/the-box/">The Box</a><a href="/#work">Work</a><a href="${contactHref}">Contact</a></nav>`;
    document.body.prepend(panel);
  }

  document.body.classList.add('has-site-header');
  const toggle = document.querySelector('.site-header-menu-toggle');
  if (!toggle || !panel) return;

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu');
    panel.classList.toggle('is-open', !isOpen);
    panel.setAttribute('aria-hidden', String(isOpen));
    document.body.classList.toggle('site-menu-open', !isOpen);
  });

  panel.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('site-menu-open');
    });
  });
})();