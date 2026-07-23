/* App shell: state, rendering, gauge, logging, OCR. Depends on logic.js (MileageLogic). */
(function () {
  'use strict';
  const L = window.MileageLogic;
  const STORE_KEY = 'mileageTracker.v1';
  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ---------- State ----------
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* corrupted store; start fresh */ }
    return { settings: null, entries: [] };
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }
  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- Views ----------
  const views = ['dashboard', 'log', 'history', 'stats', 'setup'];
  function show(view) {
    views.forEach((v) => { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.view === view)
    );
    if (view === 'dashboard') renderDashboard();
    if (view === 'history') renderHistory();
    if (view === 'stats') renderStats();
    if (view === 'setup') fillSetupForm();
    if (view === 'log') initLogForm();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => show(t.dataset.view))
  );

  // ---------- Formatting ----------
  const fmt = (n, dp = 0) =>
    n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

  // ---------- Gauge ----------
  const GAUGE = { cx: 150, cy: 152, r: 118, sweep: 100 }; // ±100° from vertical

  function polar(angleDeg, radius) {
    const a = ((angleDeg - 90) * Math.PI) / 180; // 0° = up
    return [GAUGE.cx + radius * Math.cos(a), GAUGE.cy + radius * Math.sin(a)];
  }
  function arcPath(fromDeg, toDeg, radius) {
    const [x1, y1] = polar(fromDeg, radius);
    const [x2, y2] = polar(toDeg, radius);
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    const sweepFlag = toDeg > fromDeg ? 1 : 0;
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${radius},${radius} 0 ${large} ${sweepFlag} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  // Pick a clean symmetric range that contains the value.
  function gaugeRange(v) {
    const steps = [100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000, 50000];
    const need = Math.abs(v) * 1.15;
    return steps.find((s) => s >= need) || Math.ceil(need / 50000) * 50000;
  }

  function renderGauge(surplus) {
    const R = gaugeRange(surplus);
    const frac = Math.max(-1, Math.min(1, surplus / R));
    const angle = frac * GAUGE.sweep;
    const good = surplus >= 0;

    $('gauge-track').setAttribute('d', arcPath(-GAUGE.sweep, GAUGE.sweep, GAUGE.r));
    const arc = $('gauge-arc');
    if (Math.abs(angle) < 0.75) {
      arc.setAttribute('d', '');
    } else {
      // sweep from 12 o'clock toward the needle: right = banked, left = over
      arc.setAttribute('d', arcPath(0, angle, GAUGE.r));
    }
    arc.setAttribute('stroke', css(good ? '--good' : '--bad'));

    $('gauge-needle').style.transform = `rotate(${angle}deg)`;

    // ticks + labels: -R, -R/2, 0, +R/2, +R
    const ticks = $('gauge-ticks');
    const labels = $('gauge-labels');
    ticks.innerHTML = '';
    labels.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = -4; i <= 4; i++) {
      const a = (i / 4) * GAUGE.sweep;
      const major = i % 2 === 0;
      const [x1, y1] = polar(a, GAUGE.r - 11);
      const [x2, y2] = polar(a, GAUGE.r - (major ? 22 : 17));
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      if (major) line.setAttribute('class', 'major');
      ticks.appendChild(line);
      if (major) {
        const v = (i / 4) * R;
        const [tx, ty] = polar(a, GAUGE.r - 34);
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', tx); t.setAttribute('y', ty + 3);
        t.textContent = (v > 0 ? '+' : '') + fmt(v);
        labels.appendChild(t);
      }
    }
  }

  // ---------- Dashboard ----------
  function renderDashboard() {
    const s = L.computeStats(state.settings, state.entries, todayStr());
    const hero = $('hero');
    const good = s.surplus >= 0;
    hero.classList.toggle('good', good);
    hero.classList.toggle('bad', !good);
    $('hero-value').textContent = (good ? '+' : '−') + fmt(Math.abs(s.surplus), 1);
    $('hero-label').textContent = good ? 'MILES BANKED' : 'MILES OVER PACE';
    $('hero-sub').textContent =
      `${fmt(s.milesAllotted, 0)} MI ALLOTTED · DAY ${fmt(s.daysElapsed)}/${fmt(s.totalDays)}`;
    renderGauge(s.surplus);

    const pm = Math.min(100, Math.max(0, s.pctMilesUsed));
    const pt = Math.min(100, Math.max(0, s.pctTimeElapsed));
    $('bar-miles').style.width = `calc(${pm}% - 4px)`;
    $('bar-time').style.width = `calc(${pt}% - 4px)`;
    $('tick-time').style.left = pt + '%';
    $('pct-miles').textContent = fmt(s.pctMilesUsed, 1) + '%';
    $('pct-time').textContent = fmt(s.pctTimeElapsed, 1) + '%';

    $('stat-driven').textContent = fmt(s.milesDriven);
    $('stat-days-left').textContent = fmt(s.daysRemaining);
    $('stat-rate').textContent = fmt(s.dailyRate, 1);
    $('stat-pace').textContent = fmt(Math.max(0, s.paceNeeded), 1);

    $('lease-chip').textContent =
      `${fmt(state.settings.annualAllowance)} MI/YR · ${state.settings.termMonths} MO · ENDS ${s.endDate}`;

    renderTrend(s.trend);
  }

  // ---------- Trend ----------
  function renderTrend(trend) {
    const svg = $('trend');
    const empty = $('trend-empty');
    const tip = $('trend-tip');
    tip.hidden = true;
    svg.innerHTML = '';
    if (!trend.length) { empty.hidden = false; return; }
    empty.hidden = true;

    const W = 320, H = 150, PADX = 12, PADT = 14, PADB = 18;
    // Include a point at (start, 0) so a single entry still draws a line.
    const pts = [{ date: state.settings.startDate, surplus: 0, odometer: state.settings.startOdometer }, ...trend];
    const xs = pts.map((p) => L.parseDate(p.date));
    const ys = pts.map((p) => p.surplus);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
    const ySpan = (yMax - yMin) || 1;
    const xSpan = (xMax - xMin) || 1;
    const X = (v) => PADX + ((v - xMin) / xSpan) * (W - 2 * PADX);
    const Y = (v) => PADT + ((yMax - v) / ySpan) * (H - PADT - PADB);

    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    };

    // zero line
    svg.appendChild(el('line', {
      x1: PADX, x2: W - PADX, y1: Y(0), y2: Y(0),
      stroke: css('--border-hi'), 'stroke-width': 1, 'stroke-dasharray': '4 3',
    }));
    svg.appendChild(Object.assign(el('text', {
      x: W - PADX, y: Y(0) - 4, 'text-anchor': 'end',
      fill: css('--faint'), 'font-size': 9, 'font-family': css('--digits'),
    }), { textContent: '0' }));

    // data line
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', {
      d, fill: 'none', stroke: css('--data'), 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));

    // entry dots (status-colored by sign) with big hit targets + tooltip
    trend.forEach((p) => {
      const cx = X(L.parseDate(p.date)), cy = Y(p.surplus);
      svg.appendChild(el('circle', {
        cx: cx.toFixed(1), cy: cy.toFixed(1), r: 4,
        fill: css(p.surplus >= 0 ? '--good' : '--bad'),
        stroke: css('--surface'), 'stroke-width': 2,
      }));
      const hit = el('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: 13, fill: 'transparent' });
      hit.addEventListener('pointerenter', (ev) => showTip(ev, p));
      hit.addEventListener('pointerdown', (ev) => showTip(ev, p));
      hit.addEventListener('pointerleave', () => { tip.hidden = true; });
      svg.appendChild(hit);
    });

    // direct label on the latest point
    const last = trend[trend.length - 1];
    const lx = X(L.parseDate(last.date)), ly = Y(last.surplus);
    svg.appendChild(Object.assign(el('text', {
      x: Math.min(lx, W - 6), y: Math.max(10, ly - 10),
      'text-anchor': 'end', 'font-size': 11, 'font-weight': 700,
      'font-family': css('--digits'),
      fill: css(last.surplus >= 0 ? '--good-text' : '--bad-text'),
    }), { textContent: (last.surplus >= 0 ? '+' : '−') + fmt(Math.abs(last.surplus), 1) }));

    // x-axis endpoints
    const dateLbl = (v, anchor, x) => Object.assign(el('text', {
      x, y: H - 5, 'text-anchor': anchor, 'font-size': 9,
      fill: css('--faint'), 'font-family': css('--digits'),
    }), { textContent: v });
    svg.appendChild(dateLbl(pts[0].date, 'start', PADX));
    if (xMax !== xMin) svg.appendChild(dateLbl(last.date, 'end', W - PADX));

    function showTip(ev, p) {
      const card = svg.closest('.card');
      const rect = card.getBoundingClientRect();
      tip.hidden = false;
      tip.innerHTML = `${p.date}<br>${fmt(p.odometer)} mi · <b>${(p.surplus >= 0 ? '+' : '−')}${fmt(Math.abs(p.surplus), 1)}</b>`;
      const x = Math.min(Math.max(ev.clientX - rect.left, 8), rect.width - 130);
      tip.style.left = x + 'px';
      tip.style.top = (ev.clientY - rect.top - 54) + 'px';
    }
  }

  // ---------- Stats ----------
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function prettyDate(iso) {
    const d = new Date(L.parseDate(iso));
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ’${String(d.getUTCFullYear()).slice(2)}`;
  }
  const signed = (v, dp = 1) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), dp);
  const signCls = (v) => (v >= 0 ? 'good' : 'bad');

  function statRow(label, value, cls = '') {
    return `<div class="srow"><span>${label}</span><span class="digits-sm ${cls}">${value}</span></div>`;
  }

  function renderStats() {
    const s = L.computeStats(state.settings, state.entries, todayStr());
    const years = L.computeYearStats(state.settings, state.entries, todayStr());
    const cur = years.find((y) => y.status === 'current');

    // --- This year (featured) ---
    const heroEl = $('year-hero');
    if (!cur) {
      heroEl.innerHTML = `<p class="muted">The lease isn’t in an active year right now.</p>`;
    } else {
      const proj = cur.projectedDriven;
      const projDelta = cur.allowance - proj; // + = under budget at year end
      heroEl.className = 'card year-hero ' + signCls(cur.surplus);
      heroEl.innerHTML = `
        <div class="yh-head">
          <span class="yh-title">YEAR ${cur.index} OF ${years.length}</span>
          <span class="yh-dates">${prettyDate(cur.startDate)} – ${prettyDate(cur.endDate)}</span>
        </div>
        <div class="yh-main digits ${signCls(cur.surplus)}">${signed(cur.surplus)}</div>
        <div class="yh-sub ${signCls(cur.surplus)}">${cur.surplus >= 0 ? 'MILES BANKED THIS YEAR' : 'MILES OVER PACE THIS YEAR'}</div>
        <div class="srows">
          ${statRow('Driven this year', fmt(cur.driven) + ' mi')}
          ${statRow('Allotted so far', fmt(cur.allottedToDate) + ' mi')}
          ${statRow('Your actual pace', fmt(cur.avgPace, 1) + ' mi/day')}
          ${statRow('Pace to stay on budget', fmt(Math.max(0, cur.paceNeeded), 1) + ' mi/day')}
          ${statRow('Days left this year', fmt(cur.daysLeft))}
          ${statRow('Allowance left this year', fmt(cur.allowance - cur.driven) + ' mi')}
          ${statRow('Projected year-end total', fmt(proj) + ' / ' + fmt(cur.allowance) + ' mi', signCls(projDelta))}
          ${statRow('Projected year-end margin', signed(projDelta, 0) + ' mi', signCls(projDelta))}
        </div>`;
    }

    // --- Lease total ---
    $('total-stats').innerHTML = `
      <div class="srows">
        ${statRow('Miles driven', fmt(s.milesDriven) + ' mi')}
        ${statRow('Allotted to date', fmt(s.milesAllotted) + ' mi')}
        ${statRow('Net balance', signed(s.surplus) + ' mi', signCls(s.surplus))}
        ${statRow('Total allowance', fmt(s.totalAllowance) + ' mi')}
        ${statRow('Allowance remaining', fmt(s.remainingAllowance) + ' mi')}
        ${statRow('Allowance used', fmt(s.pctMilesUsed, 1) + '% (vs ' + fmt(s.pctTimeElapsed, 1) + '% of time)')}
        ${statRow('Your actual pace', fmt(s.avgPace, 1) + ' mi/day')}
        ${statRow('Pace to stay on budget', fmt(Math.max(0, s.paceNeeded), 1) + ' mi/day')}
        ${statRow('Projected lease-end total', fmt(s.projectedDriven) + ' / ' + fmt(s.totalAllowance) + ' mi', signCls(s.projectedEndSurplus))}
        ${statRow('Projected lease-end margin', signed(s.projectedEndSurplus, 0) + ' mi', signCls(s.projectedEndSurplus))}
      </div>`;

    // --- All years ---
    $('year-list').innerHTML = years.map((y) => {
      const pct = Math.min(100, y.pctUsed);
      const chip = { current: 'NOW', complete: 'DONE', upcoming: 'AHEAD' }[y.status];
      const balance = y.status === 'upcoming'
        ? '<span class="digits-sm muted">—</span>'
        : `<span class="digits-sm ${signCls(y.surplus)}">${signed(y.surplus)}</span>`;
      return `
        <div class="card year-row ${y.status}">
          <div class="yr-top">
            <span class="yr-name">YEAR ${y.index} <span class="yr-chip ${y.status}">${chip}</span></span>
            <span class="yr-dates">${prettyDate(y.startDate)} – ${prettyDate(y.endDate)}</span>
          </div>
          <div class="yr-mid">
            <span class="digits-sm">${fmt(y.driven)} / ${fmt(y.allowance)} mi</span>
            ${balance}
          </div>
          <div class="yr-bar"><div class="yr-fill ${signCls(y.surplus)}" style="width:${pct}%"></div><div class="yr-timetick" style="left:${Math.min(100, y.pctTime)}%"></div></div>
        </div>`;
    }).join('');
  }

  // ---------- Setup / settings ----------
  function fillSetupForm() {
    const has = !!state.settings;
    $('setup-title').textContent = has ? 'Settings' : 'Set up your lease';
    $('setup-cancel').hidden = !has;
    $('data-tools').hidden = !has;
    if (has) {
      $('set-start-date').value = state.settings.startDate;
      $('set-start-odo').value = state.settings.startOdometer;
      $('set-allowance').value = state.settings.annualAllowance;
      $('set-term').value = state.settings.termMonths;
    } else if (!$('set-start-date').value) {
      $('set-start-date').value = todayStr();
    }
  }

  $('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings = {
      startDate: $('set-start-date').value,
      startOdometer: Number($('set-start-odo').value),
      annualAllowance: Number($('set-allowance').value),
      termMonths: Number($('set-term').value),
    };
    save();
    show('dashboard');
  });
  $('setup-cancel').addEventListener('click', () => show('dashboard'));

  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mileage-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((txt) => {
      const data = JSON.parse(txt);
      if (!data || !data.settings || !Array.isArray(data.entries)) throw new Error('bad file');
      state = data;
      save();
      show('dashboard');
    }).catch(() => alert('That file doesn’t look like a valid backup.'));
    e.target.value = '';
  });
  $('btn-reset').addEventListener('click', () => {
    if (confirm('Erase ALL settings and readings? This cannot be undone.')) {
      localStorage.removeItem(STORE_KEY);
      state = { settings: null, entries: [] };
      show('setup');
      fillSetupForm();
    }
  });

  // ---------- Log form ----------
  function initLogForm() {
    if (!$('log-date').value) $('log-date').value = todayStr();
    checkLogWarning();
  }
  function lastReading() {
    if (!state.entries.length) return null;
    return [...state.entries].sort((a, b) =>
      L.parseDate(a.date) - L.parseDate(b.date) || a.odometer - b.odometer
    ).pop();
  }
  function checkLogWarning() {
    const warnEl = $('log-warning');
    const val = Number($('log-odo').value);
    const last = lastReading();
    const floor = last ? last.odometer : state.settings ? state.settings.startOdometer : 0;
    if ($('log-odo').value !== '' && val < floor) {
      warnEl.textContent = `⚠️ That’s lower than your last reading (${fmt(floor)} mi). Double-check before saving.`;
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
    }
  }
  $('log-odo').addEventListener('input', checkLogWarning);

  $('log-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.entries.push({
      id: uid(),
      date: $('log-date').value,
      odometer: Number($('log-odo').value),
    });
    save();
    $('log-odo').value = '';
    $('log-date').value = todayStr();
    resetOcrUI();
    show('dashboard');
  });

  // ---------- History ----------
  function renderHistory() {
    const list = $('history-list');
    list.innerHTML = '';
    const s = L.computeStats(state.settings, state.entries, todayStr());
    $('history-empty').hidden = s.trend.length > 0;
    [...s.trend].reverse().forEach((t) => {
      const li = document.createElement('li');
      const good = t.surplus >= 0;
      li.innerHTML = `
        <div class="h-main">
          <div class="h-odo">${fmt(t.odometer)} mi</div>
          <div class="h-date">${t.date} · +${fmt(s.deltas[t.id])} mi since previous</div>
        </div>
        <div class="h-surplus ${good ? 'good' : 'bad'}">${good ? '+' : '−'}${fmt(Math.abs(t.surplus), 1)}</div>
        <button class="icon-btn" data-edit="${t.id}" aria-label="Edit">✏️</button>
        <button class="icon-btn" data-del="${t.id}" aria-label="Delete">🗑</button>`;
      list.appendChild(li);
    });
  }
  $('history-list').addEventListener('click', (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;
    if (delId) {
      const entry = state.entries.find((x) => x.id === delId);
      if (entry && confirm(`Delete the ${entry.date} reading (${fmt(entry.odometer)} mi)?`)) {
        state.entries = state.entries.filter((x) => x.id !== delId);
        save();
        renderHistory();
      }
    } else if (editId) {
      openEdit(editId);
    }
  });

  let editingId = null;
  function openEdit(id) {
    const entry = state.entries.find((x) => x.id === id);
    if (!entry) return;
    editingId = id;
    $('edit-date').value = entry.date;
    $('edit-odo').value = entry.odometer;
    $('edit-dialog').showModal();
  }
  $('edit-form').addEventListener('submit', () => {
    const entry = state.entries.find((x) => x.id === editingId);
    if (entry) {
      entry.date = $('edit-date').value;
      entry.odometer = Number($('edit-odo').value);
      save();
    }
    renderHistory();
  });
  $('edit-cancel').addEventListener('click', () => $('edit-dialog').close());

  // ---------- OCR (Tesseract.js, fully local) ----------
  let ocrWorkerPromise = null;
  function getOcrWorker() {
    if (!ocrWorkerPromise) {
      // Absolute URLs: the OCR worker runs from a blob URL, so relative paths fail.
      const abs = (p) => new URL(p, location.href).href;
      ocrWorkerPromise = Tesseract.createWorker('eng', 1, {
        workerPath: abs('vendor/worker.min.js'),
        corePath: abs('vendor/'),
        langPath: abs('vendor'),
        gzip: true,
      });
    }
    return ocrWorkerPromise;
  }

  $('btn-scan').addEventListener('click', () => $('scan-file').click());
  $('scan-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) scanImage(f);
    e.target.value = '';
  });
  // Paste a screenshot anywhere on the Log view.
  document.addEventListener('paste', (e) => {
    if ($('view-log').hidden) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) scanImage(item.getAsFile());
  });

  function setOcrStatus(msg) {
    const el = $('ocr-status');
    el.hidden = !msg;
    el.textContent = msg || '';
  }
  function resetOcrUI() {
    setOcrStatus('');
    $('ocr-result').hidden = true;
  }

  async function scanImage(file) {
    resetOcrUI();
    setOcrStatus('Reading image… (first scan takes a few seconds)');
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const worker = await getOcrWorker();

      // Pass 1: the odometer sits at the top of the Toyota app screen —
      // crop the top third and upscale for a cleaner read.
      let result = await recognize(worker, preprocess(img, 0.34));
      // Pass 2: fall back to the full image.
      if (!result || result.confidence !== 'high') {
        const full = await recognize(worker, preprocess(img, 1));
        if (full && (!result || rank(full) > rank(result))) result = full;
      }

      if (result) {
        showOcrResult(result, url);
      } else {
        setOcrStatus('Couldn’t find an odometer number in that image. You can type it in below.');
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(err);
      setOcrStatus('Scan failed (' + (err.message || err) + '). You can type the reading in below.');
      URL.revokeObjectURL(url);
    }
  }
  const rank = (r) => (r ? { high: 3, medium: 2, low: 1 }[r.confidence] : 0);

  function loadImage(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('could not load image'));
      img.src = url;
    });
  }

  // Crop top fraction, upscale to ~1600px wide, grayscale + mild contrast boost.
  function preprocess(img, topFraction) {
    const srcH = Math.max(1, Math.round(img.naturalHeight * topFraction));
    const scale = Math.min(3, Math.max(1, 1600 / img.naturalWidth));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(srcH * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, img.naturalWidth, srcH, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      g = Math.min(255, Math.max(0, (g - 128) * 1.25 + 128)); // contrast
      px[i] = px[i + 1] = px[i + 2] = g;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  async function recognize(worker, canvas) {
    const { data } = await worker.recognize(canvas);
    return L.extractOdometer(data.text);
  }

  function showOcrResult(result, previewUrl) {
    setOcrStatus('');
    const box = $('ocr-result');
    box.hidden = false;
    const badge = $('ocr-badge');
    badge.className = 'badge ' + result.confidence;
    badge.textContent = {
      high: '✓ HIGH CONFIDENCE',
      medium: 'MEDIUM — PLEASE VERIFY',
      low: 'LOW — PLEASE VERIFY',
    }[result.confidence];
    $('ocr-value').textContent = fmt(result.value);
    const prev = $('ocr-preview');
    if (prev.src) URL.revokeObjectURL(prev.src);
    prev.src = previewUrl;
    $('log-odo').value = result.value;
    checkLogWarning();
    $('log-odo').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Load Tesseract lazily so the dashboard never waits on it.
  (function lazyLoadTesseract() {
    const s = document.createElement('script');
    s.src = 'vendor/tesseract.min.js';
    document.head.appendChild(s);
  })();

  // ---------- Service worker (offline PWA when served over https/localhost) ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ---------- Auto-sync (readings pushed by sync/pull_odometer.py) ----------
  // Merges by date: a synced reading is added only if that date isn't logged yet,
  // so manual entries (and manual corrections) always win.
  async function pullSyncedReadings() {
    try {
      const res = await fetch('sync/readings.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const readings = await res.json();
      if (!Array.isArray(readings)) return;
      const byDate = new Map(state.entries.map((e) => [e.date, e]));
      let added = 0;
      for (const r of readings) {
        if (!r || typeof r.date !== 'string' || !Number.isFinite(r.odometer)) continue;
        const existing = byDate.get(r.date);
        if (!existing) {
          state.entries.push({ id: 'sync-' + r.date, date: r.date, odometer: r.odometer });
          added++;
        } else if (existing.id.startsWith('sync-') && existing.odometer !== r.odometer) {
          // A later same-day sync overwrites an earlier one; manual entries win.
          existing.odometer = r.odometer;
          added++;
        }
      }
      if (added) {
        save();
        if (!$('view-dashboard').hidden) renderDashboard();
        if (!$('view-history').hidden) renderHistory();
        if (!$('view-stats').hidden) renderStats();
      }
    } catch (e) { /* offline or not deployed with sync — fine */ }
  }

  // iOS resumes the installed PWA without reloading the page, so re-pull synced
  // readings and re-render (date may have rolled over) whenever we come back.
  function refreshOnResume() {
    if (document.visibilityState !== 'visible' || !state.settings) return;
    pullSyncedReadings();
    const current = views.find((v) => !$('view-' + v).hidden);
    if (current === 'dashboard') renderDashboard();
    if (current === 'history') renderHistory();
    if (current === 'stats') renderStats();
  }
  document.addEventListener('visibilitychange', refreshOnResume);
  window.addEventListener('focus', refreshOnResume);

  // ---------- Boot ----------
  show(state.settings ? 'dashboard' : 'setup');
  if (state.settings) pullSyncedReadings();
})();
