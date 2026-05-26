# Joshua Terminal — Claude Context File
_Last updated: session ending after notes panel, multi-monitor, alert engine, new indicators, drawing fixes_

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
├── templates/
│   ├── index.html          # Single-page shell — topbar, grid, flyouts, panels, scripts
│   └── popout.html         # Standalone chart window for multi-monitor popout
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
- ✅ **Screenshot/export** — 📷 button per pane, composites all canvas layers (chart + trendlines + positions), downloads as `SYMBOL_INTERVAL_DATE.png`
- ✅ **Connection status dots** — HL, YF, OANDA dots in topbar; OANDA lights green on first price tick

### Indicators (25+, all client-side maths in indicators.js)
- ✅ SMA 20/50/200, EMA 20/50/200, VWAP, VWMA 20 (overlay)
- ✅ Bollinger Bands, Donchian Channel, Keltner Channel (bands)
- ✅ Supertrend (10,3), Ichimoku Cloud (9/26/52), Parabolic SAR, Pivot Points (overlay/trend)
- ✅ Volume, RSI, MACD, Stochastic, Stoch RSI, ATR, ADX, CCI, CMF, OBV, MFI, Williams %R, Momentum (sub-pane oscillators)

### Drawing Tools (all in pane.js)
- ✅ Fibonacci retracement — click+drag, editable level panel, custom levels, hover highlight
- ✅ Trendlines — click+drag, endpoint dragging, colour picker, delete
- ✅ Horizontal lines — click to place, drag to move, colour picker, alert bell toggle, delete
- ✅ Vertical lines — click to place, drag to move, colour picker, delete
- ✅ Long/Short position blocks — canvas coloured TP/SL zones, live risk calculator
- ✅ Clear All Drawings action
- ✅ **Auto-exit drawing mode** — Fib, Long, Short, Trendline all exit automatically after placing; hline/vline already exited on click
- ✅ **Drawing flyout auto-closes** after any tool completes (via `drawing-tool-exited` custom event)

### Alert System
- ✅ `alert_engine.js` — generic singleton with `AlertEngine.trigger(payload)` and cooldown (60s per level)
- ✅ Browser Web Notifications (requests permission on first arm)
- ✅ Telegram Bot API via `POST /api/alert` backend endpoint
- ✅ Alert toggle on horizontal lines — 🔕/🔔 bell in hline edit panel, gold glow when armed
- ✅ Price cross detection in `onPriceUpdate()` — checks all armed hlines on every tick
- ✅ Alert state persisted with hline in state_store (saved/restored)
- ✅ Generic payload format: `{ symbol, interval, type, direction, level, current, label }` — ready for indicator alerts

### Notes / Journal Panel
- ✅ 📝 button per pane toolbar — opens notes panel for that pane's symbol
- ✅ Four tag types: 💡 Idea, 📈 Trade, ⚠️ Risk, 📌 Misc
- ✅ Notes stored in localStorage keyed by symbol (`notes:EURUSD`)
- ✅ Most-recent-first display, delete individual notes
- ✅ Ctrl+Enter shortcut to add note
- ✅ Gold dot badge on 📝 button when symbol has notes

### State Persistence
- ✅ `state_store.js` — localStorage key schema `cs:EURUSD` → JSON blob
- ✅ Drawings shared across ALL intervals for a symbol (TradingView model)
- ✅ Indicators saved per symbol+interval
- ✅ Custom fib levels saved per symbol
- ✅ Save button in pane toolbar — amber pulsing dot for unsaved changes, green flash on save
- ✅ Auto-restore on page load / interval switch / symbol switch
- ✅ Saved States manager (💾 topbar button)
- ✅ `beforeunload` auto-saves pane layout

### Environment / Config
- ✅ `.env` file loaded via `python-dotenv` in both `app.py` and `data_source.py`
- ✅ `.env.example` template committed to repo
- ✅ OANDA keys: `OANDA_API_KEY`, `OANDA_ACCOUNT_ID`, `OANDA_ENV`
- ✅ Telegram keys: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

---

## Data Flow

### Candles
```
Browser → GET /api/candles?symbol=EUR/USD&interval=15m&source=oanda&limit=300
→ app.py → data_source.py → OANDA v20 REST or yfinance
→ JSON [{time, open, high, low, close, volume}, ...]
→ pane.js → candleSeries.setData() → _restoreState()
```

### Live prices (OANDA)
```
pane.js → socket.emit('subscribe_yf', {symbol})
→ app.py on_sub_yf → OandaStreamManager.subscribe()
→ HTTP streaming /v3/accounts/{id}/pricing/stream
→ socketio.emit('oanda_price', {symbol, price, bid, ask, dir, change})
→ pane.js onPriceUpdate() → ticker update + hline alert check
```

### Alert flow
```
onPriceUpdate() → price crosses armed hline
→ AlertEngine.trigger(payload)
→ browser: new Notification(title, body)
→ fetch POST /api/alert → app.py → Telegram Bot API sendMessage
```

### Popout window
```
User clicks ⧉ on pane → window.open('/popout?symbol=EURUSD&interval=15m&source=oanda')
→ popout.html → new ChartPane() on full-screen div
→ same socket connection, same state_store, same alert_engine
```

---

## Key Implementation Details

### pane.js — ChartPane class
- Chart init deferred until ResizeObserver fires
- Drawing layer = transparent `<div>` overlay, z-index 5
- Trendline/hline/vline canvas at z-index 8 (pointer-events: none)
- Position blocks on separate `<canvas>` at z-index 6
- `_updateDrawingUI()` dispatches `drawing-tool-exited` CustomEvent when drawingMode clears → app.js closes flyout
- `applyTheme(chartBg, chartText, subText)` — updates Lightweight Charts layout options on all sub-panes

### alert_engine.js
- Cooldown map keyed by `symbol:level:direction` — 60s silence after firing
- `trigger(payload)` → `_browserNotify()` + `_telegramNotify()` in parallel
- `requestPermission()` — call on user gesture (called on app init and on first bell arm)

### Backdrop / panel management (app.js)
- `_anyPanelOpen()` checks all 4 panels (indicator-flyout, drawing-flyout, saved-states-panel, notes-panel)
- `_syncBackdrop()` — single function that toggles backdrop based on `_anyPanelOpen()`
- All open/close functions call `_syncBackdrop()` — never manipulate backdrop directly

### state_store.js
- Key schema: `cs:EURUSD`
- Blob: `{ drawings: {fibs, trendlines, hlines, vlines, positions}, indicators: {"15m": [...]}, fibLevels: [...], savedAt }`
- hlines now include `alert: bool` field

---

## OANDA + Telegram Configuration
```bash
# .env file (project root)
OANDA_API_KEY=your_token_here
OANDA_ACCOUNT_ID=your_account_id
OANDA_ENV=practice          # or live

TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=-123456789  # note: group chat IDs are negative
```

### Getting Telegram credentials
1. Message `@BotFather` → `/newbot` → copy token
2. Add bot to your group/channel
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Find `"chat":{"id": -XXXXXXX}` — that negative number is your chat ID

---

## Bucket List (future sessions)
- [ ] **Replay mode** — needs historical data strategy first (OANDA allows up to 5000 candles per request; current default is 300)
- [ ] **Indicator alerts** — AlertEngine.trigger() already generic, just need to call from RSI/MACD etc. crossing levels
- [ ] **Notes export** — download all notes as CSV or PDF
- [ ] **More indicators** — custom periods, Ichimoku alerts, additional oscillators

---

## Known Quirks
- Sub-pane oscillators not scroll-synced on load — sync after first scroll (Lightweight Charts limitation)
- yfinance data has ~15min delay on forex. OANDA streaming is real-time.
- Fib levels are global per symbol — changing levels on one fib changes all fibs for that symbol (intentional)
- Browser cache is aggressive — always do a full cache clear (last 24hrs) if changes don't appear after hard refresh
- Telegram group chat IDs are negative numbers — a common gotcha

---

## Running the App
```bash
cd joshua_terminal
pip install -r requirements.txt
cp .env.example .env   # then fill in your keys
python app.py
# → http://localhost:5050
```
Debug endpoint: `http://localhost:5050/debug`
Popout endpoint: `http://localhost:5050/popout?symbol=EUR/USD&interval=15m&source=oanda`
