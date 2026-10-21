/* Keep the sidebar and search mounted while switching articles. */
if (window.fetch && window.AbortController && window.history.pushState) {
  var articleRequest = null;
  var currentArticleUrl = window.location.href;
  var articleScrollPositions = new Map();
  window.history.scrollRestoration = 'manual';

  async function navigateArticle(url, restorePosition) {
    articleScrollPositions.set(currentArticleUrl, { x: window.scrollX, y: window.scrollY });
    if (articleRequest) articleRequest.abort();
    var request = new AbortController();
    articleRequest = request;
    var contentWrap = document.getElementById('main-content-wrap');
    contentWrap.setAttribute('aria-busy', 'true');

    try {
      var response = await fetch(url.href, { signal: request.signal });
      if (!response.ok || new URL(response.url).origin !== window.location.origin) {
        throw new Error('Unable to load article');
      }
      var nextDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (request.signal.aborted) return;
      var nextContent = nextDocument.getElementById('main-content-wrap');
      if (!nextContent) throw new Error('Missing article content');

      if (!restorePosition && url.href !== window.location.href) {
        window.history.pushState(null, '', url.href);
      }
      currentArticleUrl = url.href;
      contentWrap.replaceWith(nextContent);
      document.title = nextDocument.title;

      /* Keep page metadata in step with the address and visible article. */
      document.head.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"], script[type="application/ld+json"]').forEach(function (element) {
        element.remove();
      });
      nextDocument.head.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"], script[type="application/ld+json"]').forEach(function (element) {
        document.head.appendChild(element.cloneNode(true));
      });

      var sidebarPosition = sidebarNav.scrollTop;
      /* Reuse server-rendered selection, including any parent navigation items. */
      var nextLinks = nextDocument.querySelectorAll('#site-nav .nav-list-link');
      sidebarNav.querySelectorAll('.nav-list-link').forEach(function (link, index) {
        var nextLink = nextLinks[index];
        var active = nextLink && nextLink.classList.contains('active');
        link.classList.toggle('active', !!active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
        if (nextLink) {
          link.parentElement.classList.toggle('active', nextLink.parentElement.classList.contains('active'));
        }
      });
      setLanguage(selectedLanguage);
      sidebarNav.scrollTop = sidebarPosition;
      linkifyPreBlocks();

      /* Scripts inserted through DOMParser do not run. Restart article widgets,
         including the comment thread, after updating the current address. */
      nextContent.querySelectorAll('script').forEach(function (original) {
        var script = document.createElement('script');
        Array.prototype.forEach.call(original.attributes, function (attribute) {
          script.setAttribute(attribute.name, attribute.value);
        });
        script.textContent = original.textContent;
        original.replaceWith(script);
      });

      if (!desktopSidebar.matches) {
        sidebarNav.classList.remove('nav-open');
        document.getElementById('main-header').classList.remove('nav-open');
        var menu = document.getElementById('menu-button');
        menu.classList.remove('nav-open');
        menu.setAttribute('aria-expanded', 'false');
      }

      var title = nextContent.querySelector('.page-title');
      if (title) {
        title.setAttribute('tabindex', '-1');
        title.focus({ preventScroll: true });
      }
      var position = restorePosition && articleScrollPositions.get(url.href);
      var anchor = null;
      if (url.hash) {
        try { anchor = document.getElementById(decodeURIComponent(url.hash.slice(1))); }
        catch (error) { /* Fall back to the article top for malformed fragments. */ }
      }
      if (position) window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
      else if (anchor) anchor.scrollIntoView({ behavior: 'instant' });
      else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      scheduleSidebarScrollUpdate();
    } catch (error) {
      if (!request.signal.aborted) window.location.assign(url.href);
    } finally {
      if (articleRequest === request) {
        articleRequest = null;
        document.getElementById('main-content-wrap').removeAttribute('aria-busy');
      }
    }
  }

  sidebarNav.addEventListener('click', function (event) {
    var link = event.target.closest('a.nav-list-link');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    var url = new URL(link.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    navigateArticle(url, false);
  });

  window.addEventListener('popstate', function () {
    /* Same-document fragment navigation keeps its native browser behavior. */
    var previous = new URL(currentArticleUrl);
    if (!articleRequest && previous.pathname === window.location.pathname && previous.search === window.location.search) {
      currentArticleUrl = window.location.href;
      var anchor = null;
      try { anchor = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); }
      catch (error) { /* Malformed fragments use the article top. */ }
      if (anchor) anchor.scrollIntoView({ behavior: 'instant' });
      else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      return;
    }
    navigateArticle(new URL(window.location.href), true);
  });
}
