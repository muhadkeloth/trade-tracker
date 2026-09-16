/* Popup UI wiring. Depends on calculator.js globals. */
(function () {
  const $ = (id) => document.getElementById(id);
  const fmtRs = (n) => '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => Number(n || 0).toFixed(2) + '%';
  const fmtSigned = (n) => (n >= 0 ? '+' : '') + fmtRs(n);

  const state = { side: 'long', exchange: 'NSE', segment: 'intraday', targetMode: 'price', slMode: 'price', settings: null };

  function segWire(id, key) {
    const el = $(id);
    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        state[key] = b.dataset.val.toLowerCase() === 'nse' || b.dataset.val.toLowerCase() === 'bse'
          ? b.dataset.val.toUpperCase() : b.dataset.val.toLowerCase();
      });
    });
  }
  segWire('sideSeg', 'side'); segWire('exchSeg', 'exchange'); segWire('segSeg', 'segment');

  function modeWire(btnId, labelId, key) {
    $(btnId).addEventListener('click', () => {
      state[key] = state[key] === 'price' ? 'pct' : 'price';
      const sym = state[key] === 'price' ? '₹' : '%';
      $(btnId).textContent = sym; $(labelId).textContent = sym;
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

  function loadSettings() {
    chrome.storage.local.get(['settings'], (res) => {
      state.settings = Object.assign({}, DEFAULT_SETTINGS, res.settings || {});
      fillSettingsForm();
      $('levOn').checked = !!state.settings.leverageEnabled;
      $('levMult').value = state.settings.leverageMultiplier;
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
    MAP.forEach(([id, k]) => { $(id).value = state.settings[k]; });
    $('s_levOn').checked = !!state.settings.leverageEnabled;
  }
  $('saveSettings').addEventListener('click', () => {
    const s = Object.assign({}, state.settings);
    MAP.forEach(([id, k]) => { s[k] = parseFloat($(id).value); });
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
      `<div><dt><b>Total</b></dt><dd><b>${fmtRs(r.totalCharges)}</b></dd></div>` +
      `<div><dt>Breakeven</dt><dd>${fmtRs(r.breakeven)}</dd></div>`;
  }

  function doCalculate(save = true) {
    const entry = parseFloat($('entry').value);
    const qty = parseInt($('qty').value, 10);
    if (!(entry > 0) || !(qty > 0)) { alert('Enter valid entry price and quantity'); return null; }
    const input = {
      entry, qty,
      targetValue: parseFloat($('targetVal').value), targetMode: state.targetMode,
      slValue: parseFloat($('slVal').value), slMode: state.slMode,
      segment: state.segment, exchange: state.exchange, side: state.side,
      leverageOn: $('levOn').checked, leverageMultiplier: parseFloat($('levMult').value) || 5,
      settings: getSettings()
    };
    const out = calculateScenario(input);
    $('results').classList.remove('hidden');
    const t = out.target, s = out.sl;
    $('tNet').textContent = fmtSigned(t.net); $('tNetPct').textContent = `Net ${fmtPct(t.netPct)} · Gross ${fmtSigned(t.gross)} (${fmtPct(t.grossPct)})`;
    $('tExit').textContent = fmtRs(out.targetPrice); $('tSell').textContent = fmtRs(t.sellValue);
    $('tBuy').textContent = fmtRs(t.buyValue); $('tGross').textContent = `${fmtSigned(t.gross)} (${fmtPct(t.grossPct)})`;
    $('tChg').textContent = fmtRs(t.totalCharges); $('tBrok').textContent = fmtRs(t.brokerage);
    $('tOther').textContent = fmtRs(t.otherCharges); $('tTurn').textContent = fmtRs(t.turnover);
    $('sNet').textContent = fmtSigned(s.net); $('sNetPct').textContent = `Net ${fmtPct(s.netPct)} · Gross ${fmtSigned(s.gross)} (${fmtPct(s.grossPct)})`;
    $('sExit').textContent = fmtRs(out.slPrice); $('sSell').textContent = fmtRs(s.sellValue);
    $('sBuy').textContent = fmtRs(s.buyValue); $('sGross').textContent = `${fmtSigned(s.gross)} (${fmtPct(s.grossPct)})`;
    $('sChg').textContent = fmtRs(s.totalCharges); $('sBrok').textContent = fmtRs(s.brokerage);
    $('sOther').textContent = fmtRs(s.otherCharges); $('sTurn').textContent = fmtRs(s.turnover);
    $('rMargin').textContent = fmtRs(t.marginRequired) + (t.leverageOn ? ` (${t.leverageMultiplier}x)` : ' (no leverage)');
    $('rMarginPct').textContent = `${fmtPct(t.returnOnMarginPct)}`;
    $('rBreakeven').textContent = fmtRs(t.breakeven);
    $('breakT').innerHTML = breakupHtml(t); $('breakS').innerHTML = breakupHtml(s);

    if (save && $('autosave').checked) saveHistory({ input, targetNet: t.net, slNet: s.net, ts: Date.now() });
    return { input, out };
  }
  $('calcBtn').addEventListener('click', () => doCalculate(true));

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
          <div><b>${inp.side || ''} ${inp.segment || ''} ${inp.exchange || ''}</b> · ${dt}</div>
          <div>Entry ₹${inp.entry} × ${inp.qty} → Tgt ${inp.targetValue}${inp.targetMode === 'pct' ? '%' : ''} / SL ${inp.slValue}${inp.slMode === 'pct' ? '%' : ''}</div>
          <div>Target net <b class="${r.targetNet >= 0 ? 'g' : 'r'}">${fmtSigned(r.targetNet)}</b> · SL net <b class="${r.slNet >= 0 ? 'g' : 'r'}">${fmtSigned(r.slNet)}</b></div>`;
        box.appendChild(d);
      });
      box.querySelectorAll('.x').forEach((b) => b.addEventListener('click', () => {
        chrome.storage.local.get(['history'], (res2) => {
          const h2 = res2.history || []; h2.splice(parseInt(b.dataset.i, 10), 1);
          chrome.storage.local.set({ history: h2 }, renderHistory);
        });
      }));
    });
  }
  $('refreshHist').addEventListener('click', renderHistory);
  $('clearHist').addEventListener('click', () => { chrome.storage.local.set({ history: [] }, renderHistory); });

  loadSettings();
})();
