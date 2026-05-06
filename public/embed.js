/**
 * OptiAISEO Embed Widget — public/embed.js
 *
 * USAGE (single script tag, no other dependencies):
 *   <script src="https://optiaiseo.com/embed.js" data-key="AGENCY_KEY"></script>
 *
 * SECURITY: API_BASE is hardcoded — the data-api attribute is intentionally
 * NOT supported. Allowing sites to override the endpoint would let any
 * embedding page redirect lead submissions (emails + audit data) to an
 * attacker-controlled server by adding data-api="https://evil.example.com".
 * Features:
 * - Floating "Free SEO Score" button (bottom-right)
 * - Slide-in panel from right, 360px wide, uses Shadow DOM (no CSS conflicts)
 * - Email capture before showing score
 * - Posts to /api/embed-audit with { url, embedKey, leadEmail }
 * - Shows score + top 3 issues inline
 * - Lead webhook fired server-side via Inngest
 * - Zero external dependencies, vanilla JS only
 * - Target: <8KB raw (minify in production build)
 */
(function () {
  "use strict";

  // ── Config ──────────────────────────────────────────────────────────────────
  var script = document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      return s[s.length - 1];
    })();

  var AGENCY_KEY = script.getAttribute("data-key") || "";
  var API_BASE = "https://optiaiseo.com";

  if (!AGENCY_KEY) {
    console.warn("[OptiAISEO] Missing data-key attribute on embed script.");
    return;
  }

  // ── Shadow DOM host element ─────────────────────────────────────────────────
  var host = document.createElement("div");
  host.id = "__oaiseo-widget-host__";
  host.style.cssText =
    "position:fixed;bottom:0;right:0;z-index:2147483647;pointer-events:none;";
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: "open" });

  // ── Styles (scoped to Shadow DOM) ───────────────────────────────────────────
  var style = document.createElement("style");
  style.textContent = [
    "*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif}",

    // Floating trigger button
    "#oaiseo-btn{",
    "  position:fixed;bottom:24px;right:24px;",
    "  background:#10b981;color:#000;font-weight:700;font-size:13px;",
    "  padding:12px 20px;border-radius:50px;border:none;cursor:pointer;",
    "  box-shadow:0 4px 24px rgba(16,185,129,.45);",
    "  transition:transform .15s,box-shadow .15s;pointer-events:auto;",
    "  display:flex;align-items:center;gap:8px;white-space:nowrap;",
    "}",
    "#oaiseo-btn:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(16,185,129,.55)}",
    "#oaiseo-btn svg{width:15px;height:15px}",

    // Slide panel
    "#oaiseo-panel{",
    "  position:fixed;top:0;right:0;height:100%;width:360px;max-width:100vw;",
    "  background:#0f172a;color:#e2e8f0;",
    "  box-shadow:-4px 0 32px rgba(0,0,0,.5);",
    "  transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);",
    "  display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;",
    "  border-left:1px solid rgba(255,255,255,.06);",
    "}",
    "#oaiseo-panel.open{transform:translateX(0)}",

    // Panel header
    "#oaiseo-header{",
    "  padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.06);",
    "  display:flex;align-items:center;justify-content:space-between;gap:12px;",
    "  background:#0f172a;",
    "}",
    "#oaiseo-logo{height:28px;max-width:120px;object-fit:contain}",
    "#oaiseo-headline{font-size:14px;font-weight:700;color:#fff;line-height:1.3;flex:1}",
    "#oaiseo-close{",
    "  background:none;border:none;cursor:pointer;color:#64748b;font-size:20px;",
    "  line-height:1;padding:4px;border-radius:6px;transition:color .15s;",
    "}",
    "#oaiseo-close:hover{color:#e2e8f0}",

    // Panel body
    "#oaiseo-body{flex:1;overflow-y:auto;padding:20px}",

    // Input
    "#oaiseo-url-input{",
    "  width:100%;padding:11px 14px;border-radius:10px;",
    "  background:#1e293b;border:1px solid #334155;color:#e2e8f0;",
    "  font-size:14px;outline:none;transition:border-color .15s;",
    "}",
    "#oaiseo-url-input:focus{border-color:#10b981}",
    "#oaiseo-url-input::placeholder{color:#475569}",

    // Email input
    "#oaiseo-email-input{",
    "  width:100%;padding:11px 14px;border-radius:10px;margin-top:10px;",
    "  background:#1e293b;border:1px solid #334155;color:#e2e8f0;",
    "  font-size:14px;outline:none;transition:border-color .15s;",
    "}",
    "#oaiseo-email-input:focus{border-color:#10b981}",
    "#oaiseo-email-input::placeholder{color:#475569}",

    // Submit button
    "#oaiseo-submit{",
    "  width:100%;margin-top:12px;padding:12px;",
    "  background:#10b981;color:#000;font-weight:700;font-size:14px;",
    "  border:none;border-radius:10px;cursor:pointer;",
    "  transition:background .15s,opacity .15s;",
    "}",
    "#oaiseo-submit:hover{background:#059669}",
    "#oaiseo-submit:disabled{opacity:.5;cursor:not-allowed}",

    // Error
    "#oaiseo-error{color:#f87171;font-size:12px;margin-top:8px;display:none}",

    // Score card
    "#oaiseo-score-card{",
    "  margin-top:20px;padding:16px;background:#1e293b;",
    "  border-radius:12px;border:1px solid rgba(255,255,255,.06);",
    "  display:none;",
    "}",
    "#oaiseo-score-num{",
    "  font-size:48px;font-weight:900;line-height:1;",
    "}",
    "#oaiseo-issues{margin-top:14px;display:flex;flex-direction:column;gap:8px}",
    ".oaiseo-issue{",
    "  padding:10px 12px;background:#0f172a;border-radius:8px;",
    "  border:1px solid rgba(255,255,255,.05);font-size:12px;",
    "  border-left:3px solid #ef4444;",
    "}",
    ".oaiseo-issue-label{font-weight:600;color:#e2e8f0;margin-bottom:3px}",
    ".oaiseo-issue-rec{color:#94a3b8;line-height:1.4}",

    // CTA
    "#oaiseo-cta{",
    "  display:block;margin-top:14px;text-align:center;padding:11px;",
    "  background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);",
    "  color:#10b981;border-radius:10px;font-size:12px;font-weight:700;",
    "  text-decoration:none;transition:background .15s;",
    "}",
    "#oaiseo-cta:hover{background:rgba(16,185,129,.2)}",

    // Loading
    "#oaiseo-spinner{",
    "  display:none;text-align:center;padding:24px;",
    "}",
    ".oaiseo-spin{",
    "  width:32px;height:32px;border:3px solid rgba(16,185,129,.2);",
    "  border-top-color:#10b981;border-radius:50%;",
    "  animation:oaiseo-spin 0.8s linear infinite;margin:0 auto 8px;",
    "}",
    "@keyframes oaiseo-spin{to{transform:rotate(360deg)}}",

    // Branding footer
    "#oaiseo-powered{",
    "  padding:10px 20px;text-align:center;font-size:10px;color:#475569;",
    "  border-top:1px solid rgba(255,255,255,.04);",
    "}",
    "#oaiseo-powered a{color:#10b981;text-decoration:none}",
  ].join("\n");

  shadow.appendChild(style);

  // ── Build HTML ──────────────────────────────────────────────────────────────
  // We fetch agency config on first open to populate headline/logo
  var config = { headline: "What's your SEO score?", buttonLabel: "Free SEO Score", logoUrl: "" };
  var configLoaded = false;

  async function loadConfig() {
    if (configLoaded) return;
    configLoaded = true;
    try {
      var r = await fetch(API_BASE + "/api/embed-config?key=" + AGENCY_KEY,
        { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        var d = await r.json();
        if (d.headline) config.headline = d.headline;
        if (d.buttonLabel) config.buttonLabel = d.buttonLabel;
        if (d.logoUrl) config.logoUrl = d.logoUrl;
        // Update UI
        var hl = shadow.getElementById("oaiseo-headline");
        if (hl) hl.textContent = config.headline;
        var bl = shadow.getElementById("oaiseo-btn-label");
        if (bl) bl.textContent = config.buttonLabel;
        var logo = shadow.getElementById("oaiseo-logo");
        if (logo && config.logoUrl) {
          logo.setAttribute("src", config.logoUrl);
          logo.style.display = "block";
        }
      }
    } catch { /* non-fatal */ }
  }

  // Button
  var btn = document.createElement("button");
  btn.id = "oaiseo-btn";
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
    '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>' +
    '<span id="oaiseo-btn-label">Free SEO Score</span>';
  shadow.appendChild(btn);

  // Panel
  var panel = document.createElement("div");
  panel.id = "oaiseo-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "SEO Score Widget");

  panel.innerHTML =
    '<div id="oaiseo-header">' +
    '  <img id="oaiseo-logo" src="" alt="logo" style="display:none">' +
    '  <span id="oaiseo-headline">What&#x27;s your SEO score?</span>' +
    '  <button id="oaiseo-close" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div id="oaiseo-body">' +
    '  <p style="font-size:12px;color:#64748b;margin-bottom:12px">' +
    '    Enter your website URL to get a free SEO score and top issues in seconds.' +
    '  </p>' +
    '  <input id="oaiseo-url-input" type="url" placeholder="https://yourwebsite.com" autocomplete="url">' +
    '  <input id="oaiseo-email-input" type="email" placeholder="your@email.com (to receive report)">' +
    '  <p id="oaiseo-error"></p>' +
    '  <button id="oaiseo-submit">Analyse My Site</button>' +
    '  <div id="oaiseo-spinner">' +
    '    <div class="oaiseo-spin"></div>' +
    '    <p style="font-size:12px;color:#64748b">Running audit…</p>' +
    '  </div>' +
    '  <div id="oaiseo-score-card">' +
    '    <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:6px">SEO Score</p>' +
    '    <p id="oaiseo-score-num">—</p>' +
    '    <div id="oaiseo-issues"></div>' +
    '    <a id="oaiseo-cta" href="#" target="_blank" rel="noopener">Get your full report free →</a>' +
    '  </div>' +
    '</div>' +
    '<div id="oaiseo-powered">Powered by <a href="https://optiaiseo.com" target="_blank" rel="noopener">OptiAISEO</a></div>';

  shadow.appendChild(panel);

  // ── State ───────────────────────────────────────────────────────────────────
  var isOpen = false;

  function openPanel() {
    isOpen = true;
    panel.classList.add("open");
    btn.style.display = "none";
    shadow.getElementById("oaiseo-url-input").focus();
    loadConfig();
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove("open");
    btn.style.display = "";
  }

  btn.addEventListener("click", openPanel);
  shadow.getElementById("oaiseo-close").addEventListener("click", closePanel);

  // Close on Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) closePanel();
  });

  // ── Submit ──────────────────────────────────────────────────────────────────
  shadow.getElementById("oaiseo-submit").addEventListener("click", async function () {
    var urlInput = shadow.getElementById("oaiseo-url-input");
    var emailInput = shadow.getElementById("oaiseo-email-input");
    var errorEl = shadow.getElementById("oaiseo-error");
    var submitBtn = shadow.getElementById("oaiseo-submit");
    var spinner = shadow.getElementById("oaiseo-spinner");
    var scoreCard = shadow.getElementById("oaiseo-score-card");

    var rawUrl = urlInput.value.trim();
    var email = emailInput.value.trim();

    // Validate
    errorEl.style.display = "none";
    if (!rawUrl) { showError("Please enter a website URL."); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("Please enter a valid email address."); return;
    }

    var targetUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : "https://" + rawUrl;

    submitBtn.disabled = true;
    spinner.style.display = "block";
    scoreCard.style.display = "none";

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.style.display = "block";
      submitBtn.disabled = false;
      spinner.style.display = "none";
    }

    try {
      var res = await fetch(API_BASE + "/api/embed-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ url: targetUrl, leadEmail: email, embedKey: AGENCY_KEY }),
      });

      var data = await res.json();
      spinner.style.display = "none";
      submitBtn.disabled = false;

      if (!res.ok) { showError(data.error || "Audit failed. Please try again."); return; }

      // Show score
      var scoreNum = shadow.getElementById("oaiseo-score-num");
      var score = data.score || 0;
      scoreNum.textContent = score + "/100";
      scoreNum.style.color = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";

      // Show top 3 issues
      var issuesEl = shadow.getElementById("oaiseo-issues");
      issuesEl.innerHTML = "";
      var issues = (data.topIssues || []).slice(0, 3);
      issues.forEach(function (issue) {
        var div = document.createElement("div");
        div.className = "oaiseo-issue";
        div.innerHTML =
          '<div class="oaiseo-issue-label">' + esc(issue.label || issue.title || "Issue") + '</div>' +
          '<div class="oaiseo-issue-rec">' + esc(issue.recommendation || issue.description || "") + '</div>';
        issuesEl.appendChild(div);
      });

      // CTA link
      var cta = shadow.getElementById("oaiseo-cta");
      if (data.reportUrl) {
        cta.setAttribute("href", data.reportUrl);
      } else {
        cta.setAttribute("href", API_BASE + "/free/seo-checker");
      }

      scoreCard.style.display = "block";
    } catch (err) {
      showError("Connection error — please try again.");
      spinner.style.display = "none";
      submitBtn.disabled = false;
    }
  });

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
