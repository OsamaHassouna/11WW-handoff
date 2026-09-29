# 11th World Water Forum: front end

Static front end for the 11th World Water Forum (Riyadh, 21–25 March 2027),
built on the Saudi **NDS** design system. It's plain HTML, CSS and vanilla JS:
no build step, no package manager and nothing to install.

It covers UI and layout only. Routing, form submission, search results,
consent handling and any other data or back-end wiring belong to the CMS
implementation.

---

## Pages

The site has 32 pages, each in English (LTR) and Arabic (RTL). The Arabic file
is the English name with `-ar` added: `index.html` / `index-ar.html`,
`pages/organizers.html` / `pages/organizers-ar.html`. The markup is the same in
both languages (same ids, classes and fragment targets); only the text and
`dir`/`lang` change.

| Page | File |
|---|---|
| Home | `index.html` |
| About the Forum | `pages/about-forum.html` |
| Forum Processes | `pages/forum-processes.html` |
| Political Process | `pages/political-process.html` |
| Regional Process | `pages/regional-process.html` |
| Thematic Process | `pages/thematic-process.html` |
| Draft Concept Notes: Regional | `pages/draft-concept-notes.html` |
| Draft Concept Notes: Thematic | `pages/draft-concept-notes-thematic.html` |
| Youth Engagement Program | `pages/youth-program.html` |
| Intersectoral Collaboration Program | `pages/intersectoral-program.html` |
| Participation Opportunities | `pages/participation-opportunities.html` |
| Official Side Event Submission | `pages/side-event-submission.html` |
| Country Pavilion Expression of Interest | `pages/country-pavilion-eoi.html` |
| Sponsorship Expression of Interest | `pages/sponsorship-eoi.html` |
| 1st Stakeholder Consultation Meeting | `pages/first-stakeholder-consultation-meeting.html` |
| 2nd Stakeholders Consultation Meeting | `pages/2nd-stakeholders-consultation-meeting.html` |
| Official Agenda | `pages/official-agenda.html` |
| Discover Riyadh | `pages/discover.html` |
| Visitor Guide | `pages/visitor-guide.html` |
| Visa Information | `pages/visa-information.html` |
| Organizers | `pages/organizers.html` |
| Media Center | `pages/media-center.html` |
| Communication Toolkit | `pages/communication-toolkit.html` |
| Resources | `pages/resources.html` |
| Knowledge Hub | `pages/knowledge-hub.html` |
| Registration | `pages/registration.html` |
| Registration Successful | `pages/registration-successful.html` |
| Exhibitor & Partner Inquiry | `pages/inquiry.html` |
| Inquiry Submitted | `pages/inquiry-successful.html` |
| Search | `pages/search.html` |
| Privacy Policy | `pages/privacy-policy.html` |
| Terms of Use | `pages/terms-of-use.html` |

---

## Running it

Serve the repository root with any static file server:

```bash
python -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000/`.

> **Opening a page straight from disk won't work.** The shared chrome is
> fetched with `fetch()`, which needs `http://` or `https://`. From a `file://`
> URL the header, hero and footer will be missing.

---

## Folder layout

```
index.html, index-ar.html   home page
pages/                      every other page, EN + AR

partials/                   shared chrome, English
partials-ar/                shared chrome, Arabic
  topbar.html                 government digital stamp bar
  mainnav.html                primary navigation
  hero-main.html              home hero, countdown, primary CTA
  footer.html                 footer
  cookie-popup.html           cookie consent bar
  accessibility-panel.html    (English folder only, see below)

js/site.js                  shell loader + page behaviour
theme/
  theme-layered.css           the only stylesheet the pages link
  tokens.css                  design tokens
  media/                      project images, video and favicons
assets/                     NDS vendor bundle, do not edit
```

### `assets/` is vendor code

Everything under `assets/` comes from the NDS distribution and isn't modified.
It has been trimmed to the files this site actually loads. Treat it as a
dependency: on a version bump, replace it wholesale instead of patching it.
All project styling lives in `theme/`.

---

## How the shared chrome loads

The pages don't contain the header, hero or footer. They contain empty mount
points:

```html
<div id="shell-topbar"></div>
<div id="shell-mainnav"></div>
<div id="shell-hero-main"></div>   <!-- home page only -->
<div id="shell-footer"></div>
<div id="shell-cookie"></div>
<div id="shell-a11y"></div>
```

`js/site.js` fetches the matching file from `partials/`, injects it, then runs
the NDS component sweep again. The second sweep is needed because the NDS
bundle scans the DOM once on `DOMContentLoaded`, and it can't see anything
injected after that point.

**Language is automatic.** `site.js` reads `<html lang>` and loads
`partials-ar/` when it starts with `ar`, and `partials/` otherwise. The language
switch in the nav is retargeted at runtime to the same page in the other
language.

The accessibility panel is the one exception: both languages load it from
`partials/`, because it translates itself from `<html lang>` using
`assets/i18n/accessibility/{lang}.json`.

### Moving this into the CMS

Render the partials into the template server-side and delete the loader block
at the top of `site.js`. That removes the fetch waterfall and the second sweep.
Keep the page behaviour further down: language links, search, countdown, hero
video, modals, gallery viewer, and the sticky, mobile and overflow nav.

Keep the nav collapse id as `shellNavCollapse`. The NDS bundle looks for
`ndsNavCollapse`, and if it finds one in a server-rendered nav, its own nav module
binds on top of `site.js`, so every nav control fires twice.

---

## Placeholder links

A few destinations don't exist yet and are marked `href="#"`:

- the news items, "view all" and the Global Water Dialogue actions on the home page
- the three social icons in "Stay Connected" on the home page
- the Forum Framework link and the five social icons in the footer
- the Terms and Privacy links in the cookie bar
- the digital stamp's registration link in the topbar

Point them at real routes during the CMS build.

---

## CSS architecture

`theme/theme-layered.css` is the only stylesheet the pages link. It owns the
vendor imports, the tokens and the project styles, and puts all of them in
cascade layers:

```css
@layer vendors, reset, base, layout, components, theme, utilities;
```

Vendor NDS sits in the lowest layer, so any project rule beats it without
specificity tricks or `!important`. The file header explains the trade-off,
plus one rule you mustn't break: **don't load any NDS stylesheet with a plain
`<link>`**. If you do, it's unlayered and starts winning against the theme.

Project classes are prefixed `wwf-`, and styles are grouped in labelled
per-page sections. Project colours and sizes are `--wwf-*` tokens in
`theme/tokens.css`. The layout uses CSS logical properties throughout, which is
why one stylesheet serves both LTR and RTL.

---

## The countdown

The countdown is driven by a data attribute in the hero partial, so changing it
needs no JavaScript edit:

```html
<div class="wwf-countdown" data-countdown-target="2027-03-21T00:00:00+03:00" …>
```

Keep the explicit timezone offset. The spoken label comes from
`data-countdown-label` and is written per language. If the date can't be
parsed, the element gets `data-countdown-state="invalid"` and is left alone.

---

## Browser support

Current Chrome, Edge, Firefox and Safari.
