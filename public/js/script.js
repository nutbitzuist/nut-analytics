/*!
 * Nut Analytics tracker
 * Usage:
 *   <script defer src="https://YOUR-ANALYTICS-HOST/js/script.js" data-site="SITE_ID"></script>
 * Custom goals:
 *   window.nut('signup', { plan: 'pro' })
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName("script");
    script = all[all.length - 1];
  }
  var SITE = script.getAttribute("data-site");
  var API = script.getAttribute("data-api") || new URL(script.src).origin + "/api/track";
  if (!SITE) return;
  // Skip headless browsers / automation (Selenium, Puppeteer, etc.)
  if (navigator.webdriver) return;

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
      name + "=" + encodeURIComponent(value) + "; path=/; max-age=" + maxAgeSec + "; SameSite=Lax";
  }

  var VID = getCookie("nut_vid");
  if (!VID) {
    VID = uuid();
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
    payload.url = location.href;
    payload.vid = VID;
    payload.sid = sessionId();
    payload.w = window.innerWidth;
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API, new Blob([body], { type: "application/json" }));
    } else {
      fetch(API, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "application/json" } });
    }
  }

  /* ---------- pageviews (incl. SPA navigation) ---------- */

  var lastPath = null;

  function currentPath() {
    return location.pathname + location.search;
  }

  function pageview() {
    var path = currentPath();
    if (path === lastPath) return;
    lastPath = path;
    send({ type: "pageview", ref: document.referrer || null });
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
