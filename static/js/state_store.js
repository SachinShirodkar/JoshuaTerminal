/**
 * state_store.js — Chart state persistence
 *
 * Storage schema:
 *   "cs:EURUSD" → {
 *     drawings: { fibs, trendlines, hlines, vlines, positions },
 *     indicators: { "15m": ["rsi","macd"], "1h": ["bb"] },
 *     fibLevels: [0, 0.236, ...],   // per-symbol custom levels
 *     savedAt: <timestamp>
 *   }
 *
 * Drawings are shared across ALL intervals for a symbol (TradingView model).
 * Indicators are stored per-interval so each timeframe can have its own set.
 */

const StateStore = (() => {

  const PREFIX = 'cs:';

  function _key(symbol) {
    return PREFIX + symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function _load(symbol) {
    try {
      const raw = localStorage.getItem(_key(symbol));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[StateStore] load error', e);
      return null;
    }
  }

  function _save(symbol, blob) {
    try {
      blob.savedAt = Date.now();
      localStorage.setItem(_key(symbol), JSON.stringify(blob));
      return true;
    } catch (e) {
      console.warn('[StateStore] save error', e);
      return false;
    }
  }

  function _empty() {
    return {
      drawings: { fibs: [], trendlines: [], hlines: [], vlines: [], positions: [] },
      indicators: {},
      fibLevels: null,
      savedAt: null,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Save the full drawings snapshot for a symbol.
   * drawings = { fibs, trendlines, hlines, vlines, positions }
   */
  function saveDrawings(symbol, drawings, fibLevels) {
    const blob = _load(symbol) || _empty();
    blob.drawings  = drawings;
    blob.fibLevels = fibLevels;
    return _save(symbol, blob);
  }

  /**
   * Save the active indicator set for a specific symbol+interval.
   * indicators = Array of indicator ids, e.g. ["rsi", "macd"]
   */
  function saveIndicators(symbol, interval, indicators) {
    const blob = _load(symbol) || _empty();
    if (!blob.indicators) blob.indicators = {};
    blob.indicators[interval] = indicators;
    return _save(symbol, blob);
  }

  /**
   * Load drawings for a symbol (shared across intervals).
   * Returns { fibs, trendlines, hlines, vlines, positions } or null.
   */
  function loadDrawings(symbol) {
    const blob = _load(symbol);
    return blob ? (blob.drawings || null) : null;
  }

  /**
   * Load indicators for a specific symbol+interval.
   * Returns Array of indicator ids or [].
   */
  function loadIndicators(symbol, interval) {
    const blob = _load(symbol);
    if (!blob || !blob.indicators) return [];
    return blob.indicators[interval] || [];
  }

  /**
   * Load custom fib levels for a symbol.
   * Returns array or null (caller falls back to default).
   */
  function loadFibLevels(symbol) {
    const blob = _load(symbol);
    return blob ? (blob.fibLevels || null) : null;
  }

  /**
   * Check if there is any saved state for a symbol.
   */
  function hasSavedState(symbol) {
    return _load(symbol) !== null;
  }

  /**
   * Delete all saved state for a symbol.
   */
  function deleteSymbol(symbol) {
    try { localStorage.removeItem(_key(symbol)); } catch(e) {}
  }

  /**
   * List all symbols that have saved state.
   * Returns [{ symbol, savedAt, drawingCount, intervalCount }]
   */
  function listAll() {
    const results = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const blob = JSON.parse(localStorage.getItem(k));
        const symbol = k.slice(PREFIX.length);
        const d = blob.drawings || {};
        const drawingCount =
          (d.fibs       || []).length +
          (d.trendlines || []).length +
          (d.hlines     || []).length +
          (d.vlines     || []).length +
          (d.positions  || []).length;
        const intervalCount = Object.keys(blob.indicators || {}).length;
        results.push({ symbol, savedAt: blob.savedAt, drawingCount, intervalCount });
      } catch(e) {}
    }
    return results.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  return { saveDrawings, saveIndicators, loadDrawings, loadIndicators,
           loadFibLevels, hasSavedState, deleteSymbol, listAll };

})();

window.StateStore = StateStore;
