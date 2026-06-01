/**
 * state_store.js — Chart state persistence
 *
 * Storage schema:
 *   "cs:EURUSD" → {
 *     drawings: { fibs, trendlines, hlines, vlines, positions },
 *     indicators: ["rsi","macd"],   // per-symbol, shared across ALL intervals
 *     fibLevels: [0, 0.236, ...],   // per-symbol custom levels
 *     savedAt: <timestamp>
 *   }
 *
 * Drawings are shared across ALL intervals for a symbol (TradingView model).
 * Indicators are also shared across ALL intervals for a symbol — adding an
 * indicator on any timeframe makes it visible on every timeframe for that pair.
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
      indicators: [],
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
    const ok = _save(symbol, blob);
    if (ok) _syncToServer(symbol, blob);  // keep snapshot_state.json in sync
    return ok;
  }

  /**
   * Fire-and-forget POST to /api/state/save so Playwright snapshots always
   * see the latest drawings without any manual migration step.
   * Never throws — localStorage save already succeeded before this runs.
   */
  function _syncToServer(symbol, blob) {
    try {
      fetch('/api/state/save', {
        method:    'POST',
        headers:   { 'Content-Type': 'application/json' },
        body:      JSON.stringify({ symbol, state: blob }),
        keepalive: true,
      }).then(r => {
        if (!r.ok) console.warn('[StateStore] server sync failed for', symbol, r.status);
      }).catch(e => {
        console.warn('[StateStore] server sync error:', e.message);
      });
    } catch(e) {
      console.warn('[StateStore] _syncToServer threw:', e);
    }
  }

  /**
   * Save the active indicator set for a symbol (shared across all intervals).
   * indicators = Array of indicator ids, e.g. ["rsi", "macd"]
   */
  function saveIndicators(symbol, indicators) {
    const blob = _load(symbol) || _empty();
    blob.indicators = indicators;
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
   * Load indicators for a symbol (shared across all intervals).
   * Returns Array of indicator ids or [].
   */
  function loadIndicators(symbol) {
    const blob = _load(symbol);
    if (!blob) return [];
    // Migration: handle old per-interval format { "15m": [...] }
    if (blob.indicators && !Array.isArray(blob.indicators)) {
      // Flatten all interval arrays into one deduplicated set
      const merged = new Set();
      Object.values(blob.indicators).forEach(arr => arr.forEach(id => merged.add(id)));
      return [...merged];
    }
    return blob.indicators || [];
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
        const indicatorCount = Array.isArray(blob.indicators)
          ? blob.indicators.length
          : Object.keys(blob.indicators || {}).length;
        results.push({ symbol, savedAt: blob.savedAt, drawingCount, indicatorCount });
      } catch(e) {}
    }
    return results.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  return { saveDrawings, saveIndicators, loadDrawings, loadIndicators,
           loadFibLevels, hasSavedState, deleteSymbol, listAll };

})();

window.StateStore = StateStore;
