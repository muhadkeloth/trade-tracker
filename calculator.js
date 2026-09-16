/* Pure calculation logic — no chrome APIs so it can be unit-tested with Node.
 * All rates are in PERCENT unless stated as flat Rs.
 */

const DEFAULT_SETTINGS = {
  leverageEnabled: true,
  leverageMultiplier: 5,

  // Brokerage: % per side, capped at flat Rs per side (per executed order)
  intradayBrokeragePct: 0.03,
  intradayBrokerageFlat: 20,
  deliveryBrokeragePct: 0.0,
  deliveryBrokerageFlat: 20,
  mtfBrokeragePct: 0.03,
  mtfBrokerageFlat: 20,

  // Exchange transaction charges (% of turnover)
  exchNseIntraday: 0.00307,
  exchNseDelivery: 0.00345,
  exchNseMtf: 0.00345,
  exchBseIntraday: 0.00375,
  exchBseDelivery: 0.00375,
  exchBseMtf: 0.00375,

  // STT (%)
  sttIntradaySellPct: 0.025, // sell side only
  sttDeliveryPct: 0.1,       // buy + sell
  sttMtfPct: 0.1,            // buy + sell

  // Stamp duty on BUY side (%)
  stampIntradayPct: 0.003,
  stampDeliveryPct: 0.015,
  stampMtfPct: 0.003,

  sebiPct: 0.0001, // Rs 10 per crore
  ipftPct: 0.0,
  gstPct: 18.0,    // on (brokerage + exchange)
  dpCharge: 15.93  // flat per sell trade for Delivery/MTF, 0 for Intraday
};

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function brokerageForSide(value, pct, flat) {
  if (value <= 0) return 0;
  const byPct = (value * pct) / 100;
  return Math.min(byPct, flat);
}

function exchangeRate(segment, exchange, s) {
  const ex = (exchange || 'NSE').toUpperCase();
  const seg = (segment || 'intraday').toLowerCase();
  if (ex === 'BSE') {
    if (seg === 'delivery') return num(s.exchBseDelivery, 0.00375);
    if (seg === 'mtf') return num(s.exchBseMtf, 0.00375);
    return num(s.exchBseIntraday, 0.00375);
  }
  if (seg === 'delivery') return num(s.exchNseDelivery, 0.00345);
  if (seg === 'mtf') return num(s.exchNseMtf, 0.00345);
  return num(s.exchNseIntraday, 0.00307);
}

/* Core: full charge breakdown for one buy->sell round trip (long).
 * For SHORT positions gross is (buyValue - sellValue) i.e. entry sell, exit buy,
 * but charges are identical (turnover based), so caller flips buy/sell for P&L.
 */
function calculateTrade(buyPrice, sellPrice, qty, options = {}) {
  const s = Object.assign({}, DEFAULT_SETTINGS, options.settings || {});
  const segment = (options.segment || 'intraday').toLowerCase();
  const exchange = (options.exchange || 'NSE').toUpperCase();
  const side = (options.side || 'long').toLowerCase();

  buyPrice = num(buyPrice);
  sellPrice = num(sellPrice);
  qty = Math.max(0, Math.floor(num(qty)));

  const buyValue = buyPrice * qty;
  const sellValue = sellPrice * qty;
  const turnover = buyValue + sellValue;

  // Brokerage
  let bPct, bFlat;
  if (segment === 'delivery') { bPct = num(s.deliveryBrokeragePct); bFlat = num(s.deliveryBrokerageFlat); }
  else if (segment === 'mtf') { bPct = num(s.mtfBrokeragePct); bFlat = num(s.mtfBrokerageFlat); }
  else { bPct = num(s.intradayBrokeragePct); bFlat = num(s.intradayBrokerageFlat); }
  const brokBuy = brokerageForSide(buyValue, bPct, bFlat);
  const brokSell = brokerageForSide(sellValue, bPct, bFlat);
  const brokerage = brokBuy + brokSell;

  // Exchange
  const exchRate = exchangeRate(segment, exchange, s);
  const exchangeCharges = (turnover * exchRate) / 100;

  // STT
  let stt = 0;
  if (segment === 'intraday') stt = (sellValue * num(s.sttIntradaySellPct)) / 100;
  else if (segment === 'mtf') stt = ((turnover * num(s.sttMtfPct)) / 100);
  else stt = ((turnover * num(s.sttDeliveryPct)) / 100);

  // Stamp duty (buy side)
  let stampRate = num(s.stampIntradayPct);
  if (segment === 'delivery') stampRate = num(s.stampDeliveryPct);
  if (segment === 'mtf') stampRate = num(s.stampMtfPct);
  const stamp = (buyValue * stampRate) / 100;

  const sebi = (turnover * num(s.sebiPct)) / 100;
  const ipft = (turnover * num(s.ipftPct)) / 100;

  // GST on (brokerage + exchange) — matches Zerodha + user examples
  const gst = ((brokerage + exchangeCharges) * num(s.gstPct)) / 100;

  // DP charges only on sell for delivery/mtf
  const dp = (segment === 'delivery' || segment === 'mtf') && sellValue > 0 ? num(s.dpCharge) : 0;

  const totalCharges = brokerage + exchangeCharges + stt + sebi + ipft + stamp + gst + dp;
  const otherCharges = totalCharges - brokerage;

  let gross;
  if (side === 'short') gross = (buyValue - sellValue); // buyPrice here = entry, sellPrice = exit(buy-back)... handled by caller
  else gross = sellValue - buyValue;
  const net = gross - totalCharges;

  const grossPct = buyValue > 0 ? (gross / buyValue) * 100 : 0;
  const netPct = buyValue > 0 ? (net / buyValue) * 100 : 0;

  // Breakeven sell price for LONG (sell that makes net = 0)
  // Approximation: totalCharges vary slightly with sell price (STT/brokerage),
  // so iterate twice for accuracy.
  let breakeven = qty > 0 ? buyPrice + totalCharges / qty : 0;
  if (side === 'short') breakeven = qty > 0 ? buyPrice - totalCharges / qty : 0;

  // Leverage / margin
  const levOn = !!options.leverageOn;
  const levMult = Math.max(1, num(options.leverageMultiplier, num(s.leverageMultiplier, 5)));
  const marginRequired = levOn ? buyValue / levMult : buyValue;
  const returnOnMarginPct = marginRequired > 0 ? (net / marginRequired) * 100 : 0;

  return {
    buyPrice, sellPrice, qty, segment, exchange, side,
    buyValue, sellValue, turnover,
    brokerage, brokBuy, brokSell,
    exchangeCharges, exchRate,
    stt, sebi, ipft, stamp, gst, dp,
    totalCharges, otherCharges,
    gross, grossPct, net, netPct,
    breakeven,
    leverageOn: levOn, leverageMultiplier: levMult,
    marginRequired, returnOnMarginPct
  };
}

/* Resolve a target/SL input that can be either absolute price or % .
 * mode: 'price' | 'pct'. For LONG: target% is above entry, sl% below.
 * For SHORT: inverted.
 */
function resolvePrice(entry, value, mode, kind, side = 'long') {
  entry = num(entry);
  value = num(value);
  const isShort = (side || 'long').toLowerCase() === 'short';
  if (mode === 'pct') {
    if (kind === 'target') return isShort ? entry * (1 - value / 100) : entry * (1 + value / 100);
    return isShort ? entry * (1 + value / 100) : entry * (1 - value / 100); // SL
  }
  return value;
}

/* Full scenario: entry + target + SL => two calculateTrade results + shared info */
function calculateScenario(input) {
  const {
    entry, qty, targetValue, targetMode = 'price', slValue, slMode = 'price',
    segment = 'intraday', exchange = 'NSE', side = 'long',
    leverageOn = false, leverageMultiplier = 5, settings = {}
  } = input;

  const targetPrice = resolvePrice(entry, targetValue, targetMode, 'target', side);
  const slPrice = resolvePrice(entry, slValue, slMode, 'sl', side);

  const opts = { segment, exchange, side, leverageOn, leverageMultiplier, settings };
  // For SHORT: entry is the sell, exit is the buy-back. Reuse long math by
  // swapping so turnover/charges stay right, then fix sign of gross.
  let target, sl;
  if ((side || 'long').toLowerCase() === 'short') {
    // sell at entry, buy back at exit => buyPrice=exit, sellPrice=entry
    const t2 = calculateTrade(targetPrice, entry, qty, { ...opts, side: 'long' });
    const s2 = calculateTrade(slPrice, entry, qty, { ...opts, side: 'long' });
    // gross for short = entry*qty - exit*qty
    t2.gross = t2.sellValue - t2.buyValue;
    s2.gross = s2.sellValue - s2.buyValue;
    t2.net = t2.gross - t2.totalCharges;
    s2.net = s2.gross - s2.totalCharges;
    t2.grossPct = t2.sellValue > 0 ? 0 : 0; // keep buyValue-based pct below
    // Express % vs entry value (sellValue = entry value)
    const entryVal = num(entry) * Math.max(0, Math.floor(num(qty)));
    t2.grossPct = entryVal > 0 ? (t2.gross / entryVal) * 100 : 0;
    t2.netPct = entryVal > 0 ? (t2.net / entryVal) * 100 : 0;
    s2.grossPct = entryVal > 0 ? (s2.gross / entryVal) * 100 : 0;
    s2.netPct = entryVal > 0 ? (s2.net / entryVal) * 100 : 0;
    target = { ...t2, exitPrice: targetPrice, entryPrice: num(entry) };
    sl = { ...s2, exitPrice: slPrice, entryPrice: num(entry) };
  } else {
    target = calculateTrade(entry, targetPrice, qty, opts);
    sl = calculateTrade(entry, slPrice, qty, opts);
  }
  return { targetPrice, slPrice, target, sl };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_SETTINGS, calculateTrade, resolvePrice, calculateScenario };
}
