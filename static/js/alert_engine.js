/**
 * alert_engine.js — Joshua Terminal
 *
 * Generic alert engine. All alert types (price cross, RSI level,
 * MACD signal, BB breach, etc.) funnel through AlertEngine.trigger().
 *
 * Usage:
 *   AlertEngine.trigger({
 *     symbol:    'EUR/USD',
 *     interval:  '15m',
 *     type:      'price_cross',       // 'rsi_cross' | 'bb_breach' | etc. in future
 *     direction: 'above',             // 'below'
 *     level:     1.0850,
 *     current:   1.0852,
 *     label:     'Horizontal Line',   // 'RSI 70' | 'BB Upper' | etc. in future
 *   });
 *
 * Outputs:
 *   1. Browser notification (Web Notifications API)
 *   2. POST /api/alert  →  Telegram via backend
 *
 * Cooldown: each unique (symbol + level) pair is silenced for
 * COOLDOWN_MS after firing, to avoid repeated triggers on every tick.
 */

const AlertEngine = (() => {

  const COOLDOWN_MS = 60_000; // 1 minute between repeated alerts on same level
  const _fired = new Map();   // key → timestamp of last fire

  // ── Cooldown guard ──────────────────────────────────────────────────────────
  function _cooldownKey(payload) {
    return `${payload.symbol}:${payload.level}:${payload.direction}`;
  }

  function _isOnCooldown(payload) {
    const key = _cooldownKey(payload);
    const last = _fired.get(key);
    if (!last) return false;
    return (Date.now() - last) < COOLDOWN_MS;
  }

  function _markFired(payload) {
    _fired.set(_cooldownKey(payload), Date.now());
  }

  // ── Message builder ─────────────────────────────────────────────────────────
  // Single source of truth for alert text — backend uses same payload
  // so Telegram message is built server-side from the same fields.
  function _buildTitle(payload) {
    const dir = payload.direction === 'above' ? '▲ crossed above' : '▼ crossed below';
    return `🔔 ${payload.symbol} ${dir} ${payload.level}`;
  }

  function _buildBody(payload) {
    const dec = payload.level >= 10 ? 2 : payload.level >= 1 ? 4 : 5;
    return `${payload.label} · ${payload.interval} · Current: ${Number(payload.current).toFixed(dec)}`;
  }

  // ── Browser notification ────────────────────────────────────────────────────
  async function _browserNotify(payload) {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission !== 'granted') return;

    new Notification(_buildTitle(payload), {
      body: _buildBody(payload),
      icon: '/static/img/icon.png',   // optional — silently ignored if missing
      tag:  _cooldownKey(payload),    // replaces previous notification for same level
    });
  }

  // ── Telegram (via backend) ──────────────────────────────────────────────────
  async function _telegramNotify(payload) {
    try {
      await fetch('/api/alert', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    } catch (e) {
      console.warn('[AlertEngine] Telegram POST failed:', e);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Request browser notification permission up front.
   * Call once on app init so the prompt appears on a user gesture.
   */
  function requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  /**
   * Fire an alert through all channels.
   *
   * @param {Object} payload
   * @param {string} payload.symbol    e.g. 'EUR/USD'
   * @param {string} payload.interval  e.g. '15m'
   * @param {string} payload.type      e.g. 'price_cross' | 'rsi_cross' | 'bb_breach'
   * @param {string} payload.direction 'above' | 'below'
   * @param {number} payload.level     the threshold value
   * @param {number} payload.current   the current value at trigger time
   * @param {string} payload.label     human label, e.g. 'Horizontal Line', 'RSI 70'
   */
  function trigger(payload) {
    if (_isOnCooldown(payload)) return;
    _markFired(payload);
    _browserNotify(payload);
    _telegramNotify(payload);
    console.info('[AlertEngine] fired:', payload);
  }

  return { trigger, requestPermission };

})();

window.AlertEngine = AlertEngine;
