"""
snapshot_routes.py — Flask blueprint for JT snapshot system

Registers two endpoint groups:

  State API  (localStorage bridge)
    GET  /api/state/<symbol>          → return saved drawing/indicator blob
    POST /api/state/save              → write blob to state.json on disk

  Snapshot API
    POST /api/snapshot                → launch Playwright, render chart, return PNG path
    GET  /api/snapshot/list           → list all PNG files in the snapshots folder
    GET  /snapshots/<filename>        → serve a snapshot PNG file

Mount in app.py:
    from snapshot_routes import snapshot_bp
    app.register_blueprint(snapshot_bp)
"""

from __future__ import annotations

import json
import os
import threading
import time
import base64
import logging
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory

logger = logging.getLogger(__name__)

snapshot_bp = Blueprint("snapshot", __name__)

# ── Paths ──────────────────────────────────────────────────────────────────────
_ROOT         = Path(__file__).parent
STATE_FILE    = _ROOT / "snapshot_state.json"   # persisted drawing state
SNAPSHOT_DIR  = _ROOT / "snapshots"             # output PNGs land here
SNAPSHOT_DIR.mkdir(exist_ok=True)

# How many days of snapshots to keep. Older files are deleted automatically
# after each successful capture. Set to 0 to disable cleanup.
SNAPSHOT_KEEP_DAYS = int(os.environ.get("SNAPSHOT_KEEP_DAYS", "3"))

def _cleanup_old_snapshots():
    """Delete PNG files older than SNAPSHOT_KEEP_DAYS. Runs after each capture."""
    if SNAPSHOT_KEEP_DAYS <= 0:
        return
    cutoff = datetime.utcnow() - timedelta(days=SNAPSHOT_KEEP_DAYS)
    deleted = 0
    for f in SNAPSHOT_DIR.glob("*.png"):
        try:
            mtime = datetime.utcfromtimestamp(f.stat().st_mtime)
            if mtime < cutoff:
                f.unlink()
                deleted += 1
        except Exception:
            pass
    if deleted:
        logger.info(f"[Snapshot] Cleaned up {deleted} file(s) older than {SNAPSHOT_KEEP_DAYS}d")

# ── Thread lock — one headless browser at a time ───────────────────────────────
_snap_lock = threading.Lock()


# ══════════════════════════════════════════════════════════════════════════════
# STATE API — localStorage bridge
# ══════════════════════════════════════════════════════════════════════════════

def _load_state_file() -> dict:
    """Read the on-disk state JSON. Returns {} on any error."""
    try:
        if STATE_FILE.exists():
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[State] load error: {e}")
    return {}


def _save_state_file(data: dict) -> bool:
    """Write the on-disk state JSON atomically."""
    try:
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(STATE_FILE)
        return True
    except Exception as e:
        logger.error(f"[State] save error: {e}")
        return False


def _normalise_symbol(symbol: str) -> str:
    """Match StateStore._key() logic: strip non-alphanumeric, upper-case."""
    return "".join(c for c in symbol.upper() if c.isalnum())


@snapshot_bp.route("/api/state/<symbol>", methods=["GET"])
def api_state_get(symbol):
    """
    Return the saved drawing/indicator blob for a symbol.
    The blob is exactly what StateStore saves to localStorage:
      { drawings: {...}, indicators: {...}, fibLevels: [...], savedAt: <ts> }
    Returns 404 if no state has been saved for that symbol yet.
    """
    key  = _normalise_symbol(symbol)
    data = _load_state_file()
    blob = data.get(key)
    if blob is None:
        return jsonify({"error": f"No saved state for {symbol}"}), 404
    return jsonify(blob)


@snapshot_bp.route("/api/state/save", methods=["POST"])
def api_state_save():
    """
    Save the drawing/indicator blob for a symbol.

    Expects JSON body:
      { "symbol": "EUR/USD", "state": { ...StateStore blob... } }

    Called automatically by the patched StateStore.saveDrawings() in the browser
    so that on-disk state stays in sync with localStorage.
    """
    body   = request.get_json(silent=True) or {}
    symbol = body.get("symbol", "")
    state  = body.get("state")

    if not symbol or state is None:
        return jsonify({"error": "symbol and state are required"}), 400

    key  = _normalise_symbol(symbol)
    data = _load_state_file()
    data[key] = state

    ok = _save_state_file(data)
    if ok:
        drawing_count = sum(
            len(v) for v in (state.get("drawings") or {}).values()
            if isinstance(v, list)
        )
        logger.info(f"[State] saved {key} — {drawing_count} drawings")
        return jsonify({"ok": True, "symbol": symbol, "key": key})
    return jsonify({"error": "Failed to write state file"}), 500


@snapshot_bp.route("/api/state/export", methods=["GET"])
def api_state_export():
    """Return the full state file (all symbols). Used by the migration script."""
    data = _load_state_file()
    return jsonify(data)


@snapshot_bp.route("/api/state/list", methods=["GET"])
def api_state_list():
    """List all symbols that have saved state."""
    data = _load_state_file()
    result = []
    for key, blob in data.items():
        d = blob.get("drawings") or {}
        drawing_count = sum(len(v) for v in d.values() if isinstance(v, list))
        indicator_count = sum(len(v) for v in (blob.get("indicators") or {}).values() if isinstance(v, list))
        result.append({
            "symbol": key,
            "drawing_count": drawing_count,
            "indicator_count": indicator_count,
            "saved_at": blob.get("savedAt"),
        })
    return jsonify(sorted(result, key=lambda x: x.get("saved_at") or 0, reverse=True))


# ══════════════════════════════════════════════════════════════════════════════
# SNAPSHOT API — Playwright headless render
# ══════════════════════════════════════════════════════════════════════════════

# ── Internal plain-HTTP server for Playwright ────────────────────────────────
# Playwright navigates to a plain HTTP sidecar server so SSL never gets
# involved. Started once at blueprint registration via init_app().

import wsgiref.simple_server
import threading as _threading
import socket as _socket

_internal_port = None   # int once started
_internal_lock = _threading.Lock()

def _get_free_port():
    with _socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def init_app(flask_app):
    """Call this from app.py after register_blueprint to start the HTTP sidecar."""
    global _internal_port
    with _internal_lock:
        if _internal_port:
            return
        port   = _get_free_port()
        server = wsgiref.simple_server.make_server('127.0.0.1', port, flask_app)
        t = _threading.Thread(target=server.serve_forever, daemon=True, name='snapshot-http')
        t.start()
        _internal_port = port
        logger.info(f"[Snapshot] Internal HTTP sidecar started on port {port}")


def _do_snapshot(symbol: str, interval: str, source: str,
                 width: int, height: int, days_back: int) -> dict:
    """
    Core snapshot logic — runs inside the lock so only one browser at a time.

    Steps:
      1. Fetch saved state from the state file for this symbol
      2. Launch Playwright headless Chromium
      3. Load the /snapshot page with the correct URL params
      4. Inject the state blob into window.__SNAPSHOT_STATE__ before navigation
      5. Wait for window.__SNAPSHOT_READY__ == true
      6. Screenshot the #snapshot-chart-wrap element
      7. Save PNG to snapshots/ folder
      8. Return metadata dict with file path + base64

    Returns a dict:
      { ok: True, file: "EURUSD_4h_20250528_143022.png",
        path: "/absolute/path/...",
        symbol, interval, source, width, height,
        duration_ms: 1234,
        base64: "..." }
    or:
      { ok: False, error: "..." }
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"ok": False, "error": "Playwright not installed. Run: pip install playwright && playwright install chromium"}

    t_start = time.time()

    # ── Load saved state ───────────────────────────────────────────────────────
    key   = _normalise_symbol(symbol)
    state = _load_state_file().get(key)  # may be None — that's fine

    # ── Build URL ──────────────────────────────────────────────────────────────
    # Determine days_back if not explicitly supplied
    if days_back == 0:
        days_back = 90 if interval in ("4h", "4H", "240") else 5

    # Use the internal plain-HTTP sidecar (started by init_app) so Playwright
    # never touches SSL regardless of how the main JT server is configured.
    if not _internal_port:
        return {"ok": False, "error": "Snapshot sidecar not started — call snapshot_routes.init_app(app) in app.py"}
    base_url = f"http://127.0.0.1:{_internal_port}"
    url = (
        f"{base_url}/snapshot"
        f"?symbol={symbol}"
        f"&interval={interval}"
        f"&source={source}"
        f"&days={days_back}"
    )

    # ── Build safe filename ────────────────────────────────────────────────────
    safe_sym = _normalise_symbol(symbol)
    ts_str   = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{safe_sym}_{interval}_{ts_str}.png"
    out_path = SNAPSHOT_DIR / filename

    has_saved_state = state is not None
    logger.info(f"[Snapshot] {symbol} {interval} — launching Playwright → {url}")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-background-timer-throttling",
                    "--disable-renderer-backgrounding",
                    "--disable-backgrounding-occluded-windows",
                    "--font-render-hinting=none",
                ]
            )

            context = browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=1,
            )
            page = context.new_page()

            # ── Inject state BEFORE navigation via init script ─────────────────
            # init_script runs before any page JS — this ensures __SNAPSHOT_STATE__
            # is available when pane.js calls StateStore.loadDrawings()
            if state is not None:
                state_json = json.dumps(state)
                page.add_init_script(f"window.__SNAPSHOT_STATE__ = {state_json};")
                logger.info(f"[Snapshot] Injected state for {key}")
            else:
                logger.info(f"[Snapshot] No saved state for {key} — clean render")

            # ── Navigate ───────────────────────────────────────────────────────
            page.goto(url, wait_until="networkidle", timeout=30_000)

            # ── Wait for chart to signal it's ready ────────────────────────────
            page.wait_for_function(
                "() => window.__SNAPSHOT_READY__ === true",
                timeout=30_000,
                polling=100,
            )

            # ── Apply right-side offset via JS after everything has settled ────
            # Done here in Playwright (not in snapshot.html) so it runs AFTER all
            # indicator/drawing renders that may internally reset fitContent().
            page.evaluate("""() => {
                try {
                    const pane = window._snapPane;
                    if (!pane || !pane.chart || !pane.candles || !pane.candles.length) return;
                    const ts    = pane.chart.timeScale();
                    const count = pane.candles.length;
                    const range = ts.getVisibleLogicalRange();
                    if (!range) return;
                    ts.setVisibleLogicalRange({ from: range.from, to: count - 1 + 8 });
                } catch(e) {}
            }""")

            # 600ms for the offset repaint + canvas overlays (trendlines, S/D zones)
            page.wait_for_timeout(600)

            # ── Screenshot ────────────────────────────────────────────────────
            chart_wrap = page.locator("#snapshot-chart-wrap")
            chart_wrap.screenshot(path=str(out_path))

            browser.close()

    except Exception as e:
        logger.error(f"[Snapshot] Playwright error for {symbol} {interval}: {e}")
        return {"ok": False, "error": str(e)}

    duration_ms = int((time.time() - t_start) * 1000)

    # Read back as base64 so the caller can pass directly to Claude
    try:
        b64 = base64.b64encode(out_path.read_bytes()).decode()
    except Exception:
        b64 = None

    size_kb = out_path.stat().st_size // 1024 if out_path.exists() else 0
    logger.info(f"[Snapshot] ✓ {filename} ({size_kb} KB, {duration_ms}ms)")

    # Prune old snapshots — keeps disk usage bounded automatically
    _cleanup_old_snapshots()

    return {
        "ok":              True,
        "file":            filename,
        "path":            str(out_path),
        "symbol":          symbol,
        "interval":        interval,
        "source":          source,
        "width":           width,
        "height":          height,
        "days_back":       days_back,
        "duration_ms":     duration_ms,
        "size_kb":         size_kb,
        "has_saved_state": has_saved_state,
        "base64":          b64,
    }


@snapshot_bp.route("/api/snapshot", methods=["POST"])
def api_snapshot():
    """
    POST /api/snapshot
    Body (JSON):
      {
        "symbol":   "EUR/USD",    required
        "interval": "4h",         required
        "source":   "oanda",      optional, default "oanda"
        "width":    1600,         optional, default 1600
        "height":   900,          optional, default 900
        "days":     90            optional, 0 = auto (90 for 4h, 5 for 15m)
      }

    Returns:
      { ok, file, path, symbol, interval, source, width, height,
        days_back, duration_ms, size_kb, base64 }
    """
    body     = request.get_json(silent=True) or {}
    symbol   = body.get("symbol", "EUR/USD")
    interval = body.get("interval", "4h")
    source   = body.get("source", "oanda")
    width    = int(body.get("width",  1600))
    height   = int(body.get("height",  900))
    days     = int(body.get("days",      0))

    if not symbol or not interval:
        return jsonify({"ok": False, "error": "symbol and interval are required"}), 400

    # Serialise all snapshot requests — one headless browser at a time
    acquired = _snap_lock.acquire(timeout=120)
    if not acquired:
        return jsonify({"ok": False, "error": "Snapshot server busy — try again"}), 503

    try:
        result = _do_snapshot(symbol, interval, source, width, height, days)
    finally:
        _snap_lock.release()

    status = 200 if result.get("ok") else 500
    return jsonify(result), status


@snapshot_bp.route("/api/snapshot/batch", methods=["POST"])
def api_snapshot_batch():
    """
    POST /api/snapshot/batch
    Convenience endpoint — takes a list of {symbol, interval} pairs and
    runs them all sequentially. Returns a list of results.

    Body:
      {
        "charts":  [{"symbol":"EUR/USD","interval":"4h"}, ...],
        "source":  "oanda",   optional
        "width":   1600,      optional
        "height":  900,       optional
      }
    """
    body    = request.get_json(silent=True) or {}
    charts  = body.get("charts", [])
    source  = body.get("source", "oanda")
    width   = int(body.get("width",  1600))
    height  = int(body.get("height",  900))

    if not charts:
        return jsonify({"ok": False, "error": "charts list is required"}), 400

    results = []
    acquired = _snap_lock.acquire(timeout=300)
    if not acquired:
        return jsonify({"ok": False, "error": "Snapshot server busy — try again"}), 503

    try:
        for item in charts:
            sym  = item.get("symbol", "EUR/USD")
            tf   = item.get("interval", "4h")
            days = int(item.get("days", 0))
            result = _do_snapshot(sym, tf, source, width, height, days)
            results.append(result)
    finally:
        _snap_lock.release()

    all_ok = all(r.get("ok") for r in results)
    return jsonify({"ok": all_ok, "results": results})


@snapshot_bp.route("/api/snapshot/list", methods=["GET"])
def api_snapshot_list():
    """List all PNG files in the snapshots folder, newest first."""
    files = sorted(SNAPSHOT_DIR.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)
    result = []
    for f in files:
        result.append({
            "file":     f.name,
            "size_kb":  f.stat().st_size // 1024,
            "modified": datetime.utcfromtimestamp(f.stat().st_mtime).isoformat(),
        })
    return jsonify(result)


@snapshot_bp.route("/snapshots/<path:filename>")
def serve_snapshot(filename):
    """Serve a snapshot PNG file directly."""
    return send_from_directory(str(SNAPSHOT_DIR), filename)


# ── Snapshot page route ────────────────────────────────────────────────────────
# Register this in app.py alongside the blueprint, or add it here.
# The route returns the snapshot.html template.
