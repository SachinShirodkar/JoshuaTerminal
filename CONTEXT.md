# Joshua Terminal — Claude Context File
_Last updated: Snapshot System — Playwright-based headless chart capture replacing TradingView MCP pipeline_

---

## Project Name
**Joshua Terminal** (formerly "Trading Terminal") — a free, self-hosted, multi-chart trading dashboard with integrated AI analysis pipeline.

---

## Stack
| Layer | Technology |
|---|---|
| Backend | Python 3.9+, Flask, Flask-SocketIO (threading mode), python-dotenv |
| Frontend | Vanilla JS (no framework), Lightweight Charts v4.1.3 |
| Forex live prices | OANDA v20 REST + HTTP streaming (primary) |
| Crypto live prices | Hyperliquid WebSocket (allMids) |
| Forex candles fallback | yfinance (when no OANDA key) |
| Styling | Plain CSS with CSS variables, JetBrains Mono + Syne fonts |
| Alerts | Browser Web Notifications API + Telegram Bot API |
| Snapshot rendering | Playwright (headless Chromium) |
| AI analysis | Anthropic Claude API (vision) |

---

## File Structure
```
joshua_terminal/
├── app.py                    # Flask backend + SocketIO + OANDA stream + HL WS + alert endpoint
│                             # + registers snapshot_bp + starts HTTP sidecar via init_app()
├── data_source.py            # Pluggable data layer — OANDA v20, yfinance fallback
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
- ✅ World clock (UTC, NY, London, Tokyo) + market session indicator
- ✅ Symbol autocomplete dropdown (Majors/Minors/Exotics/Metals/Indices/Crypto)
- ✅ Fullscreen mode, dark/light theme toggle, multi-monitor support
- ✅ Screenshot/export — composites all canvas layers, downloads as PNG
- ✅ Connection status dots — HL, YF, OANDA
- ✅ Live candle advance — `onPriceUpdate()` detects bar boundary

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

### Indicators (27+)
- ✅ SMA/EMA (20/50/200), VWAP, VWMA
- ✅ Bollinger, Donchian, Keltner
- ✅ Supertrend, Ichimoku, Parabolic SAR, Pivot Points
- ✅ Volume, RSI, MACD, Stochastic, Stoch RSI, ATR, ADX, CCI, CMF, OBV, MFI, Williams %R, Momentum
- ✅ S/D Zones & Auto Fib (canvas), Order Blocks (canvas)

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
