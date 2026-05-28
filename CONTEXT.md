# Joshua Terminal — Claude Context File
_Last updated: session adding candle colour config, long/short position block improvements, drawing tool lock, vline panel fix, state restore deduplication fix_

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

### Candle Colour Configuration
- ✅ **Configurable candle colours** — Bull Fill, Bull Border, Bull Wick, Bear Fill, Bear Border, Bear Wick
- ✅ Colour pickers in the **Drawing Tools (DRAW) flyout** under "CANDLE STYLE" section
- ✅ Bull Fill and Bear Fill have a **⊘ transparent toggle** — makes candle bodies hollow (outline/bar candles)
- ✅ Changes apply **live** to all open panes simultaneously as the colour wheel is dragged
- ✅ Persisted to `localStorage` under key `candleColors` (global, shared by all panes)
- ✅ Reset Defaults button restores original green/red
- ✅ `_defaultCandleColors()` — returns defaults; `_loadCandleColors()` — reads from localStorage with merge; `applyCandleColors(colors)` — persists + applies via `candleSeries.applyOptions()`
- ⚠️ LWC does not accept `'transparent'` as a colour value — `applyCandleColors` resolves transparent → `'rgba(0,0,0,0)'` before passing to LWC

### Timezone
- ✅ **Chart timezone picker** — 🕐 button in topbar opens a flyout with 8 timezone options (UTC, NY, London, Frankfurt, Dubai, Singapore, Tokyo, Sydney)
- ✅ Selection persists via `localStorage` key `chartTimezone`
- ✅ Applies to **all open panes** simultaneously via `pane.applyTimezone(tz)`
- ✅ New panes and popouts read `chartTimezone` from localStorage on init — always open in the saved timezone
- ✅ **Bottom axis labels** controlled by `tickMarkFormatter` on `timeScale` — receives raw UTC timestamp, formats in target tz via `Intl`
- ✅ **Crosshair tooltip** controlled by `localization.timeFormatter` — separate formatter, same tz logic
- ✅ **Ticker time** in pane toolbar uses `toLocaleString()` with the saved tz
- ⚠️ Do NOT use timestamp-shifting to implement timezone. Use `tickMarkFormatter` + `timeFormatter` only.

### Chart View Persistence
- ✅ **Bar spacing (candle width) persisted per symbol** — `localStorage` key `barSpacing:SYMBOL`
- ✅ Auto-saved on every zoom/scroll via `subscribeVisibleLogicalRangeChange`
- ✅ Restored on every `_renderCandles()` call
- ✅ **Right-side offset** — `_applyRightOffset(bars=15)` extends the visible range 15 bars past the last candle on every data load

### Pine Script Converter Tool
- ✅ Standalone HTML tool served at `http://localhost:5050/tools/pine-converter`
- ✅ Calls Anthropic API directly from browser (`claude-sonnet-4-5`)
- ✅ API key stored in `localStorage` as `joshua_anthropic_key`
- ⚠️ Converter generates correct **math** but may hallucinate rendering APIs for complex visual types. Always validate against actual pane.js patterns.
- ⚠️ `_addIndicator(id)` receives only a string ID — there is NO `indicator` object or `indicator.params`. Use hardcoded defaults directly.

### Indicators (27+, all client-side maths in indicators.js)
- ✅ SMA 20/50/200, EMA 20/50/200, VWAP, VWMA 20 (overlay)
- ✅ Bollinger Bands, Donchian Channel, Keltner Channel (bands)
- ✅ Supertrend (10,3), Ichimoku Cloud (9/26/52), Parabolic SAR, Pivot Points (overlay/trend)
- ✅ Volume, RSI, MACD, Stochastic, Stoch RSI, ATR, ADX, CCI, CMF, OBV, MFI, Williams %R, Momentum (sub-pane oscillators)
- ✅ **S/D Zones & Major Structure Auto Fib** (overlay, canvas-rendered) — see Indicators.md
- ✅ **Order Blocks** (overlay, canvas-rendered) — see below

### Order Blocks Indicator
- ✅ Added to `indicators.js` as `orderBlocks(data, inputRange, showBearishBOS, showBullishBOS, useMitigatedBlocks)`
- ✅ Rendered via `_obCanvas` overlay (z-index 8)
- ✅ Bearish OBs: gold fill with gold border; Bullish OBs: green fill with green border; Mitigated: grey
- ✅ BOS lines: dashed horizontal, colour-coded
- ⚠️ Parameters hardcoded — no params UI yet

### Drawing Tools (all in pane.js)
- ✅ Fibonacci retracement
- ✅ Trendlines — click to select/show panel, drag endpoints to adjust; **lock** prevents accidental moves
- ✅ Horizontal lines — click to select/show panel, drag to reposition, price alert toggle; **lock** support
- ✅ Vertical lines — click to select/show panel, drag to reposition; **lock** support; fixed panel crash bug
- ✅ Long/Short position blocks — see section below
- ✅ Clear All Drawings action
- ✅ Auto-exit drawing mode after placement
- ✅ **Lock toggle (🔓/🔒)** on trendline, hline, vline, and position panels — prevents dragging; persisted in save state
- ✅ **Click any line to reopen its panel** — panel shows on mousedown hit (not only after drag)

#### Long/Short Position Blocks
- ✅ Draw by clicking entry price and dragging to stop loss — TP auto-set at 1:1 R:R
- ✅ **Bounded rectangular block** anchored to entry candle's time position (not full canvas width)
- ✅ `startTime` captured at mousedown → block x-origin = `timeToCoordinate(startTime)`
- ✅ `widthBars` (default 20) controls block width in bars — right-edge drag handle to resize
- ✅ Block x-position **extrapolates correctly** when startTime scrolls off-screen left (same pattern as trendlines)
- ✅ TP block (green), SL block (red), Entry/TP/SL horizontal lines with price labels
- ✅ Pip labels inside blocks
- ✅ **Lock toggle** — locked positions cannot be dragged (panel still opens for inspection/delete)
- ✅ **Panel restores on page load** — always shown collapsed after restore; click to expand
- ✅ **Click-to-reopen** — clicking a position line when panel is closed reopens it without moving the position
- ✅ Risk calculator in panel: account $, risk %, lot size → risk $, lots, units, TP $
- ✅ Calc inputs persist across panel rebuilds and save/restore cycles
- ✅ `startTime`, `widthBars`, `locked`, `_calcAcct`, `_calcRisk`, `_calcLotSz` all persisted in state

#### Candle Style in DRAW flyout
- ✅ "CANDLE STYLE" section at bottom of DRAW flyout
- ✅ 6 colour pickers: Bull Fill, Bull Border, Bull Wick, Bear Fill, Bear Border, Bear Wick
- ✅ ⊘ transparent toggle on Bull Fill and Bear Fill for hollow/outline candle style
- ✅ ↺ Reset Defaults button

### Popout Window (popout.html)
- ✅ Full indicator flyout and drawing tools flyout
- ✅ Live price routing via socket handlers (mirrors app.js)
- ✅ Timezone, bar spacing, right offset all work identically
- ⚠️ Flyout panels are embedded directly in `popout.html` — not inherited from `index.html`
- ⚠️ Candle colour section in DRAW flyout is in `app.js openDrawFlyout()` — popout.html has its own `openDrawFlyout()` and needs equivalent wiring if candle colour is needed in popout

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
- ✅ **`_drawingsRestored` flag** — drawings restore runs **once per symbol load only**; interval switches re-run indicator restore but skip drawing restore to prevent duplication
- ✅ `_drawingsRestored` resets in `_changeSymbol()` so new symbol gets fresh drawing restore
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

### Candle colour implementation
- `_defaultCandleColors()` — returns `{ bullFill, bullBorder, bullWick, bearFill, bearBorder, bearWick }` with original green/red
- `_loadCandleColors()` — reads `candleColors` from localStorage, merges with defaults (safe against partial data)
- `applyCandleColors(colors)` — persists to localStorage, resolves `'transparent'` → `'rgba(0,0,0,0)'`, calls `candleSeries.applyOptions()`
- `_initChart()` calls `_loadCandleColors()` and applies on construction

### Position block rendering
- `_drawPosOnCanvas(ctx, pos, alpha, dragging)` — draws bounded TP/SL blocks + price lines
- x0 computed from `timeToCoordinate(pos.startTime)` with off-screen extrapolation using `lastX + ((t - lastCandleTime) / barMs) * pxPerBar`
- x1 = x0 + `pos.widthBars * pxPerBar`
- Right-edge resize handle: 4px grip bar at x1 with dot markers; hover = `ew-resize` cursor; drag recalculates `widthBars`
- `_attachPosDragHandles(posId)` handles: tp / sl / entry price drag + width resize drag + locked guard

### State restore deduplication (CRITICAL)
- `_restoreState()` is called on every `_loadData()` completion — including interval switches
- `_drawingsRestored` boolean flag prevents drawing restore from running more than once per symbol
- Without this flag, interval switches would duplicate all positions, fibs, trendlines etc. in memory
- `_changeSymbol()` resets `_drawingsRestored = false` so the new symbol restores correctly

### Drawing tool line panels
- All three line types (trendline, hline, vline) show their edit panel **on mousedown hit** (not only after drag)
- This means: click a line → panel opens; click elsewhere → panel closes; click line again → panel reopens
- Locked lines still open their panel on click — they just can't be dragged
- Guard: `e.target.closest('.trend-edit-panel, .fib-edit-panel, .pos-panel')` prevents panel clicks from propagating to `_trendMouseDown`

### Vline panel fix
- Old `_vlineShowPanel` had a copy-paste bug referencing `h.alert` and `h` (from hline context) — caused a silent ReferenceError, panel never appeared
- Fixed: vline panel no longer has an alert section; uses only colour swatches + lock + delete

### Canvas-rendered indicators (pane.js pattern)
- Create in `_init<Name>Canvas()`, append to `chartEl`, appropriate z-index
- Subscribe to `timeScale().subscribeVisibleLogicalRangeChange()` + `subscribeCrosshairMove()`
- Use `timeScale().timeToCoordinate(t)` for X, `candleSeries.priceToCoordinate(p)` for Y
- Sentinel string in `indicatorSeries` — cleaned up in `_removeIndicator()`
- Add canvas to screenshot compositing in `_takeScreenshot()` before trendline canvas

### Timezone implementation (CRITICAL — do not revert)
- **Axis labels**: `timeScale().applyOptions({ tickMarkFormatter })`
- **Crosshair**: `chart.applyOptions({ localization: { timeFormatter } })`
- **DO NOT shift timestamps** — shifting causes axis/crosshair mismatch across different browser timezones

### alert_engine.js
- Cooldown map keyed by `symbol:level:direction` — 60s silence after firing
- `trigger(payload)` → `_browserNotify()` + `_telegramNotify()` in parallel

### Backdrop / panel management (app.js)
- `_anyPanelOpen()` checks all panels (indicator, drawing, saved-states, notes, tz-picker)
- `_syncBackdrop()` — single function controlling backdrop state

### state_store.js
- Key schema: `cs:EURUSD`
- Blob: `{ drawings: {fibs, trendlines, hlines, vlines, positions}, indicators: {"15m": [...]}, fibLevels: [...], savedAt }`
- Position blob fields: `id, side, entryPrice, slPrice, tpPrice, startTime, widthBars, locked, _calcAcct, _calcRisk, _calcLotSz`
- Trendline blob fields: `id, color, locked, ptA, ptB`
- Hline blob fields: `id, price, color, alert, locked`
- Vline blob fields: `id, time, color, locked`

---

## localStorage Key Reference
| Key | Value | Set by |
|---|---|---|
| `cs:SYMBOL` | JSON state blob | state_store.js |
| `notes:SYMBOL` | JSON notes array | app.js |
| `theme` | `'dark'` or `'light'` | app.js |
| `chartTimezone` | IANA tz string e.g. `'America/New_York'` | app.js |
| `barSpacing:SYMBOL` | number (pixels per bar) | pane.js |
| `candleColors` | JSON `{ bullFill, bullBorder, bullWick, bearFill, bearBorder, bearWick }` | pane.js |
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
- [ ] **Candle colours in popout** — popout.html has its own `openDrawFlyout()` that needs the candle style section wired up

---

## Known Quirks
- Sub-pane oscillators not scroll-synced on load — sync after first scroll (LWC limitation)
- yfinance data has ~15min delay on forex. OANDA streaming is real-time.
- Fib levels are global per symbol — changing levels on one fib changes all fibs for that symbol (intentional)
- Browser cache is aggressive — always do a full cache clear (last 24hrs) if changes don't appear after hard refresh
- Telegram group chat IDs are negative numbers — a common gotcha
- Canvas-rendered indicators (`_sdCanvas`, `_obCanvas`) are recomputed from candle data on every load — no special save/restore logic needed
- `_addIndicator(id)` receives only a string ID — no `indicator.params` object exists
- LWC `timeToCoordinate()` returns `null` for timestamps outside the visible range — always extrapolate using pixel-per-bar rather than falling back to 0
- Position block `startTime` may be off-screen left as chart scrolls forward — extrapolation in `_drawPosOnCanvas` and drag handlers handles this correctly

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
