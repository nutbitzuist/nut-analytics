/*!
 * Nut Analytics tracker
 * Usage:
 *   <script defer src="https://YOUR-ANALYTICS-HOST/js/script.js" data-site="SITE_ID"></script>
 * Track a root domain + all its subdomains as one visitor (use the SAME data-site
 * and data-domain on every subdomain):
 *   <script defer src=".../js/script.js" data-site="SITE_ID" data-domain=".example.com"></script>
 * Custom goals:
 *   window.nut('signup', { plan: 'pro' })
 *
 * Tracks: pageviews (incl. SPA navigation), engaged time + scroll depth per page,
 * custom & declarative goals, outbound link clicks, file downloads, and decorates
 * Stripe Payment Links for revenue attribution.
 */
(function () {
  "use strict";

  // Robustly find our own <script> tag. document.currentScript is unreliable when
  // the snippet is injected dynamically (e.g. Next.js <Script>, GTM, async loaders),
  // so fall back to matching our own src / a data-site attribute rather than blindly
  // grabbing the last script — otherwise data-site is read as null and we'd bail.
  function resolveScript() {
    var cur = document.currentScript;
    if (cur && cur.getAttribute && cur.getAttribute("data-site")) return cur;
    var all = document.getElementsByTagName("script");
    var i;
    for (i = all.length - 1; i >= 0; i--) {
      if (all[i].getAttribute && all[i].getAttribute("data-site") && /\/js\/script\.js(\?|$|#)/.test(all[i].src || "")) {
        return all[i];
      }
    }
    for (i = all.length - 1; i >= 0; i--) {
      if (all[i].getAttribute && all[i].getAttribute("data-site")) return all[i];
    }
    return cur || all[all.length - 1] || {};
  }

  var script = resolveScript();
  var getAttr = function (n) {
    return script && script.getAttribute ? script.getAttribute(n) : null;
  };
  var SITE = getAttr("data-site");
  var scriptSrc = (script && script.src) || "";
  var API = getAttr("data-api") || (scriptSrc ? new URL(scriptSrc).origin + "/api/track" : "/api/track");
  // Optional: share the visitor cookie across subdomains (e.g. ".example.com").
  var COOKIE_DOMAIN = getAttr("data-domain") || null;
  if (!SITE) {
    try {
      console.warn("[nut] tracking disabled: no data-site found on the script tag. " +
        "If you load this via a dynamic loader, ensure the data-site attribute is set on the <script> element.");
    } catch (e) {}
    return;
  }
  // Skip headless browsers / automation (Selenium, Puppeteer, etc.)
  if (navigator.webdriver) return;
  // Honour opt-out for local/dev and explicit do-not-track preference handling is intentionally
  // left to the server (DNT is unreliable); we only skip obvious bots above.

  /* ---------- visitor & session ids (first-party cookies) ---------- */

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function getCookie(name) {
    var m = document.cookie.match("(^|;\\s*)" + name + "=([^;]*)");
    return m ? decodeURIComponent(m[2]) : null;
  }

  function setCookie(name, value, maxAgeSec) {
    document.cookie =
      name + "=" + encodeURIComponent(value) + "; path=/; max-age=" + maxAgeSec +
      (COOKIE_DOMAIN ? "; domain=" + COOKIE_DOMAIN : "") + "; SameSite=Lax";
  }

  var VID = getCookie("nut_vid");
  var IS_NEW = false;
  if (!VID) {
    VID = uuid();
    IS_NEW = true; // first time we've ever seen this browser
    setCookie("nut_vid", VID, 60 * 60 * 24 * 365); // 1 year
  }

  function sessionId() {
    var sid = getCookie("nut_sid");
    if (!sid) sid = uuid();
    setCookie("nut_sid", sid, 60 * 30); // rolling 30 min window
    return sid;
  }

  /* ---------- transport ---------- */

  function send(payload) {
    payload.site = SITE;
    if (!payload.url) payload.url = location.href;
    payload.vid = VID;
    payload.sid = sessionId();
    payload.w = window.innerWidth;
    payload.h = window.innerHeight;
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API, new Blob([body], { type: "application/json" }));
    } else {
      fetch(API, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "application/json" } });
    }
  }

  /* ---------- engaged time + scroll depth ---------- */
  // We measure *active* time (tab visible) per page, the way DataFast/Plausible do,
  // so "time on page", session duration and bounce rate are real rather than 0.

  var engagedMs = 0; // active ms accrued for the current page since the last flush
  var lastTick = Date.now();
  var isVisible = document.visibilityState !== "hidden";
  var maxScroll = 0; // 0-100
  var pvUrl = null; // url of the page engagement is currently being attributed to

  function recordScroll() {
    var doc = document.documentElement;
    var scrollable = doc.scrollHeight - window.innerHeight;
    var pct = scrollable > 0 ? ((window.scrollY || doc.scrollTop || 0) / scrollable) * 100 : 100;
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    if (pct > maxScroll) maxScroll = pct;
  }

  function accrue() {
    var now = Date.now();
    if (isVisible) engagedMs += now - lastTick;
    lastTick = now;
  }

  function flushEngagement() {
    accrue();
    if (engagedMs < 1000 || !pvUrl) {
      engagedMs = 0;
      return;
    }
    send({ type: "engagement", url: pvUrl, d: Math.round(engagedMs / 1000), sd: maxScroll });
    engagedMs = 0;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      isVisible = false;
      accrue();
      flushEngagement(); // tab hidden: persist what we have (mobile may never fire pagehide)
    } else {
      isVisible = true;
      lastTick = Date.now();
    }
  });
  window.addEventListener("pagehide", flushEngagement);
  window.addEventListener("beforeunload", flushEngagement);
  window.addEventListener("scroll", recordScroll, { passive: true });

  /* ---------- pageviews (incl. SPA navigation) ---------- */

  var lastPath = null;

  function currentPath() {
    return location.pathname + location.search;
  }

  function pageview() {
    var path = currentPath();
    if (path === lastPath) return;
    // Flush engagement for the page we're leaving before switching context.
    flushEngagement();
    lastPath = path;
    pvUrl = location.href;
    maxScroll = 0;
    engagedMs = 0;
    lastTick = Date.now();
    recordScroll();
    send({ type: "pageview", url: pvUrl, ref: document.referrer || null, n: IS_NEW ? 1 : 0 });
    IS_NEW = false; // only the very first pageview of a brand-new visitor counts as "new"
  }

  var push = history.pushState;
  history.pushState = function () {
    push.apply(this, arguments);
    pageview();
  };
  var replace = history.replaceState;
  history.replaceState = function () {
    replace.apply(this, arguments);
    pageview();
  };
  window.addEventListener("popstate", pageview);

  if (document.visibilityState === "prerender") {
    document.addEventListener("visibilitychange", function () {
      if (!lastPath && document.visibilityState === "visible") pageview();
    });
  } else {
    pageview();
  }

  /* ---------- custom goals ---------- */

  window.nut = function (name, meta) {
    if (!name) return;
    send({ type: "goal", name: String(name).slice(0, 64), meta: meta || null });
  };

  // Declarative goals:
  //   <button data-nut-goal="cta_click">    fires on click
  //   <form data-nut-goal="newsletter_signup">  fires on submit
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest("[data-nut-goal]");
    if (el && el.tagName !== "FORM") window.nut(el.getAttribute("data-nut-goal"));
  });
  document.addEventListener(
    "submit",
    function (e) {
      var form = e.target;
      if (form && form.getAttribute && form.getAttribute("data-nut-goal")) {
        window.nut(form.getAttribute("data-nut-goal"));
      }
    },
    true
  );

  /* ---------- outbound links & file downloads ---------- */

  var DOWNLOAD_RE = /\.(pdf|zip|rar|7z|tar|gz|tgz|dmg|exe|pkg|msi|apk|csv|xlsx?|docx?|pptx?|txt|rtf|mp3|wav|ogg|mp4|mov|avi|mkv|webm|epub|pages|key|numbers)(\?|#|$)/i;

  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      var href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#" || /^(mailto:|tel:|javascript:)/i.test(href)) return;
      var u;
      try {
        u = new URL(a.href, location.href);
      } catch (err) {
        return;
      }
      if (DOWNLOAD_RE.test(u.pathname)) {
        send({ type: "download", name: u.pathname.split("/").pop().slice(0, 128), dest: u.href });
      } else if (u.host && u.host !== location.host) {
        send({ type: "outbound", name: u.host.replace(/^www\./, ""), dest: u.href });
      }
    },
    true
  );

  /* ---------- Stripe Payment Link attribution ---------- */
  // Appends the visitor id to buy.stripe.com links as client_reference_id so
  // the payment webhook can attribute revenue to this visitor's channel.
  function decorateStripeLinks(root) {
    var links = (root || document).querySelectorAll('a[href*="buy.stripe.com"]');
    for (var i = 0; i < links.length; i++) {
      try {
        var u = new URL(links[i].href);
        if (!u.searchParams.get("client_reference_id")) {
          u.searchParams.set("client_reference_id", VID);
          links[i].href = u.toString();
        }
      } catch (err) {}
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { decorateStripeLinks(); });
  } else {
    decorateStripeLinks();
  }
  document.addEventListener(
    "mousedown",
    function (e) {
      var a = e.target && e.target.closest && e.target.closest('a[href*="buy.stripe.com"]');
      if (a) decorateStripeLinks(a.parentNode || document);
    },
    true
  );
})();
