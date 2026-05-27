# Joshua Terminal 🖥

A free, local, self-hosted multi-chart trading dashboard — your personal TradingView replacement.
Built with Flask + Socket.IO (backend), Lightweight Charts (frontend), and plain HTML/CSS/JS.

---

## Features

- **Multi-chart grid** — 1, 2, 4, 6, or 8 panes, each fully independent
- **Live prices** — OANDA v20 real-time streaming (forex), Hyperliquid WebSocket (crypto), yfinance fallback
- **27+ technical indicators** — MAs, Bollinger, Keltner, Donchian, Ichimoku, Parabolic SAR, RSI, MACD, Stoch RSI, CMF, Momentum, S/D Zones & Auto Fib, Order Blocks, and more
- **Drawing tools** — Fibonacci, Trendlines, Horizontal/Vertical lines, Long/Short position blocks with risk calculator
- **Alert system** — arm any horizontal line to fire browser notifications + Telegram messages when price crosses
- **Notes / journal** — per-symbol notes panel with tagging (Idea, Trade, Risk, Misc)
- **Screenshot export** — save any chart pane as a PNG with all drawings and indicators composited
- **Multi-monitor** — pop out a single chart or a full second terminal to a second screen
- **Timezone picker** — set chart time to any major financial timezone (NY, London, Tokyo, etc.) — applies to all panes simultaneously and persists across sessions
- **Candle width persistence** — zoom level saved per symbol, restored automatically on timeframe switch
- **Dark / light theme** — toggle with one click, persists across sessions
- **State persistence** — drawings, indicators, and pane layouts saved to localStorage and restored automatically
- **World clock** — UTC, New York, London, Tokyo times in topbar
- **Session indicator** — Asia / London / US Open / Overlap / Pre-market / After Hours / Weekend

---

## Quick Start

### 1. Prerequisites

- Python 3.10+
- A free OANDA practice account — [oanda.com](https://www.oanda.com/) (for real-time forex)

### 2. Install dependencies

```bash
cd joshua_terminal
pip install -r requirements.txt
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```
OANDA_API_KEY=your_token_here
OANDA_ACCOUNT_ID=your_account_id
OANDA_ENV=practice

TELEGRAM_BOT_TOKEN=your_bot_token    # optional — for Telegram alerts
TELEGRAM_CHAT_ID=-123456789          # note: group chat IDs are negative
```

### 4. Run

```bash
python app.py
```

Open your browser at **http://localhost:5050**

> Without an OANDA key the terminal still works — it falls back to Yahoo Finance (15-minute delay) for candle data and polls prices every 5 seconds.

---

## Project Structure

```
joshua_terminal/
├── app.py               # Flask backend — OANDA stream, HL WebSocket, alert endpoint, all routes
├── data_source.py       # Pluggable data layer (swap broker here)
├── requirements.txt
├── .env                 # Your credentials (never commit this)
├── .env.example         # Credential template
├── templates/
│   ├── index.html       # Main single-page app shell
│   ├── popout.html      # Standalone chart window for multi-monitor
│   └── pine-converter.html  # Pine Script → JS converter tool
└── static/
    ├── css/
    │   └── style.css    # All styling — dark/light theme, layout, panels
    └── js/
        ├── indicators.js   # All indicator maths (pure client-side functions)
        ├── state_store.js  # localStorage persistence layer
        ├── alert_engine.js # Generic alert engine — browser + Telegram
        ├── pane.js         # ChartPane class — charts, drawings, indicators, alerts
        └── app.js          # Orchestrator — grid, socket, flyouts, notes, layout
```

---

## Indicators

### Overlays (drawn on main chart)
| Indicator | Notes |
|---|---|
| SMA 20 / 50 / 200 | Simple moving averages |
| EMA 20 / 50 / 200 | Exponential moving averages |
| VWAP | Resets daily |
| VWMA 20 | Volume-weighted moving average |
| Bollinger Bands | 20 period, 2 std dev |
| Donchian Channel | 20 period |
| Keltner Channel | 20 period, 1.5x ATR |
| Supertrend | 10 period, factor 3 |
| Ichimoku Cloud | Tenkan/Kijun/Chikou/Senkou A and B |
| Parabolic SAR | 0.02 step, 0.2 max |
| Pivot Points | Daily floor trader pivots |
| S/D Zones & Auto Fib | Canvas-rendered supply/demand zones + automatic Fibonacci levels |
| Order Blocks | Canvas-rendered bullish/bearish order blocks from Break of Structure detection |

### Sub-pane Oscillators
| Indicator | Notes |
|---|---|
| Volume | Green/red histogram |
| RSI | 14 period, 70/30 lines |
| MACD | 12/26/9, histogram + lines |
| Stochastic | 14/3/3 |
| Stoch RSI | 14 period, 80/20 lines |
| ATR | 14 period |
| ADX | 14 period |
| CCI | 20 period |
| CMF | 20 period, Chaikin Money Flow |
| OBV | On-Balance Volume |
| MFI | 14 period, Money Flow Index |
| Williams %R | 14 period |
| Momentum | 10 period |

---

## Drawing Tools

| Tool | How to use |
|---|---|
| **Fibonacci** | Click and drag between two price points. Edit levels in the panel. |
| **Trendline** | Click and drag. Drag endpoints to adjust. |
| **Horizontal Line** | Click at the desired price. Drag to move. Click to set a price alert. |
| **Vertical Line** | Click at the desired time. Drag to move. |
| **Long / Short Block** | Drag from entry to stop loss. TP auto-mirrors. Includes risk calculator. |

All drawing tools exit automatically after placing — no need to click the tool again to deactivate.

---

## Alert System

Alerts fire when price crosses an armed horizontal line.

**Setting an alert:**
1. Draw a horizontal line
2. Click the line to open its edit panel
3. Click the bell icon to arm it
4. Allow browser notifications when prompted

**Telegram alerts:** Fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`.

**Getting Telegram credentials:**
1. Message `@BotFather` on Telegram, create a bot, copy the token
2. Add your bot to a group or chat with it directly
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Find `"chat":{"id": -XXXXXXX}` — that negative number is your chat ID

---

## Timezone

Click the 🕐 button in the topbar to open the timezone picker. Available options:

| Timezone | Label |
|---|---|
| UTC | UTC |
| America/New_York | New York (ET) |
| Europe/London | London (GMT/BST) |
| Europe/Berlin | Frankfurt (CET) |
| Asia/Dubai | Dubai (GST) |
| Asia/Singapore | Singapore (SGT) |
| Asia/Tokyo | Tokyo (JST) |
| Australia/Sydney | Sydney (AEDT) |

The selection applies to all open panes instantly and persists across sessions. Both the bottom axis labels and the crosshair tooltip display time in the chosen timezone. DST transitions are handled automatically.

---

## Multi-Monitor

- **Pane popout** (button in pane toolbar) — pops that chart into a new window; full indicator and drawing tools available
- **Full terminal** (button in main topbar) — opens a complete second Joshua Terminal on the second screen

---

## Notes / Journal

Each pane has a notes button. Click it to open the notes panel for that symbol. Add notes with tags (Idea, Trade, Risk, Misc). Notes persist in localStorage per symbol. A gold dot on the button indicates a symbol has notes.

---

## Symbol Reference

| Source | Format | Examples |
|---|---|---|
| **OANDA** | Slash format | EUR/USD, GBP/USD, XAU/USD |
| **Yahoo Finance** | Various | EURUSD=X, AAPL, ^GSPC, GC=F |
| **Hyperliquid** | Coin name | BTC, ETH, SOL, AVAX |

---

## Tips

- **Full cache clear** if changes do not appear — browser caching is aggressive on JS and CSS files
- **Save your drawings** with the SAVE button — amber dot means unsaved changes
- **Drawings follow the symbol**, not the timeframe — your EURUSD lines appear on every interval
- **Indicators are per timeframe** — RSI on 15m is saved separately from RSI on 1h
- **Candle width is saved per symbol** — resize once, it restores automatically on every timeframe switch
- **Debug endpoint** — `http://localhost:5050/debug` shows data source health

---

## Extending

**Add a data source:** Implement `get_candles()` and `get_price()` in `data_source.py`.

**Add an indicator:** Add the maths to `indicators.js`, add a definition to `INDICATOR_DEFS` in `pane.js`, add a `case` to `_addIndicator()`. Note: `_addIndicator(id)` receives only the indicator ID string — use hardcoded defaults for any parameters.

**Add an alert type:** Call `AlertEngine.trigger(payload)` with `type`, `direction`, `level`, `current`, `label` — the engine handles browser and Telegram delivery automatically.
