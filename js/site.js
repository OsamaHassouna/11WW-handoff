/**
 * Site shell loader
 * -----------------------------------------------------------------------------
 * Fetches the shared chrome (topbar, nav, hero, footer, cookie bar, a11y panel)
 * into placeholder elements, then tells NDS to initialise what just arrived.
 *
 * WHY THIS EXISTS
 * The NDS bundle takes one DOM sweep on DOMContentLoaded. Anything injected
 * after that point is invisible to it, so we re-run the sweep once the partials
 * land. NDS.Mainnav in particular caches its DOM refs at parse time, which is
 * why the nav interactions are re-bound here rather than left to the bundle.
 *
 * MOVING THIS TO A CMS
 * This file exists so the site runs as flat files with zero tooling. Once the
 * pages are rendered server-side, include the partials in the template instead
 * and delete the loader block below: it removes the fetch waterfall and the
 * re-init entirely. The page behaviour further down (language links, search,
 * countdown, hero video, modals, gallery, sticky and mobile nav) should be kept.
 *
 * NOTE: fetch() requires http(s). Opening index.html from the filesystem will
 * leave the placeholders empty. Serve the folder over HTTP.
 */
(function () {
    'use strict';

    // Chrome is per-language. The accessibility panel is not: it carries 28
    // translation hooks (20 data-i18n + 8 data-i18n-attr) and translates itself
    // from <html lang> against assets/i18n/accessibility/{lang}.json, so one
    // copy serves both, exactly as dga-html ships it.
    var isArabic = (document.documentElement.lang || 'en').toLowerCase().indexOf('ar') === 0;
    var dir = isArabic ? 'partials-ar/' : 'partials/';

    var PARTIALS = [
        { id: 'shell-hero-main', file: dir + 'hero-main.html' },
        { id: 'shell-topbar', file: dir + 'topbar.html' },
        { id: 'shell-mainnav', file: dir + 'mainnav.html' },
        { id: 'shell-footer', file: dir + 'footer.html' },
        { id: 'shell-cookie', file: dir + 'cookie-popup.html' },
        { id: 'shell-a11y', file: 'partials/accessibility-panel.html' }
    ];

    // NOTE: do not prepend the <base href> here. fetch() already resolves a
    // relative URL against the document's base URL, so adding it again
    // double-applies it and every partial 404s from pages/ in a sub-path
    // deployment.
    var loads = PARTIALS.map(function (p) {
        var host = document.getElementById(p.id);
        if (!host) return Promise.resolve();

        return fetch(p.file)
            .then(function (res) {
                if (!res.ok) throw new Error(p.file + ' -> ' + res.status);
                return res.text();
            })
            .then(function (html) {
                host.innerHTML = html;
                // innerHTML does not execute scripts. Re-create any that came in.
                host.querySelectorAll('script').forEach(function (old) {
                    var s = document.createElement('script');
                    if (old.type) s.type = old.type;
                    if (old.src) s.src = old.src; else s.textContent = old.textContent;
                    old.parentNode.replaceChild(s, old);
                });
            })
            .catch(function (err) {
                console.warn('[shell] partial failed:', err.message);
            });
    });

    var domReady = new Promise(function (resolve) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', resolve);
        } else {
            resolve();
        }
    });

    // The announcement exists only on the homepage, so this returns immediately
    // everywhere else without adding page checks to the shared shell loader.
    domReady.then(initHomeAnnouncementModal);
    domReady.then(initKnowledgeCaseModal);

    Promise.all([Promise.all(loads), domReady]).then(function () {
        markActiveNav();
        applyPageMeta();
        syncLanguageSwitches();
        initSiteSearch();
        initHeroVideo();
        initCountdowns();
        document.dispatchEvent(new CustomEvent('shell:ready'));

        if (typeof NDS !== 'undefined') {
            // Idempotent: components guard themselves with data-nds-*-initialized.
            if (NDS.Init && NDS.Init.reinitialize) NDS.Init.reinitialize();
            if (NDS.TimeDate && NDS.TimeDate.init) {
                try { NDS.TimeDate.init(); } catch (e) { /* clock is optional */ }
            }
        }

        initGalleryImageViewer();

        revealChrome();
        initStickyMainNav();
        syncMinimalNav();
        bindNavDropdowns();
        bindMobileNav();
        bindDigitalStamp();
        bindMinimalNavResize();
        bindFormSuccessNavigation();
    });

    /* --- language links -------------------------------------------------- */
    function syncLanguageSwitches() {
        var targetLanguage = isArabic ? 'en' : 'ar';
        var currentUrl = new URL(window.location.href);
        var pathParts = currentUrl.pathname.split('/');
        var currentPage = pathParts.pop() || 'index.html';
        var targetPage;

        if (currentPage === 'index.html' || currentPage === 'index-ar.html') {
            targetPage = isArabic ? 'index.html' : 'index-ar.html';
        } else if (isArabic && /-ar\.html$/i.test(currentPage)) {
            targetPage = currentPage.replace(/-ar\.html$/i, '.html');
        } else if (!isArabic && /\.html$/i.test(currentPage)) {
            targetPage = currentPage.replace(/\.html$/i, '-ar.html');
        }

        var targetUrl;
        if (targetPage) {
            pathParts.push(targetPage);
            currentUrl.pathname = pathParts.join('/');
            targetUrl = currentUrl;
        } else {
            targetUrl = new URL(isArabic ? 'index.html' : 'index-ar.html', document.baseURI);
            targetUrl.search = currentUrl.search;
            targetUrl.hash = currentUrl.hash;
        }

        var targetHref = targetUrl.pathname + targetUrl.search + targetUrl.hash;

        document.querySelectorAll('[data-language-switch], #shellMainNav .nds-nav-item.lang > a').forEach(function (link) {
            link.setAttribute('href', targetHref);
            link.setAttribute('hreflang', targetLanguage);
        });
    }

    /* --- site search ----------------------------------------------------- */
    function initSiteSearch() {
        var form = document.querySelector('[data-site-search]');
        var results = document.getElementById('search-results-content');
        if (!form || !results || form.hasAttribute('data-search-bound')) return;
        form.setAttribute('data-search-bound', '');

        var input = form.querySelector('input[name="q"]');
        var clear = form.querySelector('[data-search-clear]');
        var heading = document.getElementById('search-results-title');
        var output = document.querySelector('[data-search-output]');
        var queryOutput = document.querySelector('[data-search-query]');
        var countOutput = document.querySelector('[data-search-count]');
        var empty = document.querySelector('[data-search-empty]');
        var pagination = document.querySelector('.wwf-search-results .nds-pagination');
        var items = Array.prototype.slice.call(results.querySelectorAll('.nds-page-item'));
        var searchIndex = items.map(function (item) {
            var title = item.querySelector('.nds-card-title');

            return {
                item: item,
                title: title ? title.textContent.toLocaleLowerCase() : '',
                content: ((item.getAttribute('data-search-text') || '') + ' ' + item.textContent)
                    .toLocaleLowerCase()
            };
        });
        var pageSize = parseInt(results.getAttribute('data-search-per-page'), 10) || 6;
        if (!input || !heading || !output || !queryOutput || !countOutput) return;

        function refreshPagination() {
            if (!window.NDS || !NDS.Pagination) return;
            if (typeof NDS.Pagination.initAuto === 'function') NDS.Pagination.initAuto();
            if (typeof NDS.Pagination.refresh === 'function') NDS.Pagination.refresh(results);
        }

        function updateUrl(query) {
            var url = new URL(window.location.href);
            if (query) url.searchParams.set('q', query);
            else url.searchParams.delete('q');
            window.history.pushState({ query: query }, '', url.pathname + url.search + url.hash);
        }

        function applySearch(shouldUpdateUrl) {
            var query = input.value.trim();
            var terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
            var count = 0;
            var hasTitleMatches = terms.length && searchIndex.some(function (entry) {
                return terms.every(function (term) { return entry.title.indexOf(term) !== -1; });
            });

            searchIndex.forEach(function (entry) {
                var item = entry.item;
                var searchable = hasTitleMatches ? entry.title : entry.content;
                var matches = terms.every(function (term) { return searchable.indexOf(term) !== -1; });

                if (matches) {
                    item.removeAttribute('data-filtered');
                    item.hidden = false;
                    count += 1;
                } else {
                    item.setAttribute('data-filtered', '');
                    item.hidden = true;
                }
            });

            queryOutput.textContent = query ? ' “' + query + '”' : '';
            countOutput.textContent = query ? String(count) : '0';
            output.hidden = !query;
            var searchPageTitle = form.getAttribute('data-search-page-title')
                || 'Search | 11th World Water Forum';
            var searchResultsTitleTemplate = form.getAttribute('data-search-results-title-template')
                || 'Search results for {query} | 11th World Water Forum';
            document.title = query
                ? searchResultsTitleTemplate.replace('{query}', query)
                : searchPageTitle;
            if (clear) clear.hidden = !query;
            if (empty) empty.hidden = !query || count !== 0;
            if (pagination) pagination.hidden = !query || count <= pageSize;
            if (shouldUpdateUrl) updateUrl(query);

            window.setTimeout(refreshPagination, 0);
        }

        var initialQuery = new URL(window.location.href).searchParams.get('q') || '';
        input.value = initialQuery;
        applySearch(false);

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            applySearch(true);
            heading.focus();
        });

        input.addEventListener('input', function () {
            if (clear) clear.hidden = !input.value;
        });

        if (clear) {
            clear.addEventListener('click', function () {
                input.value = '';
                applySearch(true);
                input.focus();
            });
        }

        window.addEventListener('popstate', function () {
            input.value = new URL(window.location.href).searchParams.get('q') || '';
            applySearch(false);
        });
    }

    /* --- valid form destinations ----------------------------------------- */
    function bindFormSuccessNavigation() {
        document.querySelectorAll('form[data-success-url]').forEach(function (form) {
            if (form.hasAttribute('data-success-bound')) return;
            form.setAttribute('data-success-bound', '');

            form.addEventListener('nds:formValid', function () {
                var target = form.getAttribute('data-success-url');
                if (target) window.location.assign(new URL(target, document.baseURI).href);
            });
        });
    }

    /* --- active nav state ------------------------------------------------- */
    function markActiveNav() {
        var here = window.location.pathname.split('/').pop() || 'index.html';
        document.querySelectorAll('.nds-nav-primary a[href]').forEach(function (a) {
            var target = a.getAttribute('href').split('/').pop();
            if (target && target === here) {
                a.setAttribute('aria-current', 'page');
                addStateToken(a, 'active');
            }
        });
    }

    /* --- page title/description into the sub hero ------------------------- */
    function applyPageMeta() {
        var page = document.querySelector('[data-page-title]');
        if (!page) return;
        var hero = document.querySelector('.nds-hero-section.nds-sub');
        if (!hero) return;
        var title = page.getAttribute('data-page-title');
        var desc = page.getAttribute('data-page-description');
        var h1 = hero.querySelector('.nds-section-title');
        var p = hero.querySelector('.nds-section-description');
        if (title && h1) h1.textContent = title;
        if (desc && p) p.textContent = desc;
    }

    /* --- deferred hero video --------------------------------------------- */
    function initHeroVideo() {
        var video = document.getElementById('hero-video');
        if (!video) return;

        var source = video.getAttribute('data-src');
        if (!source) return;

        /* Reduced motion (OS setting or the accessibility panel's mode):
           the video is never loaded and the poster stays as a still. */
        var root = document.documentElement;
        var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
        var inView = false;

        function prefersReducedMotion() {
            return (motionQuery && motionQuery.matches) ||
                (root.getAttribute('data-a11y') || '').split(/\s+/).indexOf('reduce-motion') !== -1;
        }

        function syncMotion() {
            if (prefersReducedMotion()) {
                video.pause();
            } else if (inView) {
                loadAndPlay();
            }
        }

        if (motionQuery) {
            if (motionQuery.addEventListener) motionQuery.addEventListener('change', syncMotion);
            else if (motionQuery.addListener) motionQuery.addListener(syncMotion);
        }

        if ('MutationObserver' in window) {
            new MutationObserver(syncMotion).observe(root, { attributes: true, attributeFilter: ['data-a11y'] });
        }

        function loadAndPlay() {
            if (prefersReducedMotion()) return;

            if (!video.getAttribute('src')) {
                video.setAttribute('src', source);
                video.load();
            }

            var playback = video.play();
            if (playback && typeof playback.catch === 'function') {
                playback.catch(function () { /* poster remains if autoplay is blocked */ });
            }
        }

        if (!('IntersectionObserver' in window)) {
            inView = true;
            loadAndPlay();
            return;
        }

        var observer = new IntersectionObserver(function (entries) {
            if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
            observer.disconnect();
            inView = true;
            loadAndPlay();
        }, { rootMargin: '200px 0px' });

        observer.observe(video);
    }

    /* --- data-driven countdowns ------------------------------------------ */
    function initCountdowns() {
        document.querySelectorAll('[data-countdown-target]').forEach(function (countdown) {
            if (countdown.hasAttribute('data-countdown-initialized')) return;

            var targetValue = countdown.getAttribute('data-countdown-target');
            var targetTime = Date.parse(targetValue);
            if (!targetValue || Number.isNaN(targetTime)) {
                countdown.setAttribute('data-countdown-state', 'invalid');
                return;
            }

            var values = {
                days: countdown.querySelector('[data-countdown-unit="days"]'),
                hours: countdown.querySelector('[data-countdown-unit="hours"]'),
                minutes: countdown.querySelector('[data-countdown-unit="minutes"]'),
                seconds: countdown.querySelector('[data-countdown-unit="seconds"]')
            };

            if (Object.keys(values).some(function (unit) { return !values[unit]; })) {
                countdown.setAttribute('data-countdown-state', 'invalid');
                return;
            }

            var intervalId = null;
            countdown.setAttribute('data-countdown-initialized', '');

            // The spoken label is authored per language on the element, so the
            // Arabic page is not announced in English. {d}/{h}/{m}/{s} are
            // substituted each tick. Falls back to English if absent.
            var labelTemplate = countdown.getAttribute('data-countdown-label') ||
                '{d} days, {h} hours, {m} minutes, and {s} seconds until the forum';

            function pad(value) {
                return String(value).padStart(2, '0');
            }

            function update() {
                var remaining = Math.max(0, targetTime - Date.now());
                var totalSeconds = Math.floor(remaining / 1000);
                var days = Math.floor(totalSeconds / 86400);
                var hours = Math.floor((totalSeconds % 86400) / 3600);
                var minutes = Math.floor((totalSeconds % 3600) / 60);
                var seconds = totalSeconds % 60;

                values.days.textContent = String(days);
                values.hours.textContent = pad(hours);
                values.minutes.textContent = pad(minutes);
                values.seconds.textContent = pad(seconds);
                countdown.setAttribute('aria-label',
                    labelTemplate
                        .replace('{d}', days).replace('{h}', hours)
                        .replace('{m}', minutes).replace('{s}', seconds));

                if (remaining <= 0) {
                    countdown.setAttribute('data-countdown-state', 'complete');
                    if (intervalId !== null) window.clearInterval(intervalId);
                } else {
                    countdown.setAttribute('data-countdown-state', 'active');
                }
            }

            update();
            if (targetTime > Date.now()) intervalId = window.setInterval(update, 1000);
        });
    }

    /* --- homepage announcement modal ------------------------------------ */
    function initHomeAnnouncementModal() {
        var modal = document.getElementById('home-announcement-modal');
        if (!modal || modal.hasAttribute('data-auto-opened')) return;
        if (typeof NDS === 'undefined' || !NDS.Modal) return;

        modal.setAttribute('data-auto-opened', '');
        modal.addEventListener('nds-modal-opened', function () {
            modal.focus();
        }, { once: true });

        if (NDS.Modal.init) NDS.Modal.init();
        NDS.Modal.open(modal);
    }

    /* --- knowledge hub case study modal -------------------------------- */
    function initKnowledgeCaseModal() {
        var section = document.querySelector('.wwf-knowledge-research');
        var modal = document.getElementById('knowledge-case-modal');
        if (!section || !modal || section.hasAttribute('data-case-modal-bound')) return;

        var modalTitle = modal.querySelector('[data-knowledge-case-modal-title]');
        var modalType = modal.querySelector('[data-knowledge-case-modal-type]');
        var modalTopic = modal.querySelector('[data-knowledge-case-modal-topic]');
        var modalDescription = modal.querySelector('[data-knowledge-case-modal-description]');
        var closeButton = modal.querySelector('.nds-modal-close');
        if (!modalTitle || !modalType || !modalTopic || !modalDescription || !closeButton) return;

        var activeTrigger = null;

        function readText(element) {
            return element.textContent.replace(/\s+/g, ' ').trim();
        }

        modal.addEventListener('nds-modal-opened', function () {
            closeButton.focus();
        });

        modal.addEventListener('nds-modal-closed', function () {
            if (activeTrigger && document.contains(activeTrigger)) activeTrigger.focus();
        });

        section.setAttribute('data-case-modal-bound', '');
        section.addEventListener('click', function (event) {
            var trigger = event.target.closest('[data-knowledge-case-open]');
            if (!trigger || !section.contains(trigger)) return;

            var source = trigger.closest('[data-knowledge-case]');
            if (!source) return;

            var sourceTitle = source.querySelector('[data-knowledge-case-title]');
            var sourceType = source.querySelector('[data-knowledge-case-type]');
            var sourceTopic = source.querySelector('[data-knowledge-case-topic]');
            var sourceDescription = source.querySelector('[data-knowledge-case-description]');
            if (!sourceTitle || !sourceType || !sourceTopic || !sourceDescription) return;

            modalTitle.textContent = readText(sourceTitle);
            modalType.textContent = readText(sourceType);
            modalTopic.textContent = readText(sourceTopic);
            modalDescription.replaceChildren(sourceDescription.content.cloneNode(true));
            activeTrigger = trigger;

            window.setTimeout(function () {
                if (!modal.hidden) closeButton.focus();
            }, 0);
        }, true);
    }

    /* --- gallery image popup viewer ------------------------------------- */
    function initGalleryImageViewer() {
        var gallery = document.querySelector('.wwf-gallery-detail__grid.nds-ipv-gallery');
        if (!gallery || gallery.hasAttribute('data-gallery-viewer-bound')) return;
        if (typeof NDS === 'undefined' || !NDS.Ipv) return;

        var viewer = NDS.Ipv.create();
        var overlay = document.getElementById('ndsIpvPopupOverlay');
        if (!viewer || !overlay) return;

        gallery.setAttribute('data-gallery-viewer-bound', '');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Image viewer');

        var activeTrigger = null;
        var closeButton = overlay.querySelector('.nds-ipv-close-btn');

        overlay.querySelectorAll('.nds-ipv-control-btn[title]').forEach(function (control) {
            control.setAttribute('aria-label', control.getAttribute('title'));
        });

        function restoreFocus() {
            if (activeTrigger) activeTrigger.focus();
        }

        gallery.querySelectorAll('[data-gallery-view]').forEach(function (button) {
            button.addEventListener('click', function () {
                var image = button.closest('.wwf-gallery-photo-card')
                    .querySelector('.nds-ipv-thumbnail');
                if (!image) return;

                activeTrigger = button;
                overlay.setAttribute('aria-label', 'Image viewer: ' + image.alt);
                viewer.open(image);

                var popupImage = document.getElementById('ndsIpvPopupImage');
                if (popupImage) popupImage.alt = image.alt;
                if (closeButton) closeButton.focus();
            });
        });

        if (closeButton) {
            closeButton.addEventListener('click', function () {
                window.setTimeout(restoreFocus, 0);
            });
        }

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && overlay.classList.contains('nds-ipv-active')) {
                window.setTimeout(restoreFocus, 0);
            }
        }, true);
    }

    /* --- NDS ships chrome hidden, reveal once it is wired ------------------ */
    function revealChrome() {
        var sel = [
            '.nds-digitalStamp-tab[hidden]',
            '.nds-collapse[hidden]',
            '.nds-nav-primary[hidden]',
            '.nds-nav-actions[hidden]'
        ].join(',');
        document.querySelectorAll(sel).forEach(function (el) {
            el.removeAttribute('hidden');
        });
    }

    /* --- sticky main navigation ----------------------------------------- */
    function initStickyMainNav() {
        var host = document.getElementById('shell-mainnav');
        var nav = host && host.querySelector('.nds-main-nav');
        if (!host || !nav || host.hasAttribute('data-sticky-nav-bound')) return;

        var frame = null;
        host.setAttribute('data-sticky-nav-bound', '');
        host.classList.add('wwf-sticky-nav-host');

        function syncStickyState() {
            if (frame !== null) return;
            frame = window.requestAnimationFrame(function () {
                frame = null;
                var isStuck = window.scrollY > 0 && host.getBoundingClientRect().top <= 0;
                if (isStuck) addStateToken(nav, 'stuck');
                else removeStateToken(nav, 'stuck');
            });
        }

        window.addEventListener('scroll', syncStickyState, { passive: true });
        window.addEventListener('resize', syncStickyState);
        syncStickyState();
    }

    /* --- minimal (mobile) nav breakpoint -----------------------------------
       NDS.Mainnav owns this in the vendor bundle, and it CANNOT run here. Its
       refs object does `nav: document.querySelector(".nds-main-nav")` as a
       plain property at PARSE time, and this loader injects the nav later, so
       t.nav is null forever. Every ref derived from it (collapse, minimal,
       toggler) is undefined, and NDS.Mainnav.init() returns at its first
       guard, `if (M || !t.collapse) return`. Calling init() again does not
       help; the null is cached, not looked up.

       Without this, the hamburger never appears. The vendor CSS gates it on
       a class the dead module was supposed to set:

           body:not(.nds-minimal) .nds-mainNav-toggler { display: none }
           body.nds-minimal       .nds-mainNav-toggler { display: flex }

       so under the breakpoint the collapse stays expanded, overflows, and is
       silently clipped by main's overflow-x, leaving most of the nav
       unreachable on a phone.

       Ported from the vendor's own C() and A(): same token, same hidden
       semantics, same PAB move. Keep it that way.                            */
    function minimalBreakpoint() {
        var bp = parseInt(getComputedStyle(document.documentElement)
            .getPropertyValue('--nds-minimal-nav-bp'), 10);
        return bp || 768;                    // the vendor's own fallback
    }

    function isMinimalWidth() {
        return window.innerWidth <= minimalBreakpoint();
    }

    function syncMinimalNav() {
        var minimal = isMinimalWidth();
        var wrap = document.querySelector('.nds-nav-minimal');

        // Same no-op test as the vendor's C(): bail unless something changed.
        if (document.body.classList.contains('nds-minimal') === minimal &&
            (!wrap || wrap.hasAttribute('hidden') === !minimal)) {
            return;
        }

        document.body.classList.toggle('nds-minimal', minimal);
        if (wrap) wrap.toggleAttribute('hidden', !minimal);
        repositionPAB(minimal);

        // Resizing past the breakpoint with the drawer open would strand it.
        if (!minimal) {
            var collapse = document.getElementById('shellNavCollapse');
            if (collapse && hasState(collapse, 'open')) closeMobileNav(collapse);
        }
    }

    function bindMinimalNavResize() {
        var timer = null;
        window.addEventListener('resize', function () {
            clearTimeout(timer);
            timer = setTimeout(syncMinimalNav, 150);
        });
    }

    /* Port of the vendor's A(). On mobile the primary action buttons
       (.nds-PAB - search, and any CTA) move out of the collapsing drawer and
       sit beside the hamburger, so they stay reachable while the menu is
       shut. A display:none placeholder span marks where each one came from.

       The vendor also deletes .nds-nav-minimal here when it ends up empty.
       That branch is deliberately NOT ported: ours always holds the toggler,
       so it can never be empty, and porting it risks deleting the hamburger. */
    function repositionPAB(minimal) {
        var pabs = document.querySelectorAll('.nds-nav-item.nds-PAB');
        if (!pabs.length) return;

        if (minimal) {
            pabs.forEach(function (el, i) {
                if (!el.dataset.origPos) {
                    var ph = document.createElement('span');
                    ph.style.display = 'none';
                    ph.dataset.pabPh = i;
                    el.parentNode.insertBefore(ph, el);
                    el.dataset.origPos = i;
                }
            });

            var wrap = document.querySelector('.nds-nav-minimal');
            if (!wrap) return;

            var list = Array.prototype.slice.call(pabs);
            // Prepended in reverse so the final order is CTAs, then the rest,
            // then the hamburger. Matches the vendor.
            list.filter(function (el) { return !el.classList.contains('nds-CTA'); })
                .reverse().forEach(function (el) { wrap.prepend(el); });
            list.filter(function (el) { return el.classList.contains('nds-CTA'); })
                .reverse().forEach(function (el) { wrap.prepend(el); });
        } else {
            pabs.forEach(function (el) {
                var pos = el.dataset.origPos;
                if (pos === undefined) return;
                var ph = document.querySelector('[data-pab-ph="' + pos + '"]');
                if (ph) {
                    ph.parentNode.insertBefore(el, ph);
                    ph.remove();
                }
                delete el.dataset.origPos;
            });
        }
    }

    /* =========================================================================
       CHROME INTERACTIONS - a faithful copy of the vendor's own loader
       -------------------------------------------------------------------------
       Everything below is transcribed from the NDS vendor loader
       (nds-includes.js), deliberately unchanged: same predicates, same
       300/350ms timings, same Escape scope. The only edit is the collapse
       element's id, which is shellNavCollapse here.

       DO NOT "IMPROVE" THIS CODE.
       It looks like it has bugs. Those are real NDS behaviours, and this site
       has to match how every other DGA site behaves. Each one was "fixed" here
       once and had to be reverted:

         - `open` stays in data-state for the whole close transition, so
           clicking a dropdown or the hamburger mid-close re-closes it instead
           of reopening. Verified side by side against dga-html.
         - Escape closes dropdowns and the mobile nav, but NOT the digital
           stamp, which is left with aria-expanded="true".
         - The transition timers are never cancelled, so toggling faster than
           300/350ms lets a stale timer land on the new state.

       If a project genuinely needs different behaviour, do it in that project's
       own script, not here.
       ====================================================================== */

    /* --- nav dropdowns ----------------------------------------------------- */
    function bindNavDropdowns() {
        document.addEventListener('click', function (e) {
            var trigger = e.target.closest('.nds-main-nav .nds-dropdown > .nds-nav-link');
            if (trigger) {
                e.preventDefault();
                var dd = trigger.closest('.nds-dropdown');
                var isOpen = hasState(dd, 'open');

                closeAllDropdowns(dd);

                if (isOpen) {
                    closeDropdown(dd);
                } else {
                    openDropdown(dd);
                }
                return;
            }

            if (e.target.closest('.nds-mainNav-toggler')) {
                e.preventDefault();
                return; // handled by bindMobileNav
            }

            var openDDs = document.querySelectorAll('.nds-main-nav .nds-dropdown[data-state~="open"]');
            openDDs.forEach(function (dd) {
                var menu = dd.querySelector('.nds-dropdown-menu');
                if (!dd.contains(e.target) && (!menu || !menu.contains(e.target))) {
                    closeDropdown(dd);
                }
            });

            var collapse = document.getElementById('shellNavCollapse');
            if (collapse && hasState(collapse, 'open')) {
                var nav = document.querySelector('.nds-main-nav');
                if (nav && !nav.contains(e.target)) {
                    closeMobileNav(collapse);
                }
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeAllDropdowns();
                var collapse = document.getElementById('shellNavCollapse');
                if (collapse && hasState(collapse, 'open')) {
                    closeMobileNav(collapse);
                }
            }
        });
    }

    function openDropdown(dd) {
        var link = dd.querySelector('.nds-nav-link');
        dd.setAttribute('data-state', 'open opening');
        if (link) addStateToken(link, 'active');
        setTimeout(function () {
            dd.setAttribute('data-state', 'open opened');
        }, 300);
    }

    function closeDropdown(dd) {
        var link = dd.querySelector('.nds-nav-link');
        dd.setAttribute('data-state', 'open closing');
        if (link) removeStateToken(link, 'active');
        setTimeout(function () {
            dd.removeAttribute('data-state');
        }, 300);
    }

    function closeAllDropdowns(except) {
        var openDDs = document.querySelectorAll('.nds-main-nav .nds-dropdown[data-state~="open"]');
        openDDs.forEach(function (dd) {
            if (dd !== except) closeDropdown(dd);
        });
    }

    /* --- mobile nav -------------------------------------------------------- */
    function bindMobileNav() {
        var toggler = document.querySelector('.nds-mainNav-toggler button');
        var collapse = document.getElementById('shellNavCollapse');
        if (!toggler || !collapse) return;
        if (toggler.hasAttribute('data-nds-bound')) return;
        toggler.setAttribute('data-nds-bound', '');

        toggler.addEventListener('click', function (e) {
            e.preventDefault();
            var isOpen = hasState(collapse, 'open');
            if (isOpen) {
                closeMobileNav(collapse);
                toggler.setAttribute('aria-expanded', 'false');
            } else {
                collapse.style.display = '';
                collapse.setAttribute('data-state', 'open opening');
                toggler.setAttribute('aria-expanded', 'true');
                setTimeout(function () {
                    collapse.setAttribute('data-state', 'open opened');
                }, 300);
            }
        });
    }

    function closeMobileNav(collapse) {
        collapse.setAttribute('data-state', 'open closing');
        var toggler = document.querySelector('.nds-mainNav-toggler button');
        if (toggler) toggler.setAttribute('aria-expanded', 'false');
        setTimeout(function () {
            collapse.removeAttribute('data-state');
        }, 300);
    }

    /* --- DGA digital stamp ------------------------------------------------- */
    function bindDigitalStamp() {
        var tab = document.querySelector('.nds-digitalStamp-tab');
        var stamp = document.getElementById('nds-digitalStamp');
        if (!tab || !stamp) return;
        if (tab.hasAttribute('data-nds-bound')) return;
        tab.setAttribute('data-nds-bound', '');

        tab.addEventListener('click', function () {
            var isOpen = hasState(stamp, 'open');
            if (isOpen) {
                stamp.setAttribute('data-state', 'open closing');
                tab.setAttribute('aria-expanded', 'false');
                removeStateToken(tab, 'expanded');
                setTimeout(function () {
                    stamp.removeAttribute('data-state');
                    stamp.style.display = 'none';
                }, 350);
            } else {
                closeAllDropdowns();
                stamp.removeAttribute('hidden');
                stamp.style.display = '';
                stamp.setAttribute('data-state', 'open opening');
                tab.setAttribute('aria-expanded', 'true');
                addStateToken(tab, 'expanded');
                setTimeout(function () {
                    stamp.setAttribute('data-state', 'open opened');
                }, 350);
            }
        });
    }

    /* --- state helpers (verbatim from the vendor loader) -------------------- */
    function hasState(el, token) {
        var state = (el.getAttribute('data-state') || '').trim();
        return state.split(/\s+/).indexOf(token) !== -1;
    }

    function addStateToken(el, token) {
        var current = (el.getAttribute('data-state') || '').trim();
        if (current.split(/\s+/).indexOf(token) === -1) {
            el.setAttribute('data-state', (current + ' ' + token).trim());
        }
    }

    function removeStateToken(el, token) {
        var current = (el.getAttribute('data-state') || '').trim();
        var parts = current.split(/\s+/).filter(function (t) { return t !== token; });
        if (parts.length) {
            el.setAttribute('data-state', parts.join(' '));
        } else {
            el.removeAttribute('data-state');
        }
    }
})();
