# Joshua Terminal — Setup Guide

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.10 or later | Check with: `python --version` |
| pip | Any modern version | Comes with Python |
| Browser | Chrome / Firefox / Edge | Safari works but less tested |
| OANDA account | Practice or Live | Free at oanda.com — needed for real-time forex |

---

## 2. Install Python dependencies

```bash
cd joshua_terminal
pip install -r requirements.txt
```

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
```

### Getting OANDA credentials

1. Go to [oanda.com](https://www.oanda.com/) and create a free practice account
2. In **My Account → Manage API Access**, generate a Personal Access Token
3. Copy your Account ID from the account dashboard

### Getting Telegram credentials (optional)

1. Message `@BotFather` on Telegram → `/newbot` → follow the prompts → copy the token
2. Add the bot to a group or send it a message directly
3. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in your browser
4. Find `"chat":{"id": -XXXXXXX}` in the response — that number (including the minus sign) is your Chat ID

> Group chat IDs are always negative numbers. A common mistake is using the positive version — it will return a "chat not found" error.

---

## 4. Start the terminal

```bash
python app.py
```

Open your browser at: **http://localhost:5050**

The startup banner in your terminal will show which data source is active:

```
╔═══════════════════════════════════════════════╗
║  Joshua Terminal   →  http://localhost:5050    ║
║  Forex source: oanda                          ║
╚═══════════════════════════════════════════════╝
```

---

## 5. Verify everything is working

Visit: **http://localhost:5050/debug**

This fetches a few candles from each data source and returns the results as JSON. You should see `"OK — N candles"` for your active sources.

---

## Without an OANDA key

The terminal still works without OANDA credentials. It falls back to Yahoo Finance for candle data (approximately 15 minutes delayed on forex) and polls prices every 5 seconds instead of streaming. Hyperliquid crypto data is always real-time regardless.

---

## Forex symbol format

| Source | Format |
|---|---|
| OANDA | `EUR/USD`  `GBP/USD`  `USD/JPY`  `XAU/USD` |
| Yahoo Finance | `EURUSD=X`  `AAPL`  `^GSPC`  `GC=F` |
| Hyperliquid | `BTC`  `ETH`  `SOL`  `AVAX` |

---

## If charts are blank

1. Open browser DevTools (F12) → Console tab — look for error messages
2. Visit `http://localhost:5050/debug` to check data source health
3. Verify your OANDA keys are set correctly in `.env`
4. If the page looks wrong after an update — do a **full cache clear** (last 24 hours), not just a hard refresh

---

## Changing the port

Edit the last line of `app.py`:

```python
socketio.run(app, host="0.0.0.0", port=5050, ...)
```

Change `5050` to any available port.
