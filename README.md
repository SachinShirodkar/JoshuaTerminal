# Joshua Terminal 🖥

A free, local, self-hosted multi-chart trading dashboard — your personal TradingView replacement.
Built with Flask + Socket.IO (backend), Lightweight Charts (frontend), and plain HTML/CSS/JS.
Includes an integrated AI analysis pipeline that captures your charts (with all drawings and indicators) and sends them to Claude for supply/demand zone analysis.

---

## Features

- **Multi-chart grid** — 1, 2, 4, 6, or 8 panes, each fully independent
- **Live prices** — OANDA v20 real-time streaming (forex), Hyperliquid WebSocket (crypto), yfinance fallback
- **28+ technical indicators** — MAs, Bollinger, Keltner, Donchian, Ichimoku, Parabolic SAR, RSI, RSI Divergence, MACD, Stoch RSI, CMF, Momentum, S/D Zones & Auto Fib, Order Blocks, and more
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
- **Candle countdown timer** — live countdown to next candle close in the ticker bar; adaptive format (MM:SS for ≤15m, `1h 23m` for intraday, `14h 32m` for daily, `2d 14h` for weekly); pulses amber when under 10% of candle duration remains
- **World clock** — UTC, New York, London, Tokyo times in topbar
- **Session indicator** — Asia / London / US Open / Overlap / Pre-market / After Hours / Weekend
- **AI analysis pipeline** — headless Playwright snapshots of your live charts (with S/D zones and indicators) sent to Claude for automated forex analysis, report saved locally and delivered via Telegram

---

## Quick Start

### 1. Prerequisites

- Python 3.9+
- A free OANDA practice account — [oanda.com](https://www.oanda.com/) (for real-time forex)

### 2. Install dependencies

**With uv (recommended):**
```bash
cd joshua_terminal
uv python pin 3.12        # pin Python version
uv sync                   # install all deps from pyproject.toml
uv run playwright install chromium
```

**Without uv:**
```bash
cd joshua_terminal
pip install -r requirements.txt
pip install playwright && playwright install chromium
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
OANDA_API_KEY=your_token_here
OANDA_ACCOUNT_ID=your_account_id
OANDA_ENV=practice

TELEGRAM_BOT_TOKEN=your_bot_token    # optional — for price alerts
TELEGRAM_CHAT_ID=-123456789          # note: group chat IDs are negative

SNAPSHOT_KEEP_DAYS=7                 # optional — days to retain analysis snapshots
```

### 4. Run

```bash
uv run python app.py      # with uv
# or
python app.py             # without uv
```

Open your browser at **http://localhost:5050**

> Without an OANDA key the terminal still works — it falls back to Yahoo Finance (15-minute delay) and polls prices every 5 seconds.

---

## AI Analysis Pipeline

Joshua Terminal includes a headless chart capture system that replaces the TradingView MCP dependency entirely. Your saved drawings (S/D zones, Fibonacci levels, trendlines) and indicators are preserved in every snapshot.

### How it works

1. `snapshot_runner.py` calls `POST /api/snapshot` on the running JT server
2. Flask launches Playwright headless Chromium, navigates to an internal plain-HTTP port
3. The chart renders with your actual saved state (drawings + indicators)
4. Playwright screenshots the chart and returns the PNG as base64
5. `run_analysis.py` collects all pair × timeframe snapshots and sends them to Claude
6. Analysis saved to `reports/` and optionally sent via Telegram

### Setup (in your analysis folder)

```bash
# analysis .env
ANTHROPIC_API_KEY=your_key
PAIRS=PEPPERSTONE:EURUSD,PEPPERSTONE:AUDJPY,PEPPERSTONE:GBPUSD,PEPPERSTONE:USDJPY
TIMEFRAMES=4H,15
REPORT_DIR=./reports
```

### Run analysis

```bash
# Test first — inspect PNGs before spending API credits
python run_analysis.py --dry-run --save-screenshots

# Full run
python run_analysis.py
```

### Before first run — migrate your drawings

If you have existing saved drawings in JT, run this once in your browser's DevTools console while JT is open to export them to the server (so Playwright can find them):

Open DevTools → Console → paste contents of `migrate_state.js` → Enter

From then on, every SAVE click in JT automatically syncs drawings to the server.

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

**Lock:** Each edit panel has a 🔓/🔒 button. Locked drawings cannot be moved — panel still opens for inspection or deletion.

---

## Candle Style

Open **DRAW** → scroll to **CANDLE STYLE**. Six colour pickers: Bull/Bear Fill, Border, Wick. The **⊘** button toggles transparent/hollow candles. **↺ Reset Defaults** restores green/red. Changes apply live to all panes.

---

## Multi-Monitor

- **Pane popout** (⧉ in pane toolbar) — pops that chart into a new window
- **Full terminal** (⧉ in topbar) — opens a complete second Joshua Terminal instance

---

## PWA / Standalone Mode

Install as a standalone app (no browser chrome) using HTTPS + mkcert. See `SETUP.md` for full instructions.

---

## Running as a macOS Service

Joshua Terminal can run as a background launchd service — starts at login, restarts on crash, no open terminal needed.

```bash
# 1. Create log directory
mkdir -p ~/Library/Logs/JoshuaTerminal

# 2. Edit com.joshuaterminal.app.plist — fill in your Python path and project path

# 3. Install and start
cp com.joshuaterminal.app.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.joshuaterminal.app.plist

# Verify
launchctl list | grep joshuaterminal
curl http://localhost:5050/debug

# Restart after config changes
launchctl unload ~/Library/LaunchAgents/com.joshuaterminal.app.plist
launchctl load   ~/Library/LaunchAgents/com.joshuaterminal.app.plist

# Watch logs
tail -f ~/Library/Logs/JoshuaTerminal/stderr.log
```

See `SETUP.md` Section 8 for full details including virtualenv usage and SSL cert behaviour.

> **Linux:** The Python code and `.env` are platform-neutral. Only the service unit file differs — a systemd unit will be added when the Linux port is undertaken.

---

## Tips

- **Save your drawings** with the SAVE button — amber dot means unsaved changes. Saving also syncs drawings to the server so they appear in AI analysis snapshots
- **Drawings follow the symbol**, not the timeframe — your EURUSD lines appear on every interval
- **Indicators are per timeframe** — RSI on 15m is saved separately from RSI on 1h
- **Full cache clear** if changes do not appear — `Cmd+Shift+R` / `Ctrl+Shift+R`
- **Debug endpoint** — `http://localhost:5050/debug` shows data source health
- **Snapshot list** — `https://localhost:5050/api/snapshot/list` shows all captured PNGs

---

## Extending

**Add a data source:** Implement `get_candles()` and `get_price()` in `data_source.py`.

**Add an indicator:** Add maths to `indicators.js`, definition to `INDICATOR_DEFS` in `pane.js`, case to `_addIndicator()` (or `_addSubPane()` for subpane types). See `Indicators.md` for conversion notes.

**Add an alert type:** Call `AlertEngine.trigger(payload)` — the engine handles browser and Telegram delivery automatically.
