/* Trade Tracker popup. Depends on calculator.js globals. */
(function () {
  const $ = (id) => document.getElementById(id);
  // Safe setters — never throw if an id is missing from popup.html
  // (prevents "Cannot set properties of null" killing the storage callback).
  const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  const fmtRs = (n) => '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => Number(n || 0).toFixed(2) + '%';
  const fmtSignedPlain = (n) => (n >= 0 ? '+' : '') + fmtRs(n);

  const state = { side: 'long', exchange: 'NSE', segment: 'intraday', targetMode: 'price', slMode: 'price', settings: null };
  let saveTimer = null, calcTimer = null;

  function setSegUI(id, val) {
    const el = $(id); if (!el) return;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.val.toLowerCase() === String(val).toLowerCase()));
  }

  function segWire(id, key, onChange) {
    const el = $(id);
    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        const raw = b.dataset.val;
        state[key] = (raw === 'NSE' || raw === 'BSE') ? raw.toUpperCase() : raw.toLowerCase();
        if (onChange) onChange();
        persistFormSoon(); liveCalcSoon();
      });
    });
  }

  function applyLeverageRule() {
    // Default: leverage ON for Intraday/MTF, OFF for Delivery
    if (state.segment === 'delivery') $('levOn').checked = false;
    else $('levOn').checked = true;
    persistFormSoon();
  }

  segWire('sideSeg', 'side');
  segWire('exchSeg', 'exchange');
  segWire('segSeg', 'segment', applyLeverageRule);

  function modeWire(btnId, labelId, key) {
    $(btnId).addEventListener('click', () => {
      state[key] = state[key] === 'price' ? 'pct' : 'price';
      const sym = state[key] === 'price' ? '₹' : '%';
      $(btnId).textContent = sym; $(labelId).textContent = sym;
      persistFormSoon(); liveCalcSoon();
    });
  }
  modeWire('targetMode', 'targetModeLabel', 'targetMode');
  modeWire('slMode', 'slModeLabel', 'slMode');

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.tabpage').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      $('tab-' + t.dataset.tab).classList.add('active');
      if (t.dataset.tab === 'history') renderHistory();
    });
  });

  function getSettings() { return state.settings || DEFAULT_SETTINGS; }

  function collectForm() {
    return {
      side: state.side, exchange: state.exchange, segment: state.segment,
      targetMode: state.targetMode, slMode: state.slMode,
      entry: $('entry').value, qty: $('qty').value,
      targetVal: $('targetVal').value, slVal: $('slVal').value,
      levOn: $('levOn').checked, levMult: $('levMult').value,
      autosave: $('autosave').checked
    };
  }

  function restoreForm(f) {
    if (!f) return;
    state.side = f.side || 'long'; state.exchange = f.exchange || 'NSE';
    state.segment = f.segment || 'intraday';
    state.targetMode = f.targetMode || 'price'; state.slMode = f.slMode || 'price';
    setSegUI('sideSeg', state.side); setSegUI('exchSeg', state.exchange); setSegUI('segSeg', state.segment);
    const ts = state.targetMode === 'price' ? '₹' : '%';
    const ss = state.slMode === 'price' ? '₹' : '%';
    $('targetMode').textContent = ts; $('targetModeLabel').textContent = ts;
    $('slMode').textContent = ss; $('slModeLabel').textContent = ss;
    $('entry').value = f.entry ?? ''; $('qty').value = f.qty ?? '';
    $('targetVal').value = f.targetVal ?? ''; $('slVal').value = f.slVal ?? '';
    if (typeof f.levOn === 'boolean') $('levOn').checked = f.levOn;
    else $('levOn').checked = state.segment !== 'delivery';
    $('levMult').value = f.levMult || getSettings().leverageMultiplier || 5;
    $('autosave').checked = f.autosave !== false;
  }

  function persistFormSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ form: collectForm() }), 250);
  }

  ['entry', 'qty', 'targetVal', 'slVal', 'levMult'].forEach((id) => {
    $(id).addEventListener('input', () => { persistFormSoon(); liveCalcSoon(); });
  });
  ['levOn', 'autosave'].forEach((id) => $(id).addEventListener('change', persistFormSoon));

  function liveCalcSoon() {
    clearTimeout(calcTimer);
    calcTimer = setTimeout(() => tryCalculate(false), 400);
  }

  function loadAll() {
    chrome.storage.local.get(['settings', 'form'], (res) => {
      state.settings = Object.assign({}, DEFAULT_SETTINGS, res.settings || {});
      fillSettingsForm();
      if (res.form) restoreForm(res.form);
      else { $('levOn').checked = true; $('levMult').value = state.settings.leverageMultiplier; }
      // live-restore last result if inputs valid
      tryCalculate(false);
    });
  }

  const MAP = [
    ['s_levMult', 'leverageMultiplier'], ['s_intraPct', 'intradayBrokeragePct'],
    ['s_intraFlat', 'intradayBrokerageFlat'], ['s_delPct', 'deliveryBrokeragePct'],
    ['s_delFlat', 'deliveryBrokerageFlat'], ['s_mtfPct', 'mtfBrokeragePct'],
    ['s_mtfFlat', 'mtfBrokerageFlat'], ['s_nseIntra', 'exchNseIntraday'],
    ['s_nseDel', 'exchNseDelivery'], ['s_nseMtf', 'exchNseMtf'],
    ['s_bseIntra', 'exchBseIntraday'], ['s_bseDel', 'exchBseDelivery'],
    ['s_bseMtf', 'exchBseMtf'], ['s_sttIntra', 'sttIntradaySellPct'],
    ['s_sttDel', 'sttDeliveryPct'], ['s_sttMtf', 'sttMtfPct'],
    ['s_stampIntra', 'stampIntradayPct'], ['s_stampDel', 'stampDeliveryPct'],
    ['s_stampMtf', 'stampMtfPct'], ['s_sebi', 'sebiPct'], ['s_ipft', 'ipftPct'],
    ['s_gst', 'gstPct'], ['s_dp', 'dpCharge']
  ];
  function fillSettingsForm() {
    MAP.forEach(([id, k]) => { const el = $(id); if (el) el.value = state.settings[k]; });
    const levDef = $('s_levOn'); if (levDef) levDef.checked = !!state.settings.leverageEnabled;
  }
  $('saveSettings').addEventListener('click', () => {
    const s = Object.assign({}, state.settings);
    MAP.forEach(([id, k]) => { const v = parseFloat($(id).value); if (Number.isFinite(v)) s[k] = v; });
    s.leverageEnabled = $('s_levOn').checked;
    state.settings = s;
    chrome.storage.local.set({ settings: s }, () => { $('settingsMsg').textContent = 'Saved ✓'; setTimeout(() => $('settingsMsg').textContent = '', 1500); });
  });
  $('resetSettings').addEventListener('click', () => {
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
    chrome.storage.local.set({ settings: state.settings }, fillSettingsForm);
  });

  function breakupHtml(r) {
    const rows = [
      ['Brokerage', r.brokerage], ['Exchange txn', r.exchangeCharges],
      ['STT', r.stt], ['SEBI', r.sebi], ['IPFT', r.ipft],
      ['Stamp duty', r.stamp], ['GST', r.gst], ['DP charges', r.dp]
    ];
    return rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${fmtRs(v)}</dd></div>`).join('') +
      `<div class="tot"><dt>Total</dt><dd>${fmtRs(r.totalCharges)}</dd></div>`;
  }

  function hasInputs(entry, qty, tv, sv) {
    return entry > 0 && qty > 0 && (Number.isFinite(tv) || Number.isFinite(sv));
  }

  function tryCalculate(save) {
    const entry = parseFloat($('entry').value);
    const qty = parseInt($('qty').value, 10);
    const tvRaw = $('targetVal').value.trim(), slRaw = $('slVal').value.trim();
    const tv = tvRaw === '' ? NaN : parseFloat(tvRaw);
    const sv = slRaw === '' ? NaN : parseFloat(slRaw);
    if (!hasInputs(entry, qty, tv, sv)) {
      const rEl = $('results'); if (rEl) rEl.classList.add('hidden');
      const eEl = $('emptyState'); if (eEl) eEl.classList.remove('hidden');
      return null;
    }
    const input = {
      entry, qty,
      targetValue: Number.isFinite(tv) ? tv : (state.side === 'short' ? entry : entry),
      targetMode: state.targetMode,
      slValue: Number.isFinite(sv) ? sv : (state.side === 'short' ? entry : entry),
      slMode: state.slMode,
      segment: state.segment, exchange: state.exchange, side: state.side,
      leverageOn: $('levOn').checked, leverageMultiplier: parseFloat($('levMult').value) || 5,
      settings: getSettings()
    };
    // If one leg is blank, hide that column gracefully (still compute with entry=exit => ~ -charges)
    let out;
    try { out = calculateScenario(input); } catch (e) { return null; }
    renderResult(input, out, { showTarget: Number.isFinite(tv), showSL: Number.isFinite(sv) });
    if (save && $('autosave').checked) saveHistory({ input, targetNet: out.target.net, slNet: out.sl.net, ts: Date.now() });
    chrome.storage.local.set({ lastResult: { input, ts: Date.now() } });
    return { input, out };
  }

  function renderResult(input, out, vis) {
    const resultsEl = $('results'); if (resultsEl) resultsEl.classList.remove('hidden');
    const emptyEl = $('emptyState'); if (emptyEl) emptyEl.classList.add('hidden');
    const t = out.target, s = out.sl;
    const dash = '—';
    setText('tExit', vis.showTarget ? fmtRs(out.targetPrice) : dash);
    setText('sExit', vis.showSL ? fmtRs(out.slPrice) : dash);
    setText('tNet', vis.showTarget ? fmtSignedPlain(t.net) : dash);
    setText('sNet', vis.showSL ? fmtSignedPlain(s.net) : dash);
    setText('tNetPct', vis.showTarget ? `${fmtPct(t.netPct)} net · ${fmtPct(t.returnOnMarginPct)} on margin` : dash);
    setText('sNetPct', vis.showSL ? `${fmtPct(s.netPct)} net · ${fmtPct(s.returnOnMarginPct)} on margin` : dash);
    setText('tGross', vis.showTarget ? `${fmtSignedPlain(t.gross)} (${fmtPct(t.grossPct)})` : dash);
    setText('sGross', vis.showSL ? `${fmtSignedPlain(s.gross)} (${fmtPct(s.grossPct)})` : dash);
    setText('tSell', fmtRs(t.sellValue)); setText('sSell', fmtRs(s.sellValue));
    setText('tBuy', fmtRs(t.buyValue)); setText('sBuy', fmtRs(s.buyValue));
    setText('tTurn', fmtRs(t.turnover)); setText('sTurn', fmtRs(s.turnover));
    setText('tChg', fmtRs(t.totalCharges)); setText('sChg', fmtRs(s.totalCharges));
    setText('tBrok', fmtRs(t.brokerage)); setText('sBrok', fmtRs(s.brokerage));
    setText('tOther', fmtRs(t.otherCharges)); setText('sOther', fmtRs(s.otherCharges));

    const tNetEl = $('tNet'); if (tNetEl) tNetEl.className = 'cell big ' + (t.net >= 0 ? 'g' : 'r');
    const sNetEl = $('sNet'); if (sNetEl) sNetEl.className = 'cell big ' + (s.net >= 0 ? 'g' : 'r');

    // Risk : Reward + verdict
    const risk = Math.abs(s.net), reward = Math.max(0, t.net);
    setText('rRR', (vis.showTarget && vis.showSL && risk > 0) ? ('1 : ' + (reward / risk).toFixed(2)) : dash);
    setText('rMargin', fmtRs(t.marginRequired) + (t.leverageOn ? ` (${t.leverageMultiplier}x)` : ''));
    setText('rMarginPct', vis.showTarget ? fmtPct(t.returnOnMarginPct) : dash);
    setText('rBreakeven', fmtRs(t.breakeven));

    const v = $('verdict');
    if (v) {
    if (vis.showTarget && vis.showSL) {
      v.className = 'verdict ' + (t.net >= 0 ? 'good' : 'bad');
      v.innerHTML = `Win <b>${fmtSignedPlain(t.net)}</b> &nbsp;·&nbsp; Lose <b>${fmtSignedPlain(s.net)}</b> &nbsp;·&nbsp; R:R <b>1 : ${(risk > 0 ? (reward / risk).toFixed(2) : '—')}</b>`;
    } else if (vis.showTarget) {
      v.className = 'verdict ' + (t.net >= 0 ? 'good' : 'bad');
      v.innerHTML = `Target nets <b>${fmtSignedPlain(t.net)}</b> after ${fmtRs(t.totalCharges)} charges`;
    } else {
      v.className = 'verdict ' + (s.net >= 0 ? 'good' : 'bad');
      v.innerHTML = `SL nets <b>${fmtSignedPlain(s.net)}</b> after ${fmtRs(s.totalCharges)} charges`;
    }
    }

    setHTML('breakT', breakupHtml(t)); setHTML('breakS', breakupHtml(s));
  }

  $('calcBtn').addEventListener('click', () => tryCalculate(true));
  $('clearBtn').addEventListener('click', () => {
    ['entry', 'qty', 'targetVal', 'slVal'].forEach((id) => $(id).value = '');
    $('results').classList.add('hidden'); $('emptyState').classList.remove('hidden');
    chrome.storage.local.remove(['form', 'lastResult']);
  });

  function saveHistory(rec) {
    chrome.storage.local.get(['history'], (res) => {
      const h = res.history || []; h.unshift(rec); while (h.length > 100) h.pop();
      chrome.storage.local.set({ history: h });
    });
  }
  function renderHistory() {
    chrome.storage.local.get(['history'], (res) => {
      const h = res.history || []; const box = $('histList'); box.innerHTML = '';
      if (!h.length) { box.innerHTML = '<p class="hint">No tracked trades yet. Run a calculation with “Track” checked.</p>'; return; }
      h.forEach((r, i) => {
        const d = document.createElement('div'); d.className = 'hist';
        const dt = new Date(r.ts).toLocaleString();
        const inp = r.input || {};
        d.innerHTML = `<button class="x" data-i="${i}">✕</button>
          <div><b>${inp.side || ''} · ${inp.segment || ''} · ${inp.exchange || ''}</b> <span class="hdt">${dt}</span></div>
          <div>Entry ₹${inp.entry} × ${inp.qty} → Tgt ${inp.targetValue}${inp.targetMode === 'pct' ? '%' : ''} / SL ${inp.slValue}${inp.slMode === 'pct' ? '%' : ''}${inp.leverageOn ? ` · ${inp.leverageMultiplier}x` : ''}</div>
          <div class="hrow"><span>Target <b class="${r.targetNet >= 0 ? 'g' : 'r'}">${fmtSignedPlain(r.targetNet)}</b></span><span>SL <b class="${r.slNet >= 0 ? 'g' : 'r'}">${fmtSignedPlain(r.slNet)}</b></span><button class="ghost sm" data-r="${i}">Reload</button></div>`;
        box.appendChild(d);
      });
      box.querySelectorAll('.x').forEach((b) => b.addEventListener('click', () => {
        chrome.storage.local.get(['history'], (res2) => {
          const h2 = res2.history || []; h2.splice(parseInt(b.dataset.i, 10), 1);
          chrome.storage.local.set({ history: h2 }, renderHistory);
        });
      }));
      box.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
        chrome.storage.local.get(['history'], (res2) => {
          const rec = (res2.history || [])[parseInt(b.dataset.r, 10)];
          if (!rec) return;
          const inp = rec.input || {};
          $('entry').value = inp.entry ?? ''; $('qty').value = inp.qty ?? '';
          $('targetVal').value = inp.targetValue ?? ''; $('slVal').value = inp.slValue ?? '';
          state.side = inp.side || 'long'; state.exchange = inp.exchange || 'NSE'; state.segment = inp.segment || 'intraday';
          state.targetMode = inp.targetMode || 'price'; state.slMode = inp.slMode || 'price';
          setSegUI('sideSeg', state.side); setSegUI('exchSeg', state.exchange); setSegUI('segSeg', state.segment);
          $('targetMode').textContent = state.targetMode === 'price' ? '₹' : '%';
          $('targetModeLabel').textContent = $('targetMode').textContent;
          $('slMode').textContent = state.slMode === 'price' ? '₹' : '%';
          $('slModeLabel').textContent = $('slMode').textContent;
          $('levOn').checked = !!inp.leverageOn; $('levMult').value = inp.leverageMultiplier || 5;
          persistFormSoon(); tryCalculate(false);
          document.querySelector('.tab[data-tab="calc"]').click();
        });
      }));
    });
  }
  $('refreshHist').addEventListener('click', renderHistory);
  $('clearHist').addEventListener('click', () => { chrome.storage.local.set({ history: [] }, renderHistory); });

  loadAll();
})();
