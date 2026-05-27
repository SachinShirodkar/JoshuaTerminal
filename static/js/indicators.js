/**
 * indicators.js — Technical indicator calculations (client-side)
 * All calculations done in pure JS on candle data arrays.
 */

const Indicators = (() => {


// ------S/D Zones & Major Structure Auto Fib-----------------

function sdZonesAutoFib(data, pivotLenSND = 3, majorPivotLen = 10, zoneSens = 0.1, zoneCount = 5, showFibs = true, fibLevels = [0.0, 0.5, 0.618, 0.786, 0.88, 1.0, -0.27, -0.618]) {
  if (!data || data.length < Math.max(pivotLenSND * 2 + 1, majorPivotLen * 2 + 1)) return { supplyZones: [], demandZones: [], fibLevels: [] };

  // Helper: Find pivot high
  function pivotHigh(data, idx, len) {
    if (idx < len || idx >= data.length - len) return null;
    const centerHigh = data[idx].high;
    for (let i = 1; i <= len; i++) {
      if (data[idx - i].high >= centerHigh || data[idx + i].high >= centerHigh) return null;
    }
    return centerHigh;
  }

  // Helper: Find pivot low
  function pivotLow(data, idx, len) {
    if (idx < len || idx >= data.length - len) return null;
    const centerLow = data[idx].low;
    for (let i = 1; i <= len; i++) {
      if (data[idx - i].low <= centerLow || data[idx + i].low <= centerLow) return null;
    }
    return centerLow;
  }

  let lastHiVal = null, lastHiIdx = null, lastHiLow = null;
  let lastLoVal = null, lastLoIdx = null, lastLoHigh = null;
  let majorHi = null, majorHiIdx = null;
  let majorLo = null, majorLoIdx = null;
  
  let supplyZones = [];
  let demandZones = [];
  let lastSupplyPrice = 0.0;
  let lastDemandPrice = 0.0;

  // Process data to detect pivots and BOS
  for (let i = Math.max(pivotLenSND, majorPivotLen); i < data.length; i++) {
    // S/D Pivots
    const pHiSND = pivotHigh(data, i - pivotLenSND, pivotLenSND);
    const pLoSND = pivotLow(data, i - pivotLenSND, pivotLenSND);
    
    if (pHiSND !== null) {
      lastHiVal = pHiSND;
      lastHiIdx = i - pivotLenSND;
      lastHiLow = data[i - pivotLenSND].low;
    }
    
    if (pLoSND !== null) {
      lastLoVal = pLoSND;
      lastLoIdx = i - pivotLenSND;
      lastLoHigh = data[i - pivotLenSND].high;
    }

    // Major Structure Pivots
    const pHiMajor = pivotHigh(data, i - majorPivotLen, majorPivotLen);
    const pLoMajor = pivotLow(data, i - majorPivotLen, majorPivotLen);
    
    if (pHiMajor !== null) {
      majorHi = pHiMajor;
      majorHiIdx = i - majorPivotLen;
    }
    
    if (pLoMajor !== null) {
      majorLo = pLoMajor;
      majorLoIdx = i - majorPivotLen;
    }

    // Detect BOS
    const prevClose = i > 0 ? data[i - 1].close : data[i].close;
    const currClose = data[i].close;
    
    const bearishBOS = lastLoVal !== null && lastHiVal !== null && currClose < lastLoVal && prevClose >= lastLoVal;
    const bullishBOS = lastHiVal !== null && lastLoVal !== null && currClose > lastHiVal && prevClose <= lastHiVal;

    // Create Supply Zone on bearish BOS
    if (bearishBOS) {
      const priceDiff = Math.abs(lastHiVal - lastSupplyPrice) / (lastHiVal !== 0 ? lastHiVal : 1) * 100;
      if (lastSupplyPrice === 0.0 || priceDiff > zoneSens) {
        supplyZones.push({
          leftIdx: lastHiIdx,
          rightIdx: i,
          top: lastHiVal,
          bottom: lastHiLow,
          active: true
        });
        lastSupplyPrice = lastHiVal;
      }
    }

    // Create Demand Zone on bullish BOS
    if (bullishBOS) {
      const priceDiff = Math.abs(lastLoVal - lastDemandPrice) / (lastLoVal !== 0 ? lastLoVal : 1) * 100;
      if (lastDemandPrice === 0.0 || priceDiff > zoneSens) {
        demandZones.push({
          leftIdx: lastLoIdx,
          rightIdx: i,
          top: lastLoHigh,
          bottom: lastLoVal,
          active: true
        });
        lastDemandPrice = lastLoVal;
      }
    }

    // Update zone extensions and check mitigation
    supplyZones = supplyZones.filter(zone => {
      if (!zone.active) return false;
      zone.rightIdx = i;
      if (currClose > zone.top) {
        zone.active = false;
        return false;
      }
      return true;
    });

    demandZones = demandZones.filter(zone => {
      if (!zone.active) return false;
      zone.rightIdx = i;
      if (currClose < zone.bottom) {
        zone.active = false;
        return false;
      }
      return true;
    });
  }

  // Limit to max zones
  if (supplyZones.length > zoneCount) {
    supplyZones = supplyZones.slice(-zoneCount);
  }
  if (demandZones.length > zoneCount) {
    demandZones = demandZones.slice(-zoneCount);
  }

  // Calculate Fibonacci levels
  let fibs = [];
  if (showFibs && majorHi !== null && majorLo !== null && majorHiIdx !== null && majorLoIdx !== null) {
    const startPrice = majorHiIdx > majorLoIdx ? majorLo : majorHi;
    const endPrice = majorHiIdx > majorLoIdx ? majorHi : majorLo;
    const diff = startPrice - endPrice;
    
    fibLevels.forEach(level => {
      const targetPrice = endPrice + (diff * level);
      fibs.push({
        level: level,
        price: targetPrice
      });
    });
  }

  return { supplyZones, demandZones, fibLevels: fibs };
}

  // ─── Moving Averages ─────────────────────────────────

  function sma(data, period) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const avg = slice.reduce((s, c) => s + c.close, 0) / period;
      result.push({ time: data[i].time, value: +avg.toFixed(6) });
    }
    return result;
  }

  function ema(data, period) {
    const k = 2 / (period + 1);
    const result = [];
    let prev = data.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
    result.push({ time: data[period - 1].time, value: +prev.toFixed(6) });
    for (let i = period; i < data.length; i++) {
      prev = data[i].close * k + prev * (1 - k);
      result.push({ time: data[i].time, value: +prev.toFixed(6) });
    }
    return result;
  }

  function vwap(data) {
    const result = [];
    let cumTV = 0, cumV = 0;
    // Reset at session start (simple daily reset)
    let prevDay = null;
    for (const c of data) {
      const day = Math.floor(c.time / 86400);
      if (day !== prevDay) { cumTV = 0; cumV = 0; prevDay = day; }
      const tp = (c.high + c.low + c.close) / 3;
      cumTV += tp * (c.volume || 1);
      cumV  += (c.volume || 1);
      result.push({ time: c.time, value: +(cumTV / cumV).toFixed(6) });
    }
    return result;
  }

  // ─── Bollinger Bands ────────────────────────────────

  function bollingerBands(data, period = 20, mult = 2) {
    const upper = [], lower = [], middle = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const avg = slice.reduce((s, c) => s + c.close, 0) / period;
      const variance = slice.reduce((s, c) => s + Math.pow(c.close - avg, 2), 0) / period;
      const sd = Math.sqrt(variance);
      middle.push({ time: data[i].time, value: +avg.toFixed(6) });
      upper.push({ time: data[i].time, value: +(avg + mult * sd).toFixed(6) });
      lower.push({ time: data[i].time, value: +(avg - mult * sd).toFixed(6) });
    }
    return { upper, middle, lower };
  }

  // ─── Donchian Channel ────────────────────────────────

  function donchian(data, period = 20) {
    const upper = [], lower = [], middle = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const hi = Math.max(...slice.map(c => c.high));
      const lo = Math.min(...slice.map(c => c.low));
      upper.push({ time: data[i].time, value: +hi.toFixed(6) });
      lower.push({ time: data[i].time, value: +lo.toFixed(6) });
      middle.push({ time: data[i].time, value: +((hi + lo) / 2).toFixed(6) });
    }
    return { upper, lower, middle };
  }

  // ─── Keltner Channel ────────────────────────────────

  function keltner(data, period = 20, mult = 1.5) {
    const emaLine = ema(data, period);
    const upper = [], lower = [];
    const atrVals = atr(data, period);
    const emaMap  = Object.fromEntries(emaLine.map(e => [e.time, e.value]));
    const atrMap  = Object.fromEntries(atrVals.map(e => [e.time, e.value]));
    for (const e of emaLine) {
      const a = atrMap[e.time];
      if (a === undefined) continue;
      upper.push({ time: e.time, value: +(e.value + mult * a).toFixed(6) });
      lower.push({ time: e.time, value: +(e.value - mult * a).toFixed(6) });
    }
    return { upper, lower, middle: emaLine };
  }

  // ─── ATR ────────────────────────────────────────────

  function atr(data, period = 14) {
    const tr = [];
    for (let i = 1; i < data.length; i++) {
      const hl = data[i].high - data[i].low;
      const hc = Math.abs(data[i].high - data[i - 1].close);
      const lc = Math.abs(data[i].low  - data[i - 1].close);
      tr.push({ time: data[i].time, value: Math.max(hl, hc, lc) });
    }
    return smaRaw(tr, period);
  }

  function smaRaw(raw, period) {
    const result = [];
    for (let i = period - 1; i < raw.length; i++) {
      const avg = raw.slice(i - period + 1, i + 1).reduce((s, c) => s + c.value, 0) / period;
      result.push({ time: raw[i].time, value: +avg.toFixed(6) });
    }
    return result;
  }

  // ─── RSI ────────────────────────────────────────────

  function rsi(data, period = 14) {
    const result = [];
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = data[i].close - data[i - 1].close;
      if (d >= 0) gains += d; else losses -= d;
    }
    let avgG = gains / period, avgL = losses / period;
    result.push({ time: data[period].time, value: +(100 - 100 / (1 + avgG / (avgL || 1e-10))).toFixed(2) });
    for (let i = period + 1; i < data.length; i++) {
      const d = data[i].close - data[i - 1].close;
      avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
      avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
      result.push({ time: data[i].time, value: +(100 - 100 / (1 + avgG / (avgL || 1e-10))).toFixed(2) });
    }
    return result;
  }

  // ─── MACD ───────────────────────────────────────────

  function macd(data, fast = 12, slow = 26, signal = 9) {
    const fastEma  = ema(data, fast);
    const slowEma  = ema(data, slow);
    const slowMap  = Object.fromEntries(slowEma.map(e => [e.time, e.value]));
    const macdLine = fastEma
      .filter(e => slowMap[e.time] !== undefined)
      .map(e => ({ time: e.time, value: +(e.value - slowMap[e.time]).toFixed(6) }));
    const signalLine = ema(macdLine.map(e => ({ ...e, close: e.value })), signal);
    const sigMap = Object.fromEntries(signalLine.map(e => [e.time, e.value]));
    const histogram = macdLine
      .filter(e => sigMap[e.time] !== undefined)
      .map(e => ({ time: e.time, value: +(e.value - sigMap[e.time]).toFixed(6) }));
    return { macdLine, signalLine, histogram };
  }

  // ─── Stochastic ─────────────────────────────────────

  function stochastic(data, k = 14, d = 3, smooth = 3) {
    const kVals = [];
    for (let i = k - 1; i < data.length; i++) {
      const slice = data.slice(i - k + 1, i + 1);
      const hi = Math.max(...slice.map(c => c.high));
      const lo = Math.min(...slice.map(c => c.low));
      const kVal = hi === lo ? 50 : ((data[i].close - lo) / (hi - lo)) * 100;
      kVals.push({ time: data[i].time, value: +kVal.toFixed(2) });
    }
    const kSmoothed = smaRaw(kVals, smooth);
    const dLine = smaRaw(kSmoothed, d);
    return { k: kSmoothed, d: dLine };
  }

  // ─── ADX ────────────────────────────────────────────

  function adx(data, period = 14) {
    const result = [];
    for (let i = period + 1; i < data.length; i++) {
      let sumTR = 0, sumPDM = 0, sumNDM = 0;
      for (let j = i - period; j < i; j++) {
        const tr = Math.max(
          data[j].high - data[j].low,
          Math.abs(data[j].high - data[j-1].close),
          Math.abs(data[j].low  - data[j-1].close)
        );
        const pdm = Math.max(data[j].high - data[j-1].high, 0);
        const ndm = Math.max(data[j-1].low  - data[j].low,  0);
        sumTR += tr; sumPDM += pdm; sumNDM += ndm;
      }
      const pdi = sumTR ? (sumPDM / sumTR) * 100 : 0;
      const ndi = sumTR ? (sumNDM / sumTR) * 100 : 0;
      const dx  = (pdi + ndi) ? Math.abs(pdi - ndi) / (pdi + ndi) * 100 : 0;
      result.push({ time: data[i].time, value: +dx.toFixed(2) });
    }
    return smaRaw(result, period);
  }

  // ─── CCI ────────────────────────────────────────────

  function cci(data, period = 20) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const tp = slice.map(c => (c.high + c.low + c.close) / 3);
      const avg = tp.reduce((s, v) => s + v, 0) / period;
      const md  = tp.reduce((s, v) => s + Math.abs(v - avg), 0) / period;
      result.push({ time: data[i].time, value: +((tp[tp.length-1] - avg) / (0.015 * (md || 1))).toFixed(2) });
    }
    return result;
  }

  // ─── OBV ────────────────────────────────────────────

  function obv(data) {
    const result = [];
    let cumObv = 0;
    for (let i = 1; i < data.length; i++) {
      const vol = data[i].volume || 0;
      if (data[i].close > data[i-1].close) cumObv += vol;
      else if (data[i].close < data[i-1].close) cumObv -= vol;
      result.push({ time: data[i].time, value: cumObv });
    }
    return result;
  }

  // ─── MFI ────────────────────────────────────────────

  function mfi(data, period = 14) {
    const result = [];
    for (let i = period; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      let posFlow = 0, negFlow = 0;
      for (let j = 1; j < slice.length; j++) {
        const tp = (slice[j].high + slice[j].low + slice[j].close) / 3;
        const prevTp = (slice[j-1].high + slice[j-1].low + slice[j-1].close) / 3;
        const mflow = tp * (slice[j].volume || 0);
        if (tp > prevTp) posFlow += mflow;
        else negFlow += mflow;
      }
      const ratio = negFlow ? posFlow / negFlow : 100;
      result.push({ time: data[i].time, value: +(100 - 100 / (1 + ratio)).toFixed(2) });
    }
    return result;
  }

  // ─── Williams %R ────────────────────────────────────

  function williamsR(data, period = 14) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const hi = Math.max(...slice.map(c => c.high));
      const lo = Math.min(...slice.map(c => c.low));
      const wr = hi === lo ? -50 : ((hi - data[i].close) / (hi - lo)) * -100;
      result.push({ time: data[i].time, value: +wr.toFixed(2) });
    }
    return result;
  }

  // ─── Supertrend ─────────────────────────────────────

  function supertrend(data, period = 10, mult = 3) {
    const atrVals = atr(data, period);
    const atrMap  = Object.fromEntries(atrVals.map(e => [e.time, e.value]));
    const result  = [];
    let trend = 1, prevST = 0;
    for (let i = period; i < data.length; i++) {
      const a = atrMap[data[i].time];
      if (!a) continue;
      const hl2  = (data[i].high + data[i].low) / 2;
      const upper = hl2 + mult * a;
      const lower = hl2 - mult * a;
      const st = trend === 1 ? lower : upper;
      if (data[i].close <= st) trend = -1;
      else if (data[i].close >= st) trend = 1;
      result.push({ time: data[i].time, value: +st.toFixed(6), trend });
      prevST = st;
    }
    return result;
  }

  // ─── Pivot Points ────────────────────────────────────

  function pivotPoints(data) {
    if (data.length < 2) return [];
    const prev = data[data.length - 2];
    const pp   = (prev.high + prev.low + prev.close) / 3;
    const r1   = 2 * pp - prev.low;
    const s1   = 2 * pp - prev.high;
    const r2   = pp + (prev.high - prev.low);
    const s2   = pp - (prev.high - prev.low);
    const t    = data[data.length - 1].time;
    return [
      { time: t, value: +pp.toFixed(6), label: "PP", color: "#f0a500" },
      { time: t, value: +r1.toFixed(6), label: "R1", color: "#ff3d5a" },
      { time: t, value: +r2.toFixed(6), label: "R2", color: "#ff3d5a" },
      { time: t, value: +s1.toFixed(6), label: "S1", color: "#00e676" },
      { time: t, value: +s2.toFixed(6), label: "S2", color: "#00e676" },
    ];
  }

  // ─── Volume bars (for sub-pane) ──────────────────────

  function volumeBars(data) {
    return data.map(c => ({
      time: c.time,
      value: c.volume || 0,
      color: c.close >= c.open ? "rgba(0,230,118,0.5)" : "rgba(255,61,90,0.5)",
    }));
  }


  // ─── VWMA ───────────────────────────────────────────

  function vwma(data, period = 20) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const sumPV = slice.reduce((s, c) => s + c.close * (c.volume || 1), 0);
      const sumV  = slice.reduce((s, c) => s + (c.volume || 1), 0);
      result.push({ time: data[i].time, value: +(sumPV / sumV).toFixed(6) });
    }
    return result;
  }

  // ─── Ichimoku Cloud ──────────────────────────────────

  function ichimoku(data, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52, displacement = 26) {
    function midpoint(arr, start, end) {
      const slice = arr.slice(start, end);
      return (Math.max(...slice.map(c => c.high)) + Math.min(...slice.map(c => c.low))) / 2;
    }
    const tenkan = [], kijun = [], chikouSpan = [], senkouA = [], senkouB = [];
    const maxPeriod = Math.max(tenkanPeriod, kijunPeriod, senkouBPeriod);
    for (let i = maxPeriod - 1; i < data.length; i++) {
      const t = data[i].time;
      if (i >= tenkanPeriod - 1) tenkan.push({ time: t, value: +midpoint(data, i - tenkanPeriod + 1, i + 1).toFixed(6) });
      if (i >= kijunPeriod - 1)  kijun.push({  time: t, value: +midpoint(data, i - kijunPeriod  + 1, i + 1).toFixed(6) });
    }
    for (let i = displacement; i < data.length; i++) {
      chikouSpan.push({ time: data[i - displacement].time, value: +data[i].close.toFixed(6) });
    }
    for (let i = senkouBPeriod - 1; i < data.length - displacement; i++) {
      const futureTime = data[i + displacement] ? data[i + displacement].time : null;
      if (!futureTime) continue;
      const tVal = tenkan.find(e => e.time === data[i].time)?.value || 0;
      const kVal = kijun.find(e => e.time === data[i].time)?.value  || 0;
      senkouA.push({ time: futureTime, value: +((tVal + kVal) / 2).toFixed(6) });
      senkouB.push({ time: futureTime, value: +midpoint(data, i - senkouBPeriod + 1, i + 1).toFixed(6) });
    }
    return { tenkan, kijun, chikouSpan, senkouA, senkouB };
  }

  // ─── Parabolic SAR ──────────────────────────────────

  function parabolicSAR(data, step = 0.02, max = 0.2) {
    if (data.length < 2) return [];
    const result = [];
    let isLong = true, sar = data[0].low, ep = data[0].high, af = step;
    for (let i = 1; i < data.length; i++) {
      sar = sar + af * (ep - sar);
      if (isLong) {
        sar = Math.min(sar, data[i-1].low, i > 1 ? data[i-2].low : data[i-1].low);
        if (data[i].low < sar) { isLong = false; sar = ep; ep = data[i].low; af = step; }
        else if (data[i].high > ep) { ep = data[i].high; af = Math.min(af + step, max); }
      } else {
        sar = Math.max(sar, data[i-1].high, i > 1 ? data[i-2].high : data[i-1].high);
        if (data[i].high > sar) { isLong = true; sar = ep; ep = data[i].high; af = step; }
        else if (data[i].low < ep) { ep = data[i].low; af = Math.min(af + step, max); }
      }
      result.push({ time: data[i].time, value: +sar.toFixed(6), isLong });
    }
    return result;
  }

  // ─── Chaikin Money Flow ──────────────────────────────

  function cmf(data, period = 20) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      let sumMFV = 0, sumVol = 0;
      for (const c of slice) {
        const hl = c.high - c.low;
        const mfm = hl === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / hl;
        sumMFV += mfm * (c.volume || 0);
        sumVol += (c.volume || 0);
      }
      result.push({ time: data[i].time, value: +(sumVol ? sumMFV / sumVol : 0).toFixed(4) });
    }
    return result;
  }

  // ─── Momentum ───────────────────────────────────────

  function momentum(data, period = 10) {
    const result = [];
    for (let i = period; i < data.length; i++) {
      result.push({ time: data[i].time, value: +(data[i].close - data[i - period].close).toFixed(6) });
    }
    return result;
  }

  // ─── Stochastic RSI ─────────────────────────────────

  function stochRSI(data, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
    const rsiVals = rsi(data, rsiPeriod);
    const stochK  = [];
    for (let i = stochPeriod - 1; i < rsiVals.length; i++) {
      const slice = rsiVals.slice(i - stochPeriod + 1, i + 1).map(e => e.value);
      const hi = Math.max(...slice), lo = Math.min(...slice);
      const k  = hi === lo ? 50 : ((rsiVals[i].value - lo) / (hi - lo)) * 100;
      stochK.push({ time: rsiVals[i].time, value: +k.toFixed(2) });
    }
    const kSmoothed = smaRaw(stochK, kSmooth);
    const dLine     = smaRaw(kSmoothed, dSmooth);
    return { k: kSmoothed, d: dLine };
  }

  return {
    sma, ema, vwap, vwma,
    bollingerBands, donchian, keltner,
    atr, rsi, macd, stochastic, adx, cci, obv, mfi, williamsR,
    supertrend, pivotPoints, volumeBars,
    ichimoku, parabolicSAR, cmf, momentum, stochRSI,sdZonesAutoFib,
  };
})();

