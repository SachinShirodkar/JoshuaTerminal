# Joshua Terminal — Claude Context File
_Last updated: session adding Order Blocks indicator, popout flyouts, live candle advance, timezone picker, bar spacing persistence, right-side offset_

---

## Project Name
**Joshua Terminal** (formerly "Trading Terminal") — a free, self-hosted, multi-chart trading dashboard.

---

## Stack
| Layer | Technology |
|---|---|
| Backend | Python 3.10+, Flask, Flask-SocketIO (threading mode), python-dotenv |
| Frontend | Vanilla JS (no framework), Lightweight Charts v4.1.3 |
| Forex live prices | OANDA v20 REST + HTTP streaming (primary) |
| Crypto live prices | Hyperliquid WebSocket (allMids) |
| Forex candles fallback | yfinance (when no OANDA key) |
| Styling | Plain CSS with CSS variables, JetBrains Mono + Syne fonts |
| Alerts | Browser Web Notifications API + Telegram Bot API |

---

## File Structure
```
joshua_terminal/
├── app.py                  # Flask backend + SocketIO + OANDA stream + HL WS + alert endpoint
├── data_source.py          # Pluggable data layer — OANDA v20, yfinance fallback
├── requirements.txt
├── .env                    # OANDA + Telegram credentials (not committed to git)
├── .env.example            # Template for .env
├── Indicators.md           # Log of all Pine Script indicators converted to JS (with notes)
├── templates/
│   ├── index.html          # Single-page shell — topbar, grid, flyouts, panels, scripts
│   ├── popout.html         # Standalone chart window for multi-monitor popout
│   └── pine-converter.html # Pine Script → Joshua Terminal converter tool (standalone, API-key modal)
└── static/
    ├── css/
    │   └── style.css       # All styles — CSS vars, light/dark theme, pane, toolbar, flyouts, panels
    └── js/
        ├── indicators.js   # All indicator maths (client-side, pure functions)
        ├── state_store.js  # localStorage persistence layer
        ├── alert_engine.js # Generic alert engine — browser notifications + Telegram
        ├── pane.js         # ChartPane class — chart, drawings, indicators, state, alerts
        └── app.js          # Orchestrator — grid, socket, flyouts, notes, layout memory
```

---

## Completed Features (all working)

### Core
- ✅ Multi-pane grid — 1, 2, 4, 6, 8 panes, each fully independent
- ✅ Live forex prices via OANDA v20 streaming (HTTP newline-delimited JSON)
- ✅ Live crypto prices via Hyperliquid WebSocket (allMids)
- ✅ yfinance polling fallback (5s interval) when no OANDA key
- ✅ Colour-coded ticker bar with flash-up/flash-down animation
- ✅ World clock (UTC, NY, London, Tokyo) + market session indicator
- ✅ Symbol autocomplete dropdown (Majors/Minors/Exotics/Metals/Indices/Crypto groups)
- ✅ Fullscreen mode
- ✅ **Dark/light theme toggle** — ☾/☀ button in topbar, persists via localStorage, updates chart colours
- ✅ **Multi-monitor support** — two modes:
  - Pane popout (⧉ in pane toolbar) → `/popout?symbol=&interval=&source=` in new window on second screen
  - Full terminal (⧉ in topbar) → opens complete second Joshua Terminal instance on second screen
- ✅ **Screenshot/export** — 📷 button per pane, composites all canvas layers (chart + OB + SD zones + trendlines + positions), downloads as `SYMBOL_INTERVAL_DATE.png`
- ✅ **Connection status dots** — HL, YF, OANDA dots in topbar; OANDA lights green on first price tick
- ✅ **Live candle advance** — `onPriceUpdate()` detects when the current bar's interval has elapsed and opens a new candle with the correct boundary timestamp instead of continuing to update the old bar. `_intervalToMs()` helper maps all 12 interval strings.

### Timezone
- ✅ **Chart timezone picker** — 🕐 button in topbar opens a flyout with 8 timezone options (UTC, NY, London, Frankfurt, Dubai, Singapore, Tokyo, Sydney)
- ✅ Selection persists via `localStorage` key `chartTimezone`
- ✅ Applies to **all open panes** simultaneously via `pane.applyTimezone(tz)`
- ✅ New panes and popouts read `chartTimezone` from localStorage on init — always open in the saved timezone
- ✅ **Bottom axis labels** controlled by `tickMarkFormatter` on `timeScale` — receives raw UTC timestamp, formats in target tz via `Intl`. This is the correct LWC v4 API for axis labels.
- ✅ **Crosshair tooltip** controlled by `localization.timeFormatter` — separate formatter, same tz logic
- ✅ **Ticker time** in pane toolbar uses `toLocaleString()` with the saved tz
- ✅ `_makeTickMarkFormatter(tz)` — handles Year/Month/DayOfMonth/Time tick types
- ✅ `_makeTzFormatter(tz)` — formats crosshair timestamps
- ⚠️ Do NOT use timestamp-shifting to implement timezone. LWC renders axis using browser local time from raw timestamps — shifting causes mismatch between axis and crosshair. Use `tickMarkFormatter` + `timeFormatter` only.

### Chart View Persistence
- ✅ **Bar spacing (candle width) persisted per symbol** — `localStorage` key `barSpacing:SYMBOL`
- ✅ Auto-saved on every zoom/scroll via `subscribeVisibleLogicalRangeChange`
- ✅ Restored on every `_renderCandles()` call — survives timeframe switches, symbol switches, and page reload
- ✅ **Right-side offset** — `_applyRightOffset(bars=15)` extends the visible range 15 bars past the last candle on every data load so the last candle is never flush against the price scale

### Pine Script Converter Tool
- ✅ Standalone HTML tool served at `http://localhost:5050/tools/pine-converter`
- ✅ Calls Anthropic API directly from browser (`claude-sonnet-4-5`) with `anthropic-dangerous-direct-browser-access: true`
- ✅ API key stored in `localStorage` as `joshua_anthropic_key`
- ✅ Output tabs: `indicators.js` function, `INDICATOR_DEFS` entry, `_addIndicator` case, `_addSubPane` case, Notes
- ⚠️ Converter generates correct **math** but may hallucinate rendering APIs for complex visual types (boxes, canvas). Always validate `_addIndicator` case against actual pane.js patterns before use.
- ⚠️ `_addIndicator(id)` receives only a string ID — there is NO `indicator` object or `indicator.params`. Use hardcoded defaults directly in the case, matching all other indicators in the codebase.

### Indicators (27+, all client-side maths in indicators.js)
- ✅ SMA 20/50/200, EMA 20/50/200, VWAP, VWMA 20 (overlay)
- ✅ Bollinger Bands, Donchian Channel, Keltner Channel (bands)
- ✅ Supertrend (10,3), Ichimoku Cloud (9/26/52), Parabolic SAR, Pivot Points (overlay/trend)
- ✅ Volume, RSI, MACD, Stochastic, Stoch RSI, ATR, ADX, CCI, CMF, OBV, MFI, Williams %R, Momentum (sub-pane oscillators)
- ✅ **S/D Zones & Major Structure Auto Fib** (overlay, canvas-rendered) — see Indicators.md
- ✅ **Order Blocks** (overlay, canvas-rendered) — see below

### Order Blocks Indicator
- ✅ Added to `indicators.js` as `orderBlocks(data, inputRange, showBearishBOS, showBullishBOS, useMitigatedBlocks)`
- ✅ Detects Break of Structure (BOS) using rolling highest/lowest over `inputRange` bars
- ✅ Returns `{ bullishBlocks, bearishBlocks, bosLines }` — all mitigated blocks tracked
- ✅ Rendered via `_obCanvas` overlay (z-index 8) — `_initObCanvas()` / `_obRender()`
- ✅ Bearish OBs: gold fill (`rgba(219,166,50,0.07)`) with gold border, `OB ▼` label
- ✅ Bullish OBs: green fill (`rgba(192,230,174,0.07)`) with green border, `OB ▲` label
- ✅ Mitigated blocks fade to grey (`rgba(207,203,202,0.08)`)
- ✅ BOS lines: dashed horizontal, colour-coded red/green, `BOS` label
- ✅ Blocks extend to canvas right edge (matches Pine Script `extend.right` behaviour)
- ✅ Sentinel: `'__ob_canvas__'` in `indicatorSeries` — cleaned up in `_removeIndicator()`
- ✅ Screenshot compositing: `_obCanvas` drawn before trendline/position canvases in `_takeScreenshot()`
- ⚠️ Parameters (inputRange, BOS visibility, mitigated blocks) are hardcoded defaults — no params UI yet

### Drawing Tools (all in pane.js)
- ✅ Fibonacci retracement, Trendlines, Horizontal lines, Vertical lines
- ✅ Long/Short position blocks with live risk calculator
- ✅ Clear All Drawings action
- ✅ Auto-exit drawing mode after placement
- ✅ Drawing flyout auto-closes after any tool completes

### Popout Window (popout.html)
- ✅ Full indicator flyout — `openFlyout()` dynamically builds from `window.INDICATOR_DEFS`
- ✅ Full drawing tools flyout — `openDrawFlyout()` with all 6 tools + Clear All
- ✅ Both flyouts share `flyout-backdrop` and close on backdrop click
- ✅ **Live price routing** — `socket.on('hl_mids')`, `socket.on('oanda_price')`, `socket.on('yf_price')` all wired to `pane.onPriceUpdate()` (mirrors app.js — popout does not load app.js)
- ✅ Timezone, bar spacing, right offset all work identically in popout (read from same localStorage)
- ⚠️ Flyout panels (`indicator-flyout`, `drawing-flyout`, `flyout-backdrop`) are embedded directly in `popout.html` — they are NOT inherited from `index.html`

### Alert System
- ✅ `alert_engine.js` — generic singleton, 60s cooldown per level
- ✅ Browser Web Notifications + Telegram Bot API
- ✅ Alert toggle on horizontal lines
- ✅ Price cross detection in `onPriceUpdate()`
- ✅ Alert state persisted with hline in state_store

### State Persistence
- ✅ `state_store.js` — key schema `cs:EURUSD`
- ✅ Drawings shared across ALL intervals for a symbol
- ✅ Indicators saved per symbol+interval
- ✅ Bar spacing saved per symbol (`barSpacing:SYMBOL`)
- ✅ Chart timezone saved globally (`chartTimezone`)
- ✅ Custom fib levels saved per symbol
- ✅ Save button with amber pulsing dot for unsaved changes
- ✅ Auto-restore on page load / interval switch / symbol switch
- ✅ Saved States manager (💾 topbar button)

---

## Data Flow

### Candles
```
Browser → GET /api/candles?symbol=EUR/USD&interval=15m&source=oanda&limit=400
→ app.py → data_source.py → OANDA v20 REST or yfinance
→ JSON [{time, open, high, low, close, volume}, ...]
→ pane.js → candleSeries.setData() → _restoreState()
```

### Live prices (OANDA)
```
pane.js → socket.emit('subscribe_yf', {symbol})
→ app.py → OandaStreamManager.subscribe()
→ HTTP streaming /v3/accounts/{id}/pricing/stream
→ socketio.emit('oanda_price', {symbol, price, bid, ask, dir, change})
→ pane.js onPriceUpdate() → bar advance check → ticker update + hline alert check
```

### Popout price routing
```
socket.on('hl_mids' / 'oanda_price' / 'yf_price')
→ popout.html inline handlers (normalised symbol match)
→ pane.onPriceUpdate()
```

---

## Key Implementation Details

### pane.js — ChartPane class
- Chart init deferred until ResizeObserver fires
- Drawing layer = transparent `<div>` overlay, z-index 5
- Position blocks canvas at z-index 6
- S/D Zones canvas (`_sdCanvas`) at z-index 7
- Order Blocks canvas (`_obCanvas`) at z-index 8
- Trendline/hline/vline canvas (`_trendCanvas`) at z-index 9
- `applyTheme(chartBg, chartText, subText)` — updates LWC layout options on all sub-panes
- `applyTimezone(tz)` — updates `tickMarkFormatter` + `timeFormatter` on all charts/subpanes

### Canvas-rendered indicators (pane.js pattern)
Indicators requiring filled zones use a dedicated `<canvas>` layer:
- Create in `_init<Name>Canvas()`, append to `chartEl`, appropriate z-index
- Subscribe to `timeScale().subscribeVisibleLogicalRangeChange()` + `subscribeCrosshairMove()`
- Use `timeScale().timeToCoordinate(t)` for X, `candleSeries.priceToCoordinate(p)` for Y
- Store canvas ref as `this._<name>Canvas`, data as `this._<name>Data`
- Sentinel string in `indicatorSeries` (e.g. `'__ob_canvas__'`) — cleaned up in `_removeIndicator()`
- Add canvas to screenshot compositing in `_takeScreenshot()` before trendline canvas

### Timezone implementation (CRITICAL — do not revert)
- **Axis labels**: `timeScale().applyOptions({ tickMarkFormatter })` — receives raw UTC unix timestamp, formats in target tz
- **Crosshair**: `chart.applyOptions({ localization: { timeFormatter } })` — same approach
- **DO NOT shift timestamps** — shifting causes axis/crosshair mismatch across different browser timezones
- `_makeTickMarkFormatter(tz)` handles all 5 LWC tick types (Year/Month/Day/Time/TimeWithSeconds)

### Live candle bar advance
`onPriceUpdate()` checks `Date.now()` against `last.time + intervalMs` on every tick. If elapsed, calculates the correct new bar boundary time using `Math.floor((nowSec - last.time) / barDurSec) * barDurSec + last.time` to handle gaps. `_intervalToMs()` maps 12 interval strings.

### Bar spacing persistence
- `_saveBarSpacing()` — called on every `subscribeVisibleLogicalRangeChange`, saves `timeScale().options().barSpacing` to `localStorage`
- `_loadBarSpacing()` — called in `_renderCandles()`, restores spacing or falls back to `fitContent()`
- `_applyRightOffset(bars=15)` — extends visible range 15 bars past last candle on every render

### alert_engine.js
- Cooldown map keyed by `symbol:level:direction` — 60s silence after firing
- `trigger(payload)` → `_browserNotify()` + `_telegramNotify()` in parallel

### Backdrop / panel management (app.js)
- `_anyPanelOpen()` checks all panels (indicator, drawing, saved-states, notes, tz-picker)
- `_syncBackdrop()` — single function controlling backdrop state

### state_store.js
- Key schema: `cs:EURUSD`
- Blob: `{ drawings: {fibs, trendlines, hlines, vlines, positions}, indicators: {"15m": [...]}, fibLevels: [...], savedAt }`

---

## localStorage Key Reference
| Key | Value | Set by |
|---|---|---|
| `cs:SYMBOL` | JSON state blob | state_store.js |
| `notes:SYMBOL` | JSON notes array | app.js |
| `theme` | `'dark'` or `'light'` | app.js |
| `chartTimezone` | IANA tz string e.g. `'America/New_York'` | app.js |
| `barSpacing:SYMBOL` | number (pixels per bar) | pane.js |
| `paneLayout_N` | JSON pane config array | app.js |
| `chartCount` | number | app.js |
| `joshua_anthropic_key` | API key string | pine-converter.html |

---

## OANDA + Telegram Configuration
```bash
OANDA_API_KEY=your_token_here
OANDA_ACCOUNT_ID=your_account_id
OANDA_ENV=practice          # or live

TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=-123456789  # group chat IDs are negative
```

---

## Bucket List (future sessions)
- [ ] **Order Blocks params UI** — inputRange, BOS visibility, mitigated block toggle in indicator settings
- [ ] **Replay mode** — needs historical data strategy (OANDA allows up to 5000 candles per request)
- [ ] **Indicator alerts** — AlertEngine.trigger() already generic, just need RSI/MACD crossing calls
- [ ] **Notes export** — download all notes as CSV or PDF
- [ ] **More indicators** — custom periods, additional oscillators
- [ ] **Pine converter improvements** — add Joshua Terminal rendering context to system prompt

---

## Known Quirks
- Sub-pane oscillators not scroll-synced on load — sync after first scroll (LWC limitation)
- yfinance data has ~15min delay on forex. OANDA streaming is real-time.
- Fib levels are global per symbol — changing levels on one fib changes all fibs for that symbol (intentional)
- Browser cache is aggressive — always do a full cache clear (last 24hrs) if changes don't appear after hard refresh
- Telegram group chat IDs are negative numbers — a common gotcha
- Canvas-rendered indicators (`_sdCanvas`, `_obCanvas`) are recomputed from candle data on every load — no special save/restore logic needed
- `_addIndicator(id)` receives only a string ID — no `indicator.params` object exists. Converter output that references `indicator.params` will throw a silent ReferenceError — always replace with hardcoded defaults.

---

## Running the App
```bash
cd joshua_terminal
pip install -r requirements.txt
cp .env.example .env   # then fill in your keys
python app.py
# → http://localhost:5050
```
Debug: `http://localhost:5050/debug`
Popout: `http://localhost:5050/popout?symbol=EUR/USD&interval=15m&source=oanda`
Pine converter: `http://localhost:5050/tools/pine-converter`
