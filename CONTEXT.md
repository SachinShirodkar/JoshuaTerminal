# Joshua Terminal — Claude Context File
_Last updated: MT5 multi-source data layer — MetaTrader 5 bridge added as top-priority forex source; per-pane source freedom; all four sources (MT5, OANDA, YF, Hyperliquid) independently selectable per chart pane_

---

## Project Name
**Joshua Terminal** (formerly "Trading Terminal") — a free, self-hosted, multi-chart trading dashboard with integrated AI analysis pipeline.

---

## Stack
| Layer | Technology |
|---|---|
| Backend | Python 3.9+, Flask, Flask-SocketIO (threading mode), python-dotenv |
| Frontend | Vanilla JS (no framework), Lightweight Charts v4.1.3 |
| Forex live prices (primary) | MetaTrader 5 via `mt5_bridge.py` HTTP bridge (when `MT5_ENABLED=true`) |
| Forex live prices (secondary) | OANDA v20 REST + HTTP streaming |
| Crypto live prices | Hyperliquid WebSocket (allMids) |
| Forex candles fallback | yfinance (when no OANDA key and MT5 not enabled) |
| Styling | Plain CSS with CSS variables, JetBrains Mono + Syne fonts |
| Alerts | Browser Web Notifications API + Telegram Bot API |
| Snapshot rendering | Playwright (headless Chromium) |
| AI analysis | Anthropic Claude API (vision) |

---

## File Structure
```
joshua_terminal/
├── app.py                    # Flask backend + SocketIO + OANDA stream + HL WS + MT5 poller + alert endpoint
│                             # + registers snapshot_bp + starts HTTP sidecar via init_app()
├── data_source.py            # Pluggable data layer — MT5 bridge (primary), OANDA v20, yfinance fallback
├── mt5_bridge.py             # Standalone HTTP bridge — run on Windows MT5 machine (same LAN or localhost)
│                             # Exposes /health /price /candles /symbols — read-only, MIT licensed
├── snapshot_routes.py        # Snapshot system blueprint — state API + Playwright renderer + cleanup
├── snapshot_state.json       # Server-side drawing/indicator state (auto-created, gitignore this)
├── snapshots/                # Output PNGs from Playwright (auto-created, auto-cleaned after 7 days)
├── requirements.txt
├── .env                      # All credentials (not committed to git)
├── .env.example              # Template for .env
├── Indicators.md             # Log of all Pine Script indicators converted to JS
├── templates/
│   ├── index.html            # Single-page shell — topbar, grid, flyouts, panels, scripts
│   ├── popout.html           # Standalone chart window for multi-monitor popout
│   ├── snapshot.html         # Headless chart page rendered by Playwright for analysis snapshots
│   └── pine-converter.html   # Pine Script → Joshua Terminal converter tool
└── static/
    ├── css/
    │   └── style.css         # All styles — CSS vars, light/dark theme, pane, toolbar, flyouts
    └── js/
        ├── indicators.js     # All indicator maths (client-side, pure functions)
        ├── state_store.js    # localStorage persistence + server sync (_syncToServer patch)
        ├── alert_engine.js   # Generic alert engine — browser notifications + Telegram
        ├── pane.js           # ChartPane class — chart, drawings, indicators, state, alerts
        └── app.js            # Orchestrator — grid, socket, flyouts, notes, layout memory

# AI Analysis pipeline (separate project, same machine):
forex_automation/
├── run_analysis.py           # Main runner — captures charts, calls Claude, saves report, sends Telegram
├── snapshot_runner.py        # JT snapshot client — drop-in replacement for mcp_client.py
├── config.py                 # Central config loader from .env
└── .env                      # ANTHROPIC_API_KEY, PAIRS, TIMEFRAMES, etc.
```

---

## Snapshot System — Architecture

### Overview
Joshua Terminal replaces the TradingView MCP/CDP pipeline with a self-contained headless rendering system. Playwright controls a plain-HTTP sidecar server (wsgiref, random free port) that serves the same Flask app, navigates to `/snapshot`, injects saved drawing state, and screenshots the fully-rendered chart.

### Flow
```
snapshot_runner.py
  → POST /api/snapshot (HTTPS main server)
    → Flask: _do_snapshot()
      → reads snapshot_state.json for symbol's drawings/indicators
      → starts plain-HTTP sidecar (first call only, cached)
      → Playwright navigates to http://127.0.0.1:<sidecar_port>/snapshot?symbol=...
      → injects state via page.add_init_script() BEFORE page JS runs
      → waits for window.__SNAPSHOT_READY__ === true
      → page.evaluate() applies 8-bar right offset
      → page.wait_for_timeout(600ms) for canvas overlays to paint
      → screenshots #snapshot-chart-wrap
      → saves to snapshots/<SYMBOL>_<interval>_<ts>.png
      → cleans up PNGs older than SNAPSHOT_KEEP_DAYS (default 7)
      → returns { ok, file, path, base64, has_saved_state, ... }
  → snapshot_runner collects base64 images
  → run_analysis.py sends all images to Claude API with analysis prompt
  → saves report to reports/ + sends via Telegram
```

### Why plain-HTTP sidecar
When Flask runs with SSL (HTTPS/mkcert), Playwright's headless Chromium gets `ERR_CONNECTION_RESET` navigating to `https://localhost` due to self-signed cert handling. The wsgiref sidecar runs plain HTTP on a random free port (`127.0.0.1` only), completely bypassing SSL while serving the identical Flask app.

### State bridge (localStorage → server)
Playwright runs in an isolated browser profile with empty localStorage. The bridge:
- **Save path:** `state_store.js` `saveDrawings()` → `localStorage` + fire-and-forget `POST /api/state/save` → `snapshot_state.json`
- **Load path:** `_do_snapshot()` reads `snapshot_state.json` → `page.add_init_script()` injects `window.__SNAPSHOT_STATE__` → `snapshot.html` writes to `localStorage` before `ChartPane` initialises
- **Migration:** paste `migrate_state.js` in browser console once to export existing localStorage to server

### snapshot.html
- No socket, no toolbar, no ticker — pure chart render
- 1600×900px fixed size
- Reads `?symbol`, `?interval`, `?source`, `?days` from URL
- Polls `pane.candles.length > 0` then sets `window.__SNAPSHOT_READY__ = true`
- Right offset applied by Playwright `page.evaluate()` AFTER ready (avoids race with indicator renders that call `fitContent()`)

### snapshot_routes.py — endpoints
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/state/<symbol>` | GET | Return saved state blob for symbol |
| `/api/state/save` | POST | Write state blob to snapshot_state.json |
| `/api/state/list` | GET | List all symbols with saved state |
| `/api/state/export` | GET | Dump full state file |
| `/api/snapshot` | POST | Capture one chart, return PNG + base64 |
| `/api/snapshot/batch` | POST | Capture multiple charts in one call |
| `/api/snapshot/list` | GET | List all PNG files in snapshots/ |
| `/snapshots/<file>` | GET | Serve a snapshot PNG |
| `/snapshot` | GET | The headless chart page (template) |

### Auto-cleanup
- Default: keep 7 days of PNGs
- Override: `SNAPSHOT_KEEP_DAYS=3` in `.env` (0 = disable)
- Runs automatically after each successful capture
- At 8 charts/run daily ≈ 56 PNGs max on disk

### snapshot_runner.py — key details
- Drop-in replacement for `mcp_client.fetch_all_charts()`
- Returns identical `(charts, live_prices)` tuple
- Auto-detects JT URL: tries HTTPS first, falls back to HTTP, caches result
- All requests use `verify=False` for self-signed certs
- Warns clearly if no saved state exists for a symbol (`has_saved_state: False`)
- Timeframe mapping: `"4H" → "4h"`, `"15" → "15m"` etc.
- Symbol mapping: `"PEPPERSTONE:EURUSD" → "EUR/USD"`
- View range: 90 days for 4H, 5 days for 15M (matches original `reset_chart_view()`)

---

## Completed Features (all working)

### Core
- ✅ Multi-pane grid — 1, 2, 4, 6, 8 panes, each fully independent
- ✅ Live forex prices via OANDA v20 streaming
- ✅ Live crypto prices via Hyperliquid WebSocket (allMids)
- ✅ yfinance polling fallback (5s interval) when no OANDA key
- ✅ Colour-coded ticker bar with flash-up/flash-down animation
- ✅ Candle countdown timer — `.ticker-countdown` span in ticker bar, driven by `_startCandleCountdown()` / `_stopCandleCountdown()` / `_formatCountdown()` in `pane.js`; restarts on every `_renderCandles()` call (i.e. on load and interval change); adaptive format: MM:SS (≤15m), `Xh YYm` (30m–12h), `Xh YYm` (1D), `Xd Yh` (1W); pulses amber (`.countdown-urgent`) when remaining time ≤ 10% of candle duration
- ✅ World clock (UTC, NY, London, Tokyo) + market session indicator
- ✅ Symbol autocomplete dropdown (Majors/Minors/Exotics/Metals/Indices/Crypto)
- ✅ Fullscreen mode, dark/light theme toggle, multi-monitor support
- ✅ Screenshot/export — composites all canvas layers, downloads as PNG
- ✅ Connection status dots — MT5, HL, YF, OANDA (all independent, correctly driven)
- ✅ Live candle advance — `onPriceUpdate()` detects bar boundary

### MT5 Multi-Source Data Layer
- ✅ `mt5_bridge.py` — standalone read-only HTTP bridge for Windows/MT5 machine; MIT licensed
  - `GET /health` — bridge + MT5 terminal status
  - `GET /price?symbol=EURUSD` — live bid/ask/mid (250ms tick cache, background poller)
  - `GET /candles?symbol=EURUSD&interval=1h&limit=300` — OHLCV oldest-first (LWC format)
  - `GET /symbols?q=EUR` — broker symbol discovery
  - Works same-machine (localhost) or over LAN — no config change on bridge side
  - `threaded=True` Flask mode — slow MT5 calls never block other requests
  - `symbol_select()` deferred to poller thread, never on request thread (avoids timeout)
- ✅ `data_source.py` — MT5 as top-priority source: **mt5 → oanda → yfinance**
  - `mt5_get_price()` / `mt5_get_candles()` — HTTP calls to bridge with fallback chain
  - `mt5_is_connected()` — health check for status dot polling
  - `MT5_ENABLED`, `MT5_BRIDGE_HOST`, `MT5_BRIDGE_PORT` env vars
- ✅ `app.py` — `mt5_poll_loop` daemon thread; emits `mt5_price` via SocketIO every 500ms
- ✅ Per-pane source freedom — all four sources independently selectable per chart pane
  - Source dropdown: MetaTrader 5 / OANDA / Yahoo Finance / Hyperliquid (Crypto)
  - `subscribe_yf` / `unsubscribe_yf` route by **pane source** (not global `ACTIVE_FOREX_SOURCE`)
  - Pane sends `{ symbol, source }` in socket payload — server routes to correct stream
  - Mix MT5 + OANDA + YF + Hyperliquid panes simultaneously with no cross-contamination
- ✅ MT5 status dot — polls `/api/mt5/status` every 10s; green=connected, red=unreachable
- ✅ OANDA dot — correctly turns green when `has_oanda_key` is true (was always grey before)

### Snapshot / AI Analysis Pipeline
- ✅ `POST /api/snapshot` — Playwright headless render of full JT chart
- ✅ `POST /api/state/save` — server-side state persistence bridge
- ✅ `state_store.js` patched — every SAVE click syncs to `snapshot_state.json`
- ✅ Plain-HTTP sidecar — bypasses SSL for Playwright regardless of JT HTTPS config
- ✅ State injection via `page.add_init_script()` — drawings appear in snapshots
- ✅ Right-side offset (8 bars) applied via `page.evaluate()` post-render
- ✅ Auto-cleanup of old PNGs (configurable, default 7 days)
- ✅ `snapshot_runner.py` — HTTPS→HTTP auto-detection, `verify=False`, clear warnings
- ✅ `migrate_state.js` — one-time browser console export of existing localStorage

### Candle Colour Configuration
- ✅ Configurable — Bull/Bear Fill, Border, Wick (6 pickers in DRAW flyout)
- ✅ ⊘ transparent toggle on Bull Fill and Bear Fill for hollow candles
- ✅ Persisted to `localStorage` key `candleColors` (global)
- ⚠️ LWC does not accept `'transparent'` — resolved to `'rgba(0,0,0,0)'`

### Interval Switch — Candle Alignment (CRITICAL)
- ✅ `candleSeries` is recreated on every `_renderCandles()` call
- ✅ Fixes LWC v4 bar spacing confusion when switching intervals
- ⚠️ Do NOT "optimise" this away — the recreation is intentional

### Bar Spacing Persistence
- ✅ Keyed per symbol + interval — `barSpacing:SYMBOL:INTERVAL`
- ✅ Each timeframe has its own independent zoom level

### State Persistence
- ✅ `state_store.js` — key schema `cs:EURUSD`
- ✅ Drawings shared across ALL intervals for a symbol
- ✅ Indicators saved per symbol+interval
- ✅ `_drawingsRestored` flag prevents duplication on interval switches
- ✅ `_syncToServer()` — fire-and-forget POST to `/api/state/save` on every save

### Drawing Tools
- ✅ Fibonacci, Trendlines, Horizontal/Vertical lines, Long/Short position blocks
- ✅ Lock toggle (🔓/🔒) on all drawing panels — persisted in save state
- ✅ Click any line to reopen its panel

### Indicators (29+)
- ✅ SMA/EMA (20/50/200), VWAP, VWMA
- ✅ Bollinger, Donchian, Keltner
- ✅ Supertrend, Ichimoku, Parabolic SAR, Pivot Points
- ✅ Volume, RSI, MACD, Stochastic, Stoch RSI, ATR, ADX, CCI, CMF, OBV, MFI, Williams %R, Momentum
- ✅ RSI Divergence (subpane) — regular + hidden bull/bear divergences via pivot logic, LWC markers
- ✅ S/D Zones & Auto Fib (canvas), Order Blocks (canvas), Fair Value Gap / FVG (canvas)

---

## app.py — Snapshot Registration Pattern
```python
from snapshot_routes import snapshot_bp, init_app as _snapshot_init
app.register_blueprint(snapshot_bp)
_snapshot_init(app)   # starts plain-HTTP sidecar on a free port at startup
```

## state_store.js — Server Sync Patch
```javascript
function saveDrawings(symbol, drawings, fibLevels) {
  const blob = _load(symbol) || _empty();
  blob.drawings  = drawings;
  blob.fibLevels = fibLevels;
  const ok = _save(symbol, blob);
  if (ok) _syncToServer(symbol, blob);  // ← added line
  return ok;
}
```

## snapshot.html — Ready Signal Pattern
```javascript
// Poll until candles loaded, then signal Playwright
function _poll() {
  const pane = window._snapPane;
  if (pane && pane.candles && pane.candles.length > 0) {
    setTimeout(() => {
      // view range set here (logical bar indices, not timestamps)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(_signalReady, 300);
      }));
    }, 500);
  } else { setTimeout(_poll, 100); }
}
```

## snapshot_routes.py — Right Offset Pattern
```python
# Applied in Playwright AFTER __SNAPSHOT_READY__ fires
# Avoids race with indicator renders that call fitContent()
page.evaluate("""() => {
    const pane = window._snapPane;
    const ts   = pane.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    ts.setVisibleLogicalRange({ from: range.from, to: pane.candles.length - 1 + 8 });
}""")
page.wait_for_timeout(600)  # canvas overlay settle time
```

---

## localStorage Key Reference
| Key | Value | Set by |
|---|---|---|
| `cs:SYMBOL` | JSON state blob | state_store.js |
| `notes:SYMBOL` | JSON notes array | app.js |
| `theme` | `'dark'` or `'light'` | app.js |
| `chartTimezone` | IANA tz string | app.js |
| `barSpacing:SYMBOL:INTERVAL` | number (pixels per bar) | pane.js |
| `candleColors` | JSON colour object | pane.js |
| `paneLayout_N` | JSON pane config array | app.js |
| `chartCount` | number | app.js |
| `joshua_anthropic_key` | API key string | pine-converter.html |

---

## Environment Variables
```bash
# Joshua Terminal (.env in JT folder)
OANDA_API_KEY=your_token_here
OANDA_ACCOUNT_ID=your_account_id
OANDA_ENV=practice          # or live
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=-123456789
SSL_CERT=localhost.pem      # optional — enables PWA standalone mode
SSL_KEY=localhost-key.pem
SNAPSHOT_KEEP_DAYS=7        # optional — days to retain snapshot PNGs (0 = keep forever)

# MT5 Bridge — optional, enables MetaTrader 5 as primary price source
MT5_ENABLED=true
MT5_BRIDGE_HOST=192.168.1.20   # LAN IP of Windows MT5 machine, or localhost
MT5_BRIDGE_PORT=5006

# Analysis pipeline (.env in forex_automation folder)
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-opus-4-5
PAIRS=PEPPERSTONE:EURUSD,PEPPERSTONE:AUDJPY,PEPPERSTONE:GBPUSD,PEPPERSTONE:USDJPY
TIMEFRAMES=4H,15
REPORT_DIR=./reports
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=-123456789
JT_BASE_URL=                # optional — override auto-detected JT URL
JT_PORT=5050                # optional — override default port
SNAPSHOT_KEEP_DAYS=7        # optional — passed through to JT
```

---

## Bucket List (future sessions)
- [ ] **Web search in analysis** — add `web_search` tool to `client.messages.create()` in `run_analysis.py`
- [ ] **Telegram inline images** — send PNGs alongside analysis text
- [ ] **Scheduled auto-run** — scheduler config in `config.py` already exists, needs wiring
- [ ] **Order Blocks params UI** — inputRange, BOS visibility, mitigated block toggle
- [ ] **Replay mode** — needs historical data strategy
- [ ] **Indicator alerts** — AlertEngine.trigger() already generic, need RSI/MACD crossing calls
- [ ] **Notes export** — download as CSV or PDF
- [ ] **Candle colours in popout** — popout.html has its own `openDrawFlyout()` needing candle style section

---

## MT5 Bridge — Architecture Notes

### Why a separate bridge process
The `MetaTrader5` Python package is Windows-only (IPC to the MT5 terminal process). `mt5_bridge.py` runs on the Windows machine and exposes a plain HTTP API so JT (on any OS) can consume MT5 data without platform constraints.

### Tick polling vs streaming
MT5's Python API is poll-based — there is no push/callback. `mt5_bridge.py` runs a 250ms background thread that polls `symbol_info_tick()` for all subscribed symbols and caches the latest tick. `/price` responses are served from cache and are effectively instant. `app.py`'s `mt5_poll_loop` polls `/price` every 500ms and emits `mt5_price` via SocketIO.

### symbol_select() placement (critical)
`mt5.symbol_select(symbol, True)` can block for several seconds when a symbol isn't in Market Watch (broker round-trip). It must **never** be called on the Flask request thread — this causes timeouts. It is called only in the poller thread where blocking is safe. The request thread tries `symbol_info_tick()` directly first, and only calls `symbol_select()` as a one-time fallback on first request for an unknown symbol.

### Per-pane source routing
`subscribe_yf` / `unsubscribe_yf` SocketIO events now carry `{ symbol, source }`. The server routes based on `source`:
- `"mt5"` → `mt5_subs` dict (polled by `mt5_poll_loop`)
- `"oanda"` → `OandaStreamManager` (persistent HTTP stream)
- anything else → `yf_subs` dict (polled by `poll_loop`)

This allows any combination of sources across panes simultaneously.

### Multiple MT5 installs
Run multiple bridge instances on different ports — one per MT5 terminal install:
```bash
python mt5_bridge.py --path "C:\Users\ss\AppData\Local\Demo\terminal64.exe" --port 5006
python mt5_bridge.py --path "C:\Users\ss\AppData\Local\Live\terminal64.exe" --port 5007
```
Point JT at whichever port via `MT5_BRIDGE_PORT` in `.env`.

---

## Known Quirks
- Sub-pane oscillators not scroll-synced on load — sync after first scroll (LWC limitation)
- yfinance data has ~15min delay on forex. OANDA streaming is real-time
- `candleSeries` recreated on every `_renderCandles()` — intentional, do not optimise away
- LWC `setVisibleRange()` with future timestamps does NOT create right-side empty space — use `setVisibleLogicalRange()` with bar indices beyond `count - 1` instead
- `page.evaluate()` offset must run AFTER `__SNAPSHOT_READY__` — indicator renders call `fitContent()` which overwrites any earlier range set
- `current_app._get_current_object()` inside threads is unreliable — the wsgiref sidecar gets the app object at startup via `init_app(app)`, not via Flask context proxy
- Python 3.9 does not support `int | None` union syntax — use `Optional[int]` from `typing`
- Playwright self-signed cert issue is solved by the sidecar, not by `ignore_https_errors`
- `snapshot_state.json` and `snapshots/` folder should be in `.gitignore`

---

## Running the App
```bash
cd joshua_terminal
pip install -r requirements.txt
pip install playwright && playwright install chromium   # for snapshot system
cp .env.example .env   # then fill in your keys
python app.py
# → https://localhost:5050 (if SSL certs present) or http://localhost:5050
```

Debug: `http://localhost:5050/debug`
Snapshot list: `https://localhost:5050/api/snapshot/list`
State list: `https://localhost:5050/api/state/list`

## Running the Analysis Pipeline
```bash
cd forex_automation
python run_analysis.py --dry-run --save-screenshots   # verify charts first
python run_analysis.py                                # full run with Claude analysis
```

---

## FVG — Fair Value Gap Implementation Notes

### What it detects
Three-candle imbalance pattern (LuxAlgo-style):
- **Bullish FVG:** `candle[0].low > candle[2].high` — gap between current candle's low and two-bars-ago high
- **Bearish FVG:** `candle[0].high < candle[2].low` — gap between current candle's high and two-bars-ago low
- Threshold filter: gap must exceed `thresholdPer %` of price (or auto-calculated avg bar range)

### Mitigation
- Bullish FVG mitigated when `close < fvg.min` (price closes below gap bottom)
- Bearish FVG mitigated when `close > fvg.max` (price closes above gap top)
- Mitigated zones fade to 12% opacity (from 22%) and show dashed border line

### Canvas rendering
- z-index 9 (above Order Blocks at z-index 8)
- Zones extend `EXTEND_BARS = 20` bars forward for unmitigated FVGs
- Mitigated FVGs extend only to the mitigated candle's time
- Labels: `FVG ▲` / `FVG ▼` + price range shown when zone height > 8px
- Dynamic mode: horizontal lines at current dynamic bull/bear levels (`FVG DYN ▲/▼`)

### Parameters (hardcoded defaults in _addIndicator case)
| Param | Default | Description |
|---|---|---|
| thresholdPer | 0 | Min gap size as % of price (0 = any gap) |
| autoThreshold | false | Auto-calculate threshold from avg bar range |
| showLast | 0 | 0 = all FVGs, N = N most-recent unmitigated only |
| dynamic | false | Show dynamic level lines at current price |

### Key files changed
- `static/js/indicators.js` — `fvgLuxAlgo()` function added + exported
- `static/js/pane.js` — INDICATOR_DEFS entry, `_addIndicator` case, `_removeIndicator` branch, `_initFvgCanvas()`, `_fvgRender()`

---

## Candle Countdown Timer — Implementation Notes

### What it does
Displays a live countdown to the next candle close in the ticker bar, immediately to the left of the clock. Format adapts to the active timeframe so the display is always readable without being noisy.

### Format rules
| Timeframe | Format | Example |
|---|---|---|
| ≤ 15m | `MM:SS` | `04:23` |
| 30m – 12h | `Xh YYm` or `YYm ZZs` | `1h 23m` / `45m 07s` |
| 1D | `Xh YYm` | `14h 32m` |
| 1W | `Xd Yh` | `2d 14h` |

### Urgency state
When remaining time ≤ 10% of the full candle duration (e.g. last 30s of a 5m candle, last 24min of a 4H candle), the `.countdown-urgent` class is toggled on — changes colour to `var(--gold)` and applies a 1s opacity pulse animation.

### Architecture
- `_startCandleCountdown()` — clears any existing timer, starts `setInterval(tick, 1000)`; called at end of `_renderCandles()` so it restarts automatically on load and interval changes
- `_stopCandleCountdown()` — clears `this._countdownTimer`; called at top of `_startCandleCountdown()` to prevent stacking
- `_formatCountdown(remSec, intervalMs)` — pure formatter, returns display string
- Ticker HTML: `.ticker-countdown` span + `.ticker-time-sep` separator (`·`) already present in `_buildHTML()` template

### Key files changed
- `static/js/pane.js` — `_startCandleCountdown()`, `_stopCandleCountdown()`, `_formatCountdown()` methods added; `this._startCandleCountdown()` call added at end of `_renderCandles()`
- `static/css/style.css` — `.ticker-countdown`, `.ticker-countdown.countdown-urgent`, `@keyframes countdown-pulse`, `.ticker-time-sep` rules added

---

## RSI Divergence — Implementation Notes

### What it does
Detects regular and hidden RSI divergences using pivot point logic and renders them in a subpane alongside the RSI line and 30/50/70 reference levels.

### Detection logic
- A pivot low (high) is confirmed when the RSI value at index `i` is lower (higher) than all values within `lbL` bars left and `lbR` bars right
- Consecutive pivots are compared only if they fall within `[minLookbackRange, maxLookbackRange]` bars of each other
- **Regular Bullish:** RSI higher low + price lower low | **Regular Bearish:** RSI lower high + price higher high
- **Hidden Bullish:** RSI lower low + price higher low | **Hidden Bearish:** RSI higher high + price lower high
- Pine Script `offset` plotting simulated by using `data[i + lbR].time` for marker timestamps

### Rendering
- RSI line: `#2962FF`, lineWidth 2
- Reference lines at 70 (red tint), 50 (grey tint), 30 (green tint)
- Divergence markers via LWC `setMarkers()` on the RSI series — circles above/below bar with text labels
- Hidden divergences use semi-transparent colours; disabled by default

### Key files changed
- `static/js/indicators.js` — `rsiDivergence()` added inside IIFE, exported in return statement; calls internal `rsi()` directly
- `static/js/pane.js` — `{ id: "rsi_divergence", label: "RSI Divergence", color: "#2962FF", type: "subpane" }` added to Oscillators group in `INDICATOR_DEFS`; `case 'rsi_divergence':` added to `_addSubPane()` switch
- `_removeIndicator()` — no changes needed; subpane cleanup handled by existing generic `this.subPanes[id]` block
