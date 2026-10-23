// ==UserScript==
// @name         Claude model from URL
// @namespace    local.claude-url-model
// @version      1.3.0
// @description  Select Claude models with ?model= and sync manual model choices to the URL.
// @match        https://claude.ai/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Model families and version numbers come from the request and visible UI.
  // No API calls, React internals, prompt edits, or message submission.
  function parseModel(value) {
    const raw = String(value || '').trim().toLowerCase();
    const clean = raw.replace(/^model:\s*/, '').replace(/^claude[\s-]+/, '');
    let m = clean.match(/^([a-z]+)(?:[\s-]+(\d+(?:[.-]\d+)*))?(?:[\s-]+(latest))?$/);
    if (m) {
      let version = m[2] || null;
      let snapshot = null;
      if (version) {
        const parts = version.split(/[.-]/);
        if (/^\d{8}$/.test(parts.at(-1))) snapshot = parts.pop();
        version = parts.join('.');
      }
      return { family: m[1], version, snapshot, raw };
    }
    // Older IDs put the generation first, e.g. claude-3-5-sonnet-20241022.
    m = clean.match(/^(\d+(?:[.-]\d+)*?)[\s-]+([a-z]+)(?:-(\d{8}))?$/);
    return m ? { family: m[2], version: m[1].replace(/-/g, '.'), snapshot: m[3] || null, raw } : null;
  }

  function displayModel(text) {
    const m = String(text).trim().match(/^(?:Model:\s*)?(?:Claude\s+)?([a-z]+)\s+(\d+(?:\.\d+)*)(?=$|\s)/i);
    return m ? { family: m[1].toLowerCase(), version: m[2], snapshot: null } : null;
  }

  function matches(request, candidate, exactId) {
    if (exactId && exactId.toLowerCase() === request.raw) return true;
    // The website's display name cannot prove a dated API snapshot.
    return !request.snapshot && !!candidate && request.family === candidate.family &&
      (!request.version || request.version === candidate.version);
  }

  function choose(request, candidates) {
    const found = candidates.filter(item => matches(request, item.model, item.id));
    if (found.length !== 1) return { error: found.length ? 'More than one model matches. Use an explicit version.' : 'The requested model is not available in the visible model menu.' };
    return { item: found[0] };
  }

  // Allows Node's built-in test runner to test the same matching code.
  if (typeof module === 'object' && module.exports) {
    module.exports = { parseModel, displayModel, matches, choose, start };
    return;
  }
  start(window);

  function start(win) {
    const doc = win.document;
    let lastUrl = null;
    let cancel = () => {};
    let manualChoice = null;
    const sleep = ms => new Promise(resolve => win.setTimeout(resolve, ms));
    const visible = el => !!el && el.isConnected && el.getClientRects().length > 0;
    const text = el => el.getAttribute('aria-label') || el.innerText || el.textContent || '';
    const enabled = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    const modelId = el => el.getAttribute('data-model-id') || el.getAttribute('data-model');
    const buttons = () => [...doc.querySelectorAll('button, [role="button"]')].filter(visible);
    const selector = () => {
      const explicit = buttons().filter(el => /^Model:\s*/i.test(text(el)) && displayModel(text(el)));
      if (explicit.length === 1) return explicit[0];
      const fallback = buttons().filter(el => (el.hasAttribute('aria-haspopup') || /model.*selector|model.*dropdown/i.test(el.getAttribute('data-testid') || '')) && displayModel(text(el)));
      return fallback.length === 1 ? fallback[0] : null;
    };
    const selectedSlug = () => {
      const current = selector();
      if (!current) return null;
      const exactId = modelId(current);
      if (exactId && /^claude-/i.test(exactId)) return exactId.toLowerCase();
      const parsed = displayModel(text(current));
      return parsed ? `claude-${parsed.family}-${parsed.version.replace(/\./g, '-')}` : null;
    };
    const recordManualChoice = event => {
      if (!event.isTrusted || (event.type === 'keydown' && !['Enter', ' '].includes(event.key))) return;
      const option = event.target?.closest?.('[role="menuitem"], [role="menuitemradio"], [role="option"]');
      const model = option && displayModel(text(option));
      if (!model || !enabled(option)) return;
      manualChoice = {
        href: win.location.href, previous: selectedSlug(), deadline: Date.now() + 4000,
        request: parseModel(modelId(option) || `${model.family}-${model.version}`)
      };
    };
    doc.addEventListener('pointerdown', recordManualChoice, true);
    doc.addEventListener('keydown', recordManualChoice, true);
    function ensureStyles() {
      if (doc.getElementById('claude-url-model-styles')) return;
      const style = doc.createElement('style');
      style.id = 'claude-url-model-styles';
      style.textContent = `
        #claude-url-model-notice {
          position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
          display: flex; align-items: center; gap: 10px; box-sizing: border-box;
          max-width: min(420px, calc(100vw - 40px)); padding: 10px 12px 10px 14px;
          border-radius: 12px; font: 13.5px/1.4 var(--font-ui, system-ui, sans-serif);
          color: hsl(var(--text-100, 30 6% 12%));
          background: hsl(var(--bg-100, 44 33% 97%) / .94);
          border: 1px solid hsl(var(--border-300, 36 12% 84%) / .75);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          box-shadow: 0 8px 24px -4px #0002, 0 2px 6px -1px #0001;
        }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) #claude-url-model-notice {
            color: hsl(var(--text-100, 45 14% 92%));
            background: hsl(var(--bg-200, 30 5% 15%) / .94);
            border-color: hsl(var(--border-300, 30 6% 26%) / .8);
          }
        }
        [data-theme="dark"] #claude-url-model-notice, .dark #claude-url-model-notice {
          color: hsl(var(--text-100, 45 14% 92%));
          background: hsl(var(--bg-200, 30 5% 15%) / .94);
          border-color: hsl(var(--border-300, 30 6% 26%) / .8);
        }
        #claude-url-model-notice[data-error="true"] { border-color: #d977578c; }
        #claude-url-model-notice .claude-url-model-icon {
          flex-shrink: 0; color: #d97757; font-size: 16px;
        }
        #claude-url-model-notice .claude-url-model-content { flex: 1; min-width: 0; overflow-wrap: anywhere; }
        #claude-url-model-notice .claude-url-model-badge {
          display: inline-block; padding: 1px 6px; border-radius: 5px;
          font-size: 12.5px; font-weight: 600; background: #d9775721; color: #d97757;
        }
        #claude-url-model-notice button {
          padding: 4px 8px; border-radius: 6px; font: inherit; color: inherit;
          background: transparent; border: 1px solid transparent; cursor: pointer;
        }
        #claude-url-model-notice button:hover { background: #8080801f; border-color: #80808033; }
      `;
      doc.head.appendChild(style);
    }
    function notice(message, error = false, modelBadge = null) {
      ensureStyles();
      doc.getElementById('claude-url-model-notice')?.remove();
      const box = doc.createElement('div');
      box.id = 'claude-url-model-notice';
      box.setAttribute('role', error ? 'alert' : 'status');
      if (error) box.setAttribute('data-error', 'true');
      const icon = doc.createElement('span');
      icon.className = 'claude-url-model-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = error ? '!' : '✓';
      const content = doc.createElement('span');
      content.className = 'claude-url-model-content';
      if (modelBadge) {
        const label = doc.createElement('span');
        label.textContent = 'Selected ';
        const badge = doc.createElement('span');
        badge.className = 'claude-url-model-badge';
        badge.textContent = modelBadge;
        content.append(label, badge);
      } else content.textContent = message;
      const close = doc.createElement('button');
      close.type = 'button';
      close.setAttribute('aria-label', 'Dismiss notification');
      close.textContent = '×';
      close.addEventListener('click', () => box.remove());
      box.append(icon, content, close);
      doc.body.append(box);
      if (!error) win.setTimeout(() => box.remove(), 750);
    }
    async function apply(url) {
      const values = url.searchParams.getAll('model');
      if (values.length === 0 || !/^\/new\/?$/.test(url.pathname)) return;
      if (values.length !== 1) return notice('Use exactly one model parameter.', true);
      const request = parseModel(values[0]);
      if (!request || !request.raw) return notice('Invalid model ID. Example: claude-sonnet-5-5.', true);
      let stopped = false;
      cancel = () => { stopped = true; };
      const stopOnInput = event => { if (event.isTrusted) stopped = true; };
      doc.addEventListener('pointerdown', stopOnInput, true);
      doc.addEventListener('keydown', stopOnInput, true);
      const deadline = Date.now() + 20000;
      const waitFor = async predicate => {
        while (!stopped && win.location.href === url.href && Date.now() < deadline) {
          const result = predicate();
          if (result) return result;
          await sleep(150);
        }
        return null;
      };
      let opened = false;
      let trigger = null;
      try {
        trigger = await waitFor(selector);
        if (stopped || win.location.href !== url.href) return;
        if (!trigger) throw new Error('Could not find the model selector. Sign in, then reload this URL.');
        if (request.version && matches(request, displayModel(text(trigger)), modelId(trigger))) {
          notice('', false, text(trigger).replace(/^Model:\s*/i, '').trim());
          return;
        }
        if (!enabled(trigger)) throw new Error('The model selector is disabled.');
        if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
        opened = true;
        const menuItems = () => [...doc.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible);
        let items = await waitFor(() => { const items = menuItems(); return items.some(el => displayModel(text(el))) && items; });
        if (!items) throw new Error('Could not read the model menu. Claude may have changed its page layout.');
        let candidates = () => menuItems().map(el => ({ el, model: displayModel(text(el)), id: modelId(el) })).filter(item => item.model || item.id);
        let selection = choose(request, candidates());
        // Some versions place older models in a submenu. Open only named model menus.
        if (selection.error) {
          const more = [...menuItems(), ...buttons()].find(el => /^(?:More models|Other models|Legacy models)\s*$/i.test(text(el).trim()) && enabled(el));
          if (more && !stopped && win.location.href === url.href) {
            more.click();
            const found = await waitFor(() => {
              const result = choose(request, candidates());
              return result.item && result;
            });
            selection = found || choose(request, candidates());
          }
        }
        if (stopped || win.location.href !== url.href) return;
        if (selection.error) throw new Error(selection.error + ' Requested: ' + values[0] + '.');
        if (!enabled(selection.item.el)) throw new Error('The requested model is disabled or requires a different plan.');
        selection.item.el.click();
        opened = false;
        const verified = await waitFor(() => {
          const current = selector();
          return current && matches(request, displayModel(text(current)), modelId(current)) && current;
        });
        if (!verified) throw new Error('Could not verify the selected model. Check the model name before sending.');
        if (stopped || win.location.href !== url.href) return;
        const slug = selectedSlug();
        if (slug) {
          const selectedUrl = new URL(win.location.href);
          selectedUrl.searchParams.set('model', slug);
          win.history.replaceState(win.history.state, '', selectedUrl.href);
          lastUrl = win.location.href;
        }
        notice('', false, text(verified).replace(/^Model:\s*/i, '').trim());
      } catch (error) {
        if (!stopped && win.location.href === url.href) {
          if (opened && trigger?.getAttribute('aria-expanded') === 'true') trigger.click();
          notice(error.message + ' No message was sent.', true);
        }
      } finally {
        doc.removeEventListener('pointerdown', stopOnInput, true);
        doc.removeEventListener('keydown', stopOnInput, true);
      }
    }
    const check = () => {
      if (win.location.href !== lastUrl) {
        cancel();
        manualChoice = null;
        lastUrl = win.location.href;
        void apply(new URL(lastUrl));
        return;
      }
      if (!manualChoice) return;
      const url = new URL(win.location.href);
      if (manualChoice.href !== url.href || Date.now() > manualChoice.deadline || !/^\/new\/?$/.test(url.pathname)) {
        manualChoice = null;
        return;
      }
      const slug = selectedSlug();
      const current = selector();
      if (!slug || slug === manualChoice.previous || !manualChoice.request ||
          !matches(manualChoice.request, displayModel(text(current)), modelId(current))) return;
      url.searchParams.set('model', slug);
      win.history.replaceState(win.history.state, '', url.href);
      lastUrl = win.location.href;
      manualChoice = null;
      notice('', false, text(current).replace(/^Model:\s*/i, '').trim());
    };
    check();
    // Also covers Claude's client-side navigation without patching its router.
    let timer = win.setInterval(check, 500);
    win.addEventListener('pagehide', () => { cancel(); win.clearInterval(timer); timer = null; });
    win.addEventListener('pageshow', () => {
      if (timer === null) {
        lastUrl = null;
        check();
        timer = win.setInterval(check, 500);
      }
    });
  }
})();
