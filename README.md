# Joshua Terminal 🖥

A free, local, self-hosted multi-chart trading dashboard — your personal TradingView replacement.
Built with Flask + Socket.IO (backend), Lightweight Charts (frontend), and plain HTML/CSS/JS.

---

## Features

- **Multi-chart grid** — 1, 2, 4, 6, or 8 panes, each fully independent
- **Live prices** — OANDA v20 real-time streaming (forex), Hyperliquid WebSocket (crypto), yfinance fallback
- **27+ technical indicators** — MAs, Bollinger, Keltner, Donchian, Ichimoku, Parabolic SAR, RSI, MACD, Stoch RSI, CMF, Momentum, S/D Zones & Auto Fib, Order Blocks, and more
- **Drawing tools** — Fibonacci, Trendlines, Horizontal/Vertical lines, Long/Short position blocks with risk calculator
- **Candle style** — fully configurable candle colours (bull/bear fill, border, wick); transparent/hollow candle mode
- **Lock drawings** — trendlines, horizontal lines, vertical lines, and position blocks can be locked to prevent accidental moves
- **Alert system** — arm any horizontal line to fire browser notifications + Telegram messages when price crosses
- **Notes / journal** — per-symbol notes panel with tagging (Idea, Trade, Risk, Misc)
- **Screenshot export** — save any chart pane as a PNG with all drawings and indicators composited
- **Multi-monitor** — pop out a single chart or a full second terminal to a second screen
- **Timezone picker** — set chart time to any major financial timezone (NY, London, Tokyo, etc.)
- **Dark / light theme** — toggle with one click, persists across sessions
- **State persistence** — drawings, indicators, candle colours, and pane layouts saved to localStorage and restored automatically
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

## Drawing Tools

Open with the **DRAW** button in any pane toolbar. All drawings save per symbol and appear across every timeframe.

| Tool | How to draw | Notes |
|---|---|---|
| Fibonacci | Click & drag swing low → high | Levels editable per symbol |
| Trendline | Click & drag point A → B | Drag endpoints to adjust |
| Horizontal Line | Click at desired price | Price alert toggle available |
| Vertical Line | Click at desired time | |
| Long Position | Click entry, drag to stop loss | TP auto-set at 1:1 R:R |
| Short Position | Click entry, drag to stop loss | TP auto-set at 1:1 R:R |

**Interacting with drawn lines:** Click any line to open its edit panel (colour, lock, delete). Click elsewhere to dismiss. Click the line again to reopen.

**Lock:** Each edit panel has a 🔓/🔒 button. Locked drawings cannot be moved by accident — the panel still opens for inspection or deletion.

**Position blocks** show a floating panel with TP/SL prices, pip distances, R:R ratio, and a risk calculator (account $, risk %, lot size → risk $, lots, units, TP $). The block is anchored to the entry candle and can be resized by dragging its right edge.

---

## Candle Style

Open the **DRAW** flyout and scroll to **CANDLE STYLE** at the bottom. Six colour pickers let you set:

- Bull Fill / Bull Border / Bull Wick
- Bear Fill / Bear Border / Bear Wick

The **⊘** button next to Bull Fill and Bear Fill toggles transparent/hollow candle bodies. Changes apply live to all panes and persist across sessions. The **↺ Reset Defaults** button restores the original green/red scheme.

---

## Multi-Monitor

- **Pane popout** (⧉ in pane toolbar) — pops that chart into a new window; full indicator and drawing tools available
- **Full terminal** (⧉ in topbar) — opens a complete second Joshua Terminal instance on the second screen

---

## Notes / Journal

Each pane has a notes button (📝). Click it to open the notes panel for that symbol. Add notes with tags (Idea, Trade, Risk, Misc). Notes persist in localStorage per symbol. A gold dot on the button indicates a symbol has notes.

---

## Symbol Reference

| Source | Format | Examples |
|---|---|---|
| **OANDA** | Slash format | EUR/USD, GBP/USD, XAU/USD |
| **Yahoo Finance** | Various | EURUSD=X, AAPL, ^GSPC, GC=F |
| **Hyperliquid** | Coin name | BTC, ETH, SOL, AVAX |

---

## Tips

- **Full cache clear** if changes do not appear — browser caching is aggressive on JS and CSS files (`Cmd+Shift+R` / `Ctrl+Shift+R`)
- **Save your drawings** with the SAVE button — amber dot means unsaved changes
- **Drawings follow the symbol**, not the timeframe — your EURUSD lines appear on every interval
- **Indicators are per timeframe** — RSI on 15m is saved separately from RSI on 1h
- **Candle width is saved per symbol** — resize once, it restores automatically on every timeframe switch
- **Debug endpoint** — `http://localhost:5050/debug` shows data source health

---

## Extending

**Add a data source:** Implement `get_candles()` and `get_price()` in `data_source.py`.

**Add an indicator:** Add the maths to `indicators.js`, add a definition to `INDICATOR_DEFS` in `pane.js`, add a `case` to `_addIndicator()`.

**Add an alert type:** Call `AlertEngine.trigger(payload)` with `type`, `direction`, `level`, `current`, `label` — the engine handles browser and Telegram delivery automatically.
