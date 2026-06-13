# Installing the Nut Analytics tracker

There are three ways to install, in order of how locked-down the target site is.
Pick the first one that matches your situation.

Your analytics host (the dashboard URL) is referred to below as `NUT_HOST`, e.g.
`https://nut-analytics.up.railway.app`. Your per-site id (`SITE_ID`) is shown on the
site's **Settings** page.

---

## Path A — Standard (most sites): just paste the snippet

If the target site has **no Content Security Policy** (the common case), paste this in
the `<head>`:

```html
<script defer src="https://NUT_HOST/js/script.js" data-site="SITE_ID"></script>
```

That's it. Pageviews, engaged time, sources/UTM, devices, outbound clicks, file
downloads, goals and SPA route changes are tracked automatically.

**Subdomains as one property:** put the same snippet (same `SITE_ID`) on every
subdomain and add `data-domain` so the visitor cookie is shared:

```html
<script defer src="https://NUT_HOST/js/script.js" data-site="SITE_ID" data-domain=".example.com"></script>
```

---

## Path B — Site has a Content Security Policy: allowlist the host once

A CSP is a browser-enforced allowlist set by **your site's** headers. If it's present
and doesn't list the analytics host, the browser silently blocks the script from
loading *and* from sending data — **this affects every analytics vendor equally**
(DataFast, Plausible, Umami all require the same step).

How to know: open DevTools → Console on the page. If you see
`Loading the script '…/script.js' violates the following Content Security Policy
directive: "script-src …"`, you have a CSP.

Fix: add `https://NUT_HOST` to **both** `script-src` and `connect-src`, then redeploy
the site. Example (Next.js `next.config.mjs`):

```js
"script-src  'self' ... https://NUT_HOST",
"connect-src 'self' ... https://NUT_HOST",
```

Then use the Path A snippet. This is a one-time, one-line change.

---

## Path C — First-party proxy (zero CSP edits + ad-blocker proof) — recommended for SaaS/customers

Serve the tracker and the ingest endpoint **through the customer's own domain**. The
browser then sees same-origin requests, which `'self'` already allows — so **no CSP
edit is ever needed**, and ad-blockers can't recognise a third-party analytics domain
to block. This is the gold standard (how Plausible/Fathom "proxy" modes work).

You expose two paths on the customer domain and forward them to `NUT_HOST`:

| Customer path        | Forwards to                       |
| -------------------- | --------------------------------- |
| `/_nut/script.js`    | `https://NUT_HOST/js/script.js`   |
| `/_nut/track`        | `https://NUT_HOST/api/track`      |

Then the snippet is fully first-party (note `data-api`):

```html
<script defer src="/_nut/script.js" data-site="SITE_ID" data-api="/_nut/track"></script>
```

### Rewrites by platform

**Next.js** — `next.config.js` / `next.config.mjs`:

```js
async rewrites() {
  return [
    { source: "/_nut/script.js", destination: "https://NUT_HOST/js/script.js" },
    { source: "/_nut/track",     destination: "https://NUT_HOST/api/track" },
  ];
}
```

**Vercel** — `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/_nut/script.js", "destination": "https://NUT_HOST/js/script.js" },
    { "source": "/_nut/track",     "destination": "https://NUT_HOST/api/track" }
  ]
}
```

**Cloudflare Worker** (route the worker on `example.com/_nut/*`):

```js
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const map = {
      "/_nut/script.js": "https://NUT_HOST/js/script.js",
      "/_nut/track":     "https://NUT_HOST/api/track",
    };
    const dest = map[url.pathname];
    if (!dest) return new Response("Not found", { status: 404 });
    return fetch(dest, { method: req.method, headers: req.headers, body: req.body });
  },
};
```

**nginx:**

```nginx
location = /_nut/script.js { proxy_pass https://NUT_HOST/js/script.js; }
location = /_nut/track     { proxy_pass https://NUT_HOST/api/track; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
```

**Caddy:**

```
handle /_nut/script.js { rewrite * /js/script.js; reverse_proxy https://NUT_HOST }
handle /_nut/track     { rewrite * /api/track;    reverse_proxy https://NUT_HOST }
```

> Geo accuracy note: keep the original visitor IP in `X-Forwarded-For` through your
> proxy (the nginx example does this). Nut reads the first `X-Forwarded-For` entry.

---

## Verifying any install

On the tracked page, open DevTools → Console and run:

```js
fetch((document.querySelector('script[data-site]')?.getAttribute('data-api')) || 'https://NUT_HOST/api/track', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ site: 'SITE_ID', type: 'pageview', url: location.href, vid: 'verify', sid: 'verify', w: innerWidth, h: innerHeight, n: 1 })
}).then(r => r.text()).then(t => console.log('NUT:', t));
```

`NUT: {"ok":true}` means events are flowing. If you instead see a CSP error, you're on
a CSP site → use Path B or Path C. The event also appears on your dashboard under the
site (period **Today**).
