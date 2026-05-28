# Joshua Terminal — Claude Context File
_Last updated: session fixing candle colours, drawing locks, vline panel, position block bounds, state restore deduplication, interval-switch candle alignment, bar spacing per interval, live incomplete candle fetch, price line visibility_

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
- ✅ **Dark/light theme toggle** — ☾/☀ button in topbar, persists via localStorage
- ✅ **Multi-monitor support** — pane popout (⧉ pane toolbar) + full terminal (⧉ topbar)
- ✅ **Screenshot/export** — 📷 composites all canvas layers, downloads as PNG
- ✅ **Connection status dots** — HL, YF, OANDA dots in topbar
- ✅ **Live candle advance** — `onPriceUpdate()` detects bar boundary and opens new candle with correct timestamp

### Candle Colour Configuration
- ✅ Configurable candle colours — Bull/Bear Fill, Border, Wick (6 pickers in DRAW flyout)
- ✅ ⊘ transparent toggle on Bull Fill and Bear Fill for hollow/outline candles
- ✅ Changes apply live to all open panes simultaneously
- ✅ Persisted to `localStorage` key `candleColors` (global)
- ✅ `_defaultCandleColors()` / `_loadCandleColors()` / `applyCandleColors(colors)`
- ✅ **Price line always visible** — `priceLineVisible: true`, `lastValueVisible: true`, `priceLineColor: '#ffffff'` set explicitly on candleSeries in BOTH `_initChart` and `applyCandleColors`
- ⚠️ LWC does not accept `'transparent'` — resolved to `'rgba(0,0,0,0)'` before passing to LWC
- ⚠️ Price line colour is hardcoded white (`#ffffff`) to prevent it inheriting the fill colour (which could be transparent/invisible)

### Interval Switch — Candle Alignment (CRITICAL FIX)
- ✅ **`candleSeries` is recreated on every `_renderCandles()` call**
- ✅ This fixes LWC v4 internal time scale confusion when switching between intervals (e.g. 15m → 4h)
- ✅ Without recreation, LWC partially retains the previous interval's bar spacing model, causing visible gaps between candles on the new interval
- ✅ New series is created with identical options (colours, price line) from `_loadCandleColors()`
- ✅ All canvas overlays (SD zones, OB, trendlines, positions) reference `this.candleSeries` and automatically use the new series instance

### Bar Spacing Persistence (UPDATED)
- ✅ **Bar spacing keyed per symbol + interval** — `localStorage` key `barSpacing:SYMBOL:INTERVAL`
- ✅ Previously was `barSpacing:SYMBOL` (shared across all intervals) — caused zoom bleedover between timeframes
- ✅ Each timeframe now has its own independent zoom level
- ✅ First visit to any symbol+interval uses `fitContent()` then saves on first scroll
- ✅ `_saveBarSpacing()` / `_loadBarSpacing()` both use `this.symbol` + `this.interval` in the key
- ⚠️ Old `barSpacing:SYMBOL` keys in localStorage are orphaned — harmlessly ignored

### Right-Side Offset (UPDATED)
- ✅ `_applyRightOffset()` now uses **proportional offset** — 8% of visible range (min 3, max 30 bars)
- ✅ Previously fixed at 15 bars — caused huge gaps on zoomed-out higher timeframes
- ✅ Called via `requestAnimationFrame()` after `fitContent()` or `applyOptions(barSpacing)` to allow LWC layout pass to complete before reading range
- ✅ Without `requestAnimationFrame`, `getVisibleLogicalRange()` returns stale range from previous interval

### Live Incomplete Candle (CRITICAL FIX — data_source.py)
- ✅ OANDA's `count`-based candle request returns **only complete (closed) candles**
- ✅ On higher timeframes (4h, 8h, 1d) the currently-forming bar was missing entirely, creating a visible gap between last closed bar and the price line
- ✅ Fix: after the main `count` request, a **second request** is made with `from=<last_complete_bar_time + 1s>&count=1` which returns the currently-forming bar
- ✅ The live bar is appended only if its timestamp is strictly after the last complete bar (dedup guard)
- ✅ The second request is **best-effort** — wrapped in try/except, failure does not affect the main data
- ✅ On 15m the gap was <15min (barely visible); on 4h it was up to 4 hours (very obvious)
- ✅ `onPriceUpdate()` updates this live bar in real-time as OANDA streaming ticks arrive

### Timezone
- ✅ Chart timezone picker — 8 options, persists via `chartTimezone`, applies to all panes
- ✅ `tickMarkFormatter` + `timeFormatter` approach (do NOT shift timestamps)
- ⚠️ Do NOT use timestamp-shifting for timezone — causes axis/crosshair mismatch

### Pine Script Converter Tool
- ✅ Standalone at `http://localhost:5050/tools/pine-converter`
- ✅ Calls Anthropic API directly from browser (`claude-sonnet-4-5`)
- ⚠️ `_addIndicator(id)` receives only a string ID — no `indicator.params` object. Use hardcoded defaults.

### Indicators (27+)
- ✅ SMA 20/50/200, EMA 20/50/200, VWAP, VWMA 20
- ✅ Bollinger, Donchian, Keltner
- ✅ Supertrend, Ichimoku, Parabolic SAR, Pivot Points
- ✅ Volume, RSI, MACD, Stochastic, Stoch RSI, ATR, ADX, CCI, CMF, OBV, MFI, Williams %R, Momentum
- ✅ S/D Zones & Major Structure Auto Fib (canvas)
- ✅ Order Blocks (canvas)

### Drawing Tools
- ✅ Fibonacci retracement
- ✅ Trendlines — click to select/panel, drag endpoints; **lock** prevents moves
- ✅ Horizontal lines — click to select/panel, drag, price alert toggle; **lock**
- ✅ Vertical lines — click to select/panel, drag; **lock**; vline panel crash fixed (was referencing `h.alert` in vline context)
- ✅ Long/Short position blocks — see section below
- ✅ **Lock toggle (🔓/🔒)** on all drawing panels — persisted in save state
- ✅ **Click any line to reopen its panel** — panel shown on mousedown hit, not only after drag
- ✅ **Locked lines still open panel on click** — just cannot be dragged

#### Long/Short Position Blocks
- ✅ Bounded rectangular block anchored to entry candle's `startTime`
- ✅ `widthBars` (default 20) — right-edge drag handle to resize
- ✅ Block x-position extrapolates correctly when `startTime` scrolls off-screen left
- ✅ TP block (green), SL block (red), Entry/TP/SL lines with price labels, pip counts
- ✅ Lock toggle — locked positions cannot be dragged
- ✅ Panel restores collapsed after page load; click to expand
- ✅ Click-to-reopen — clicking line when panel is closed reopens without moving position
- ✅ Risk calculator: account $, risk %, lot size → risk $, lots, units, TP $
- ✅ `startTime`, `widthBars`, `locked`, `_calcAcct`, `_calcRisk`, `_calcLotSz` all persisted

#### Candle Style in DRAW flyout
- ✅ "CANDLE STYLE" section at bottom of DRAW flyout
- ✅ 6 colour pickers + ⊘ transparent toggle on fills + ↺ Reset Defaults

### State Persistence
- ✅ `state_store.js` — key schema `cs:EURUSD`
- ✅ Drawings shared across ALL intervals for a symbol
- ✅ Indicators saved per symbol+interval
- ✅ **`_drawingsRestored` flag** — drawings restore runs once per symbol load only; prevents duplication on interval switches
- ✅ `_drawingsRestored` resets in `_changeSymbol()` so new symbol restores correctly
- ✅ Position blob fields: `id, side, entryPrice, slPrice, tpPrice, startTime, widthBars, locked, _calcAcct, _calcRisk, _calcLotSz`
- ✅ Trendline blob: `id, color, locked, ptA, ptB`
- ✅ Hline blob: `id, price, color, alert, locked`
- ✅ Vline blob: `id, time, color, locked`

### Popout Window
- ✅ Full indicator + drawing flyouts
- ✅ Live price routing via socket handlers
- ✅ Timezone, bar spacing, right offset all work identically
- ⚠️ Flyout panels embedded directly in `popout.html` — not inherited from `index.html`
- ⚠️ Candle colour section in DRAW flyout exists in `app.js openDrawFlyout()` — popout.html has its own `openDrawFlyout()` and needs equivalent wiring (bucket list)

### Alert System
- ✅ `alert_engine.js` — 60s cooldown per level
- ✅ Browser Web Notifications + Telegram Bot API
- ✅ Alert toggle on horizontal lines, persisted in state

---

## Key Implementation Details

### pane.js — ChartPane class
- Chart init deferred until ResizeObserver fires
- Drawing layer = transparent `<div>` overlay, z-index 5
- Position blocks canvas z-index 6, S/D Zones z-index 7, Order Blocks z-index 8, Trendline/hline/vline canvas z-index 9

### _renderCandles() — CRITICAL pattern
```javascript
// 1. Remove + recreate candleSeries (fixes LWC interval-switch alignment bug)
if (this.candleSeries) { try { this.chart.removeSeries(this.candleSeries); } catch(e) {} }
this.candleSeries = this.chart.addCandlestickSeries({
  ...colours from _loadCandleColors()...,
  priceLineVisible: true, lastValueVisible: true,
  priceLineColor: '#ffffff', priceLineWidth: 1,
});
// 2. setData
this.candleSeries.setData(this.candles);
// 3. Restore spacing or fitContent, then defer offset
requestAnimationFrame(() => this._applyRightOffset());
```

### _applyRightOffset()
- Proportional: `offset = clamp(round(visible * 0.08), 3, 30)`
- Must be called via `requestAnimationFrame` — LWC `fitContent()` is async

### Bar spacing keys
- `barSpacing:SYMBOL:INTERVAL` — e.g. `barSpacing:EURUSD:4h`
- Each timeframe independent; old `barSpacing:SYMBOL` keys orphaned harmlessly

### data_source.py — live incomplete candle
```python
# After main count request, fetch live bar:
from_str = (last_complete_bar_time + 1s).strftime(...)
r2 = requests.get(url, params={"granularity": g, "from": from_str, "count": "1", "price": "M"})
# Append if timestamp > last_complete_time; wrapped in try/except (best-effort)
```

### Candle colour implementation
- `_defaultCandleColors()` — returns `{ bullFill, bullBorder, bullWick, bearFill, bearBorder, bearWick }`
- `_loadCandleColors()` — reads `candleColors` from localStorage, merges with defaults
- `applyCandleColors(colors)` — persists + resolves transparent + calls `candleSeries.applyOptions()` WITH `priceLineVisible: true` etc.
- Always set `priceLineColor: '#ffffff'` explicitly — never let it inherit fill colour

### Drawing tool line panels
- All three line types show panel on **mousedown hit** (not only after drag)
- Locked lines still open panel on click — just skip drag initiation
- `e.target.closest('.trend-edit-panel, .fib-edit-panel, .pos-panel')` guard prevents panel clicks from propagating

### Vline panel fix
- Old `_vlineShowPanel` referenced `h.alert` / `h` (hline variable) — silent ReferenceError
- Fixed: vline panel has no alert section, only colour swatches + lock + delete

### State restore deduplication
- `_drawingsRestored` boolean on ChartPane instance
- Set to `true` after first drawing restore; checked at top of `_restoreState()`
- Reset to `false` in `_changeSymbol()` and on construction
- Without this: interval switches call `_loadData` → `_restoreState` → duplicate every drawing in memory

### state_store.js
- Key: `cs:EURUSD`
- Blob: `{ drawings: {fibs, trendlines, hlines, vlines, positions}, indicators: {"15m": [...]}, fibLevels: [...], savedAt }`

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
- [ ] **Order Blocks params UI** — inputRange, BOS visibility, mitigated block toggle
- [ ] **Replay mode** — needs historical data strategy
- [ ] **Indicator alerts** — AlertEngine.trigger() already generic, need RSI/MACD crossing calls
- [ ] **Notes export** — download as CSV or PDF
- [ ] **More indicators** — custom periods, additional oscillators
- [ ] **Pine converter improvements** — add rendering context to system prompt
- [ ] **Candle colours in popout** — popout.html has its own `openDrawFlyout()` needing candle style section

---

## Known Quirks
- Sub-pane oscillators not scroll-synced on load — sync after first scroll (LWC limitation)
- yfinance data has ~15min delay on forex. OANDA streaming is real-time.
- Fib levels are global per symbol — changing levels on one fib changes all fibs for that symbol (intentional)
- Browser cache is aggressive — always hard refresh (Cmd+Shift+R / Ctrl+Shift+R) after updates
- Telegram group chat IDs are negative numbers
- LWC `timeToCoordinate()` returns `null` for timestamps outside visible range — always extrapolate using pixel-per-bar
- Position block `startTime` may be off-screen left as chart scrolls forward — extrapolation handles this
- Old `barSpacing:SYMBOL` localStorage keys (without interval suffix) are orphaned — ignored harmlessly
- `candleSeries` is recreated on every `_renderCandles()` call — this is intentional, do not "optimise" it away

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
