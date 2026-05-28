# Joshua Terminal — Setup Guide

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.9 or later | Check with: `python --version` |
| pip | Any modern version | Comes with Python |
| Browser | Chrome / Edge | Chrome recommended for PWA install |
| OANDA account | Practice or Live | Free at oanda.com — needed for real-time forex |

---

## 2. Install Python dependencies

```bash
cd joshua_terminal
pip install -r requirements.txt
```

### For AI analysis snapshots (Playwright)

```bash
pip install playwright
playwright install chromium
```

> **Note on macOS:** If `playwright` is not on your PATH after install, add this to `~/.zshrc`:
> ```bash
> export PATH="$HOME/Library/Python/3.9/bin:$PATH"
> ```
> Then `source ~/.zshrc` and run `playwright install chromium`.

---

## 3. Configure your credentials

Copy the template and fill it in:

```bash
cp .env.example .env
```

Open `.env` in a text editor:

```
# OANDA — real-time forex prices and candle data
OANDA_API_KEY=your_personal_access_token
OANDA_ACCOUNT_ID=your_account_id
OANDA_ENV=practice          # use 'live' for a real-money account

# Telegram — optional, for price alert messages
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=-123456789

# SSL — optional, enables PWA standalone mode (see section 6)
SSL_CERT=localhost.pem
SSL_KEY=localhost-key.pem

# Snapshot system — optional
SNAPSHOT_KEEP_DAYS=7        # days to keep analysis PNGs (0 = keep forever)
```

### Getting OANDA credentials

1. Go to [oanda.com](https://www.oanda.com/) and create a free practice account
2. In **My Account → Manage API Access**, generate a Personal Access Token
3. Copy your Account ID from the account dashboard

### Getting Telegram credentials (optional)

1. Message `@BotFather` on Telegram → `/newbot` → follow the prompts → copy the token
2. Add the bot to a group or send it a message directly
3. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in your browser
4. Find `"chat":{"id": -XXXXXXX}` — that number (including the minus sign) is your Chat ID

> Group chat IDs are always negative numbers.

---

## 4. Start the terminal

```bash
python app.py
```

Open your browser at: **http://localhost:5050**

The startup banner shows which data source is active:

```
╔═══════════════════════════════════════════════╗
║  Joshua Terminal   →  http://localhost:5050    ║
║  Forex source: oanda                          ║
╚═══════════════════════════════════════════════╝
```

---

## 5. Verify everything is working

Visit: **http://localhost:5050/debug**

You should see `"OK — N candles"` for your active data sources.

---

## 6. Install as a Standalone App (PWA)

Joshua Terminal supports installation as a Progressive Web App. When installed, it runs in its own window with no browser chrome, appears in your dock or taskbar, and browser extensions do not interfere.

**Chrome only enables full standalone PWA mode over HTTPS.** On plain HTTP, some browser UI remains visible.

### Step 1 — Install mkcert

mkcert creates a locally-trusted SSL certificate. Install it once per machine:

**macOS (Homebrew):**
```bash
brew install mkcert
mkcert -install
```

**Windows (Chocolatey):**
```bash
choco install mkcert
mkcert -install
```

> `mkcert -install` adds a local root certificate to your system's trust store. Safe and only trusted on your own machine. Run once per machine.

### Step 2 — Generate the localhost certificate

Run this from inside the JT project folder:

```bash
mkcert localhost
```

This produces:
- `localhost.pem` — the certificate
- `localhost-key.pem` — the private key

> Keep `localhost-key.pem` private. Do not commit it to version control.

### Step 3 — Configure .env

```
SSL_CERT=localhost.pem
SSL_KEY=localhost-key.pem
```

> If SSL files are set in .env but missing from disk, the terminal starts normally over HTTP — it does not crash.

### Step 4 — Start and install

```bash
python app.py
```

The banner confirms:
```
║  🔒 SSL enabled (PWA standalone mode)
```

Open Chrome at `https://localhost:5050`. Look for the install icon (⊕) in the address bar, or use Chrome menu → **Install Joshua Terminal**.

| Scenario | Result |
|---|---|
| HTTPS + certs present | Full standalone window, no browser UI |
| HTTP (no certs) | PWA installs but browser UI remains |
| Certs in .env but files missing | Falls back to HTTP silently |
| New machine (no mkcert) | Falls back to HTTP — run mkcert on that machine |

### Porting to another machine

The SSL certificate is machine-specific. On a new machine:
1. `mkcert -install`
2. `mkcert localhost` from the project folder
3. `.env` values do not need to change if paths are the same

---

## 7. AI Analysis Pipeline Setup

### In your analysis folder

```bash
pip install anthropic requests
```

Create `.env` in your analysis folder:

```
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-opus-4-5
PAIRS=PEPPERSTONE:EURUSD,PEPPERSTONE:AUDJPY,PEPPERSTONE:GBPUSD,PEPPERSTONE:USDJPY
TIMEFRAMES=4H,15
REPORT_DIR=./reports
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=-123456789
```

### Migrate existing drawings (one time only)

If you have saved drawings in JT, export them to the server once:

1. Open JT in Chrome, open DevTools (F12) → Console
2. Paste the entire contents of `migrate_state.js` and press Enter
3. Watch the console — each symbol will be confirmed as uploaded

From then on, every SAVE click in JT automatically syncs drawings to the server. No further migration needed.

### Test before first full run

```bash
# Captures charts + saves PNGs locally — no Claude API call
python run_analysis.py --dry-run --save-screenshots
```

Inspect the saved PNGs. Verify:
- All 8 charts captured (4 pairs × 2 timeframes)
- S/D zones and indicators visible
- 8-bar right-side gap visible
- 4H shows ~90 days history, 15M shows ~5 days

### Full analysis run

```bash
python run_analysis.py
```

Reports saved to `reports/forex_analysis_<date>.md` and sent to Telegram if configured.

---

## 8. Troubleshooting

| Problem | Solution |
|---|---|
| Changes don't appear after update | Hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows/Linux) |
| No OANDA data | Check `.env` has correct keys. Visit `/debug` to verify connections |
| Telegram alerts not firing | Check `TELEGRAM_CHAT_ID` — group chat IDs are negative numbers |
| Drawings disappeared | Click SAVE — drawings are not auto-saved. Check Saved States manager |
| Snapshot returns 500 | Check JT console for error. Ensure `playwright install chromium` was run with the same Python that runs `app.py` |
| Snapshot charts have no drawings | Run `migrate_state.js` in browser console, or click SAVE in JT after loading each pair |
| `playwright` command not found | Add `~/Library/Python/3.9/bin` to PATH (macOS) |
| PWA install icon not showing | Must be on `https://localhost:5050`. Refresh once after service worker registers |
| SSL cert error on new machine | Run `mkcert -install` then `mkcert localhost` in the project folder |
| Sub-pane oscillators not syncing | Known LWC limitation — scroll the chart once after load |

---

## 9. Changing the port

Edit the last line of `app.py`:

```python
socketio.run(app, host="0.0.0.0", port=5050, ...)
```

Also set `JT_PORT=5051` in your analysis `.env` if you change from 5050.
