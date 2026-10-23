/* Design layer: theme switch, command palette, chart tooltip and linked tracing, number roll-up.
   Purely presentational. It never touches audit state; navigation goes through the app's own nav buttons. */
(function () {
  const root = document.documentElement;
  const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };

  /* theme */
  root.dataset.theme = store.get('sda.theme') === 'dark' ? 'dark' : 'light';
  function toggleTheme() {
    root.classList.add('theme-swap');
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    store.set('sda.theme', root.dataset.theme);
    setTimeout(() => root.classList.remove('theme-swap'), 420);
  }

  /* benchmark tooltip + linked tracing: hovering a dataset highlights it in every row */
  let tip = null;
  function showTip(el) {
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    const parts = (el.dataset.tip || '').split(' · ');
    tip.textContent = '';
    const v = document.createElement('b'); v.textContent = parts[parts.length - 1] || ''; tip.appendChild(v);
    const n = document.createElement('span'); n.textContent = parts.slice(0, -1).join(' · '); tip.appendChild(n);
    const r = el.getBoundingClientRect(); tip.classList.add('on');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.top = (r.top - h - 6 < 8 ? r.bottom + 6 : r.top - h - 6) + 'px';
    const card = el.closest('[data-bench]');
    if (card) { card.classList.add('tracing'); card.querySelectorAll('.bm-pt').forEach(p => p.classList.toggle('hl', p.dataset.ds === el.dataset.ds)); }
  }
  function hideTip(el) {
    if (tip) tip.classList.remove('on');
    const card = el && el.closest('[data-bench]');
    if (card) { card.classList.remove('tracing'); card.querySelectorAll('.bm-pt.hl').forEach(p => p.classList.remove('hl')); }
  }
  ['pointerover', 'focusin'].forEach(ev => document.addEventListener(ev, e => { const t = e.target.closest && e.target.closest('.bm-pt'); if (t) showTip(t); }));
  ['pointerout', 'focusout'].forEach(ev => document.addEventListener(ev, e => { const t = e.target.closest && e.target.closest('.bm-pt'); if (t) hideTip(t); }));

  /* navigation helpers */
  const navButtons = () => Array.from(document.querySelectorAll('.nav-item'));
  function goTo(label) {
    const b = navButtons().find(n => n.textContent.trim() === label);
    if (b) { b.click(); window.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' }); }
  }

  /* command palette */
  let pal = null, items = [], sel = 0, lastFocus = null;
  function collect() {
    const out = [];
    navButtons().forEach(b => {
      const g = b.closest('.nav-g'); const grp = g ? (g.querySelector('.nav-gl') || {}).textContent : '';
      out.push({ label: b.textContent.trim(), hint: 'Go to page' + (grp ? ' · ' + grp : ''), icon: (b.querySelector('use') || { getAttribute: () => '#i-chev' }).getAttribute('href'), run: () => goTo(b.textContent.trim()) });
    });
    document.querySelectorAll('.intro-r button').forEach(b => {
      if (b.disabled) return;
      out.push({ label: b.textContent.trim(), hint: 'Action on this page', icon: (b.querySelector('use') || { getAttribute: () => '#i-bolt' }).getAttribute('href'), run: () => b.click() });
    });
    out.push({ label: root.dataset.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme', hint: 'Appearance', icon: root.dataset.theme === 'light' ? '#i-moon' : '#i-sun', run: toggleTheme });
    return out;
  }
  function render(q) {
    const list = pal.querySelector('.pal-list');
    const needle = q.trim().toLowerCase();
    items = collect().filter(i => !needle || i.label.toLowerCase().includes(needle) || i.hint.toLowerCase().includes(needle));
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
    list.innerHTML = '';
    if (!items.length) { const e = document.createElement('div'); e.className = 'pal-empty'; e.textContent = 'Nothing matches “' + q + '”.'; list.appendChild(e); return; }
    items.forEach((it, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pal-item' + (i === sel ? ' on' : ''); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', i === sel ? 'true' : 'false');
      b.innerHTML = '<svg class="ic"><use href="' + it.icon + '"/></svg><span class="pal-l"></span><span class="pal-h"></span>';
      b.querySelector('.pal-l').textContent = it.label; b.querySelector('.pal-h').textContent = it.hint;
      b.addEventListener('click', () => { close(); it.run(); });
      b.addEventListener('mousemove', () => { if (sel !== i) { sel = i; mark(); } });
      list.appendChild(b);
    });
  }
  function mark() { pal.querySelectorAll('.pal-item').forEach((b, i) => { b.classList.toggle('on', i === sel); b.setAttribute('aria-selected', i === sel ? 'true' : 'false'); if (i === sel) b.scrollIntoView({ block: 'nearest' }); }); }
  function open() {
    if (!pal) {
      pal = document.createElement('div'); pal.className = 'pal-wrap'; pal.setAttribute('role', 'dialog'); pal.setAttribute('aria-label', 'Command palette');
      pal.innerHTML = '<div class="pal-scrim"></div><div class="pal"><div class="pal-in"><svg class="ic"><use href="#i-search"/></svg><input type="text" placeholder="Jump to a page or run an action…" aria-label="Search pages and actions"><kbd>Esc</kbd></div><div class="pal-list" role="listbox"></div><div class="pal-f"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span></div></div>';
      document.body.appendChild(pal);
      pal.querySelector('.pal-scrim').addEventListener('click', close);
      const inp = pal.querySelector('input');
      inp.addEventListener('input', () => { sel = 0; render(inp.value); });
      inp.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
        else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; if (it) { close(); it.run(); } }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
    }
    lastFocus = document.activeElement; sel = 0;
    const inp = pal.querySelector('input'); inp.value = ''; render('');
    pal.classList.add('open'); setTimeout(() => inp.focus(), 10);
  }
  function close() { if (!pal) return; pal.classList.remove('open'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); pal && pal.classList.contains('open') ? close() : open(); }
  });
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-fx],[data-go]');
    if (!t) return;
    if (t.dataset.fx === 'theme') toggleTheme();
    else if (t.dataset.fx === 'palette') open();
    else if (t.dataset.go) goTo(t.dataset.go);
  });

  /* number roll-up for headline figures; always lands on the exact text the app rendered */
  const SEL = '.kpi-v, .bigv';
  const running = new WeakMap(), written = new WeakMap();
  function roll(el) {
    if (reduce()) return;
    const final = el.textContent; const m = /^(-?)(\d[\d,]*)(\.\d+)?(%| pp)?$/.exec(final.trim());
    if (!m) return;
    const target = parseFloat((m[1] + m[2] + (m[3] || '')).replace(/,/g, '')); const dec = m[3] ? m[3].length - 1 : 0; const suf = m[4] || ''; const commas = m[2].includes(',');
    if (!isFinite(target)) return;
    const node = Array.from(el.childNodes).length === 1 && el.firstChild.nodeType === 1 ? el.firstChild : el;
    const prev = running.get(el); if (prev) cancelAnimationFrame(prev.id);
    const t0 = performance.now(), dur = 600;
    const st = { id: 0, final };
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      let s = (target * e).toFixed(dec); if (commas) s = Number(s).toLocaleString('en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      node.textContent = p < 1 ? s + suf : final; written.set(el, el.textContent);
      if (p < 1) st.id = requestAnimationFrame(step); else running.delete(el);
    };
    running.set(el, st); st.id = requestAnimationFrame(step);
  }
  function scan(nodes) {
    const seen = new Set();
    nodes.forEach(n => {
      const el = n.nodeType === 1 ? n : n.parentElement; if (!el) return;
      const hit = el.closest(SEL); if (hit) seen.add(hit);
      if (n.nodeType === 1 && n.querySelectorAll) n.querySelectorAll(SEL).forEach(x => seen.add(x));
    });
    seen.forEach(el => { if (written.get(el) !== el.textContent) roll(el); });
  }
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(muts => {
      const nodes = [];
      muts.forEach(m => { if (m.type === 'characterData') nodes.push(m.target); else m.addedNodes.forEach(a => nodes.push(a)); });
      scan(nodes);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
})();
