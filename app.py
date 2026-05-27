"""
app.py — Joshua Terminal backend
Runs on http://localhost:5050
"""

import json, threading, time, logging, os
import websocket as ws_client
import requests as http_requests
from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO
from dotenv import load_dotenv
import data_source as ds

load_dotenv()

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID",   "")

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = "trading_terminal_secret"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ─── Disable browser cache for JS/CSS so updates are always picked up ────────

@app.after_request
def no_cache_static(response):
    # Only bust cache on JS and CSS assets, not API responses
    path = request.path
    if path.startswith('/static/') and (path.endswith('.js') or path.endswith('.css')):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma']        = 'no-cache'
        response.headers['Expires']       = '0'
    return response


# ─── Hyperliquid WS (allMids) ────────────────────────────────────────────────

HL_WS_URL = "wss://api.hyperliquid.xyz/ws"

class HyperliquidManager:
    def __init__(self):
        self.ws          = None
        self.running     = False
        self.prev_prices = {}
        self._connected  = False

    def start(self):
        if self.running: return
        self.running = True
        threading.Thread(target=self._run, daemon=True).start()

    def _send(self, msg):
        if self.ws and self._connected:
            try: self.ws.send(json.dumps(msg))
            except Exception as e: logger.warning(f"HL send: {e}")

    def _run(self):
        def on_open(ws):
            self._connected = True
            logger.info("HL WS connected → allMids")
            self._send({"method":"subscribe","subscription":{"type":"allMids"}})

        def on_message(ws, message):
            try:
                data = json.loads(message)
                if data.get("channel") == "allMids":
                    mids = data.get("data", {}).get("mids", {})
                    updates = []
                    for sym, px_str in mids.items():
                        try: price = float(px_str)
                        except: continue
                        prev = self.prev_prices.get(sym, price)
                        self.prev_prices[sym] = price
                        updates.append({
                            "symbol": sym, "price": price,
                            "change": round(price-prev, 8),
                            "change_pct": round((price-prev)/prev*100, 4) if prev else 0,
                            "dir": "up" if price >= prev else "down",
                        })
                    if updates:
                        socketio.emit("hl_mids", {"updates": updates})
            except Exception as e:
                logger.warning(f"HL msg: {e}")

        def on_error(ws, e):
            logger.error(f"HL error: {e}")
            self._connected = False

        def on_close(ws, *a):
            logger.info("HL WS closed — reconnect in 5s")
            self._connected = False
            self.running = False
            time.sleep(5)
            self.running = True
            self._run()

        self.ws = ws_client.WebSocketApp(
            HL_WS_URL, on_open=on_open, on_message=on_message,
            on_error=on_error, on_close=on_close)
        self.ws.run_forever(ping_interval=20, ping_timeout=10)

hl_manager = HyperliquidManager()


# ─── OANDA streaming price thread ────────────────────────────────────────────
#
# When OANDA is the active source, we open a persistent HTTP streaming
# connection to /v3/accounts/{id}/pricing/stream for all subscribed forex
# symbols.  Each newline-delimited JSON tick is broadcast as "oanda_price".
#
# The browser-side handler in app.js listens to "oanda_price" the same way
# it already listens to "yf_price" — just change the event name in app.js
# (see note below).

# ─── OANDA streaming price thread ────────────────────────────────────────────
#
# Opens a single persistent HTTP stream for all subscribed forex symbols.
# Restarts cleanly whenever the symbol list changes.
# Emits "oanda_price" via Socket.IO on every tick.

class OandaStreamManager:
    def __init__(self):
        self._subscribed = set()   # set of OANDA instrument strings e.g. EUR_USD
        self._lock       = threading.Lock()
        self._prev       = {}
        self._thread     = None
        self._stop_flag  = threading.Event()

    # ── public API ──────────────────────────────────────

    def subscribe(self, symbol: str):
        instrument = ds._oanda_instrument(symbol)
        with self._lock:
            if instrument in self._subscribed:
                return
            self._subscribed.add(instrument)
        logger.info(f"OANDA stream +subscribe {instrument}")
        self._restart()

    def unsubscribe(self, symbol: str):
        instrument = ds._oanda_instrument(symbol)
        with self._lock:
            self._subscribed.discard(instrument)
        self._restart()

    # ── internals ────────────────────────────────────────

    def _restart(self):
        # Signal the running thread to stop
        self._stop_flag.set()
        # Wait briefly for it to notice (it checks the flag between lines)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self._stop_flag.clear()

        with self._lock:
            instruments = list(self._subscribed)
        if not instruments:
            return

        self._thread = threading.Thread(
            target=self._run, args=(instruments,), daemon=True, name="oanda-stream")
        self._thread.start()

    def _run(self, instruments: list):
        if not ds.OANDA_API_KEY or not ds.OANDA_ACCOUNT_ID:
            logger.error("OANDA stream: missing API key or account ID — cannot stream")
            return

        import requests as req

        stream_base = ds.oanda_stream_url()
        url = f"{stream_base}/v3/accounts/{ds.OANDA_ACCOUNT_ID}/pricing/stream"
        params  = {"instruments": ",".join(instruments)}
        headers = ds._oanda_headers()

        logger.info(f"OANDA stream connecting → {instruments}")

        while not self._stop_flag.is_set():
            try:
                # No timeout on the outer request — it's an infinite stream.
                # We use a short connect timeout but no read timeout.
                with req.get(url, headers=headers, params=params,
                             stream=True, timeout=(10, None)) as r:

                    if r.status_code == 401:
                        logger.error("OANDA stream 401 — bad API key or wrong env (practice vs live)")
                        return
                    if r.status_code == 403:
                        logger.error("OANDA stream 403 — account not authorised for streaming")
                        return
                    r.raise_for_status()

                    logger.info("OANDA stream connected ✓")

                    for raw_line in r.iter_lines():
                        if self._stop_flag.is_set():
                            break
                        if not raw_line:
                            continue
                        try:
                            tick = json.loads(raw_line)
                        except Exception:
                            continue

                        ttype = tick.get("type")
                        if ttype == "HEARTBEAT":
                            continue
                        if ttype != "PRICE":
                            continue

                        instrument = tick.get("instrument", "")
                        # Convert EUR_USD → EUR/USD for frontend symbol matching
                        symbol_slash = instrument.replace("_", "/")

                        bids = tick.get("bids", [])
                        asks = tick.get("asks", [])
                        if not bids or not asks:
                            continue

                        bid   = float(bids[0]["price"])
                        ask   = float(asks[0]["price"])
                        price = round((bid + ask) / 2, 6)

                        prev  = self._prev.get(instrument, price)
                        self._prev[instrument] = price
                        chg   = round(price - prev, 6)
                        pct   = round((chg / prev * 100) if prev else 0, 4)

                        socketio.emit("oanda_price", {
                            "symbol":     symbol_slash,
                            "price":      price,
                            "bid":        bid,
                            "ask":        ask,
                            "change":     chg,
                            "change_pct": pct,
                            "dir":        "up" if price >= prev else "down",
                        })

            except Exception as e:
                if self._stop_flag.is_set():
                    break
                logger.error(f"OANDA stream error: {e} — reconnecting in 5s")
                time.sleep(5)

        logger.info("OANDA stream thread stopped")


oanda_stream = OandaStreamManager()


# ─── YF/fallback polling (used when OANDA key is absent) ────────────────────

yf_subs  = {}   # symbol → prev_price
yf_lock  = threading.Lock()

def poll_loop():
    while True:
        time.sleep(5)
        with yf_lock:
            symbols = list(yf_subs.keys())
        for sym in symbols:
            try:
                info  = ds.get_price(sym)
                price = info["price"]
                if not price: continue
                prev = yf_subs.get(sym) or price
                with yf_lock:
                    yf_subs[sym] = price
                socketio.emit("yf_price", {
                    "symbol": sym, "price": price,
                    "change": info["change"], "change_pct": info["change_pct"],
                    "dir": "up" if price >= prev else "down",
                })
            except Exception as e:
                logger.warning(f"poll {sym}: {e}")

threading.Thread(target=poll_loop, daemon=True).start()


# ─── Hyperliquid candle REST ─────────────────────────────────────────────────

HL_IV = {"1m":"1m","3m":"3m","5m":"5m","15m":"15m","30m":"30m",
         "1h":"1h","2h":"2h","4h":"4h","8h":"8h","12h":"12h","1d":"1d","1w":"1w"}
HL_IV_SECS = {"1m":60,"3m":180,"5m":300,"15m":900,"30m":1800,
              "1h":3600,"2h":7200,"4h":14400,"8h":28800,"12h":43200,"1d":86400,"1w":604800}

def hl_get_candles(symbol, interval, limit):
    import requests as req
    iv    = HL_IV.get(interval, "15m")
    now   = int(time.time()*1000)
    start = now - HL_IV_SECS.get(interval,900)*1000*(limit+20)
    try:
        r = req.post("https://api.hyperliquid.xyz/info",
            json={"type":"candleSnapshot","req":{"coin":symbol,"interval":iv,
                  "startTime":start,"endTime":now}},
            headers={"Content-Type":"application/json"}, timeout=10)
        r.raise_for_status()
        raw = r.json()
        if not isinstance(raw, list): return []
        out = []
        for c in raw:
            try:
                out.append({"time":int(c["t"])//1000,
                    "open":float(c["o"]),"high":float(c["h"]),
                    "low":float(c["l"]),"close":float(c["c"]),
                    "volume":float(c.get("v",0))})
            except: pass
        out.sort(key=lambda x: x["time"])
        return out[-limit:]
    except Exception as e:
        logger.error(f"HL candles {symbol}: {e}")
        return []


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/popout")
def popout():
    symbol   = request.args.get("symbol",   "EUR/USD")
    interval = request.args.get("interval", "15m")
    source   = request.args.get("source",   "oanda")
    return render_template("popout.html", symbol=symbol, interval=interval, source=source)


@app.route("/tools/pine-converter")
def pine_converter():
    return render_template("pine-converter.html")


@app.route("/debug")
def debug():
    results = {"active_source": ds.get_active_source()}
    try:
        c = ds.get_candles("EUR/USD", "15m", 5)
        results["forex_EURUSD"] = f"OK — {len(c)} candles" + (f", last={c[-1]['close']}" if c else "")
    except Exception as e:
        results["forex_EURUSD"] = f"ERROR: {e}"
    try:
        c = hl_get_candles("BTC","15m",5)
        results["hl_BTC"] = f"OK — {len(c)} candles" + (f", last={c[-1]['close']}" if c else "")
    except Exception as e:
        results["hl_BTC"] = f"ERROR: {e}"
    return jsonify(results)


@app.route("/api/candles")
def api_candles():
    symbol   = request.args.get("symbol","EURUSD").upper()
    interval = request.args.get("interval","15m")
    limit    = int(request.args.get("limit",300))
    source   = request.args.get("source","oanda")

    if source == "hyperliquid":
        candles = hl_get_candles(symbol, interval, limit)
    else:
        candles = ds.get_candles(symbol, interval, limit)

    return jsonify({"symbol":symbol,"interval":interval,
                    "source":source,"count":len(candles),"candles":candles})


@app.route("/api/symbols/forex")
def api_forex_symbols():
    return jsonify(FOREX_PAIRS)


@app.route("/api/symbols/hyperliquid")
def api_hl_symbols():
    import requests as req
    try:
        r = req.post("https://api.hyperliquid.xyz/info",
            json={"type":"meta"}, timeout=6)
        syms = sorted([u["name"] for u in r.json().get("universe",[])])
        return jsonify(syms)
    except:
        return jsonify(["BTC","ETH","SOL","AVAX","ARB","OP","DOGE","LINK","MATIC","SUI"])


@app.route("/api/config")
def api_config():
    return jsonify({
        "active_source":    ds.get_active_source(),
        "has_oanda_key":    bool(ds.OANDA_API_KEY),
        "has_oanda_account":bool(ds.OANDA_ACCOUNT_ID),
        "oanda_env":        ds.OANDA_ENV,
    })


@app.route("/api/alert", methods=["POST"])
def api_alert():
    payload   = request.get_json(silent=True) or {}
    symbol    = payload.get("symbol",    "?")
    interval  = payload.get("interval",  "")
    direction = payload.get("direction", "")
    level     = payload.get("level",     0)
    current   = payload.get("current",   0)
    label     = payload.get("label",     "Alert")
    dir_arrow = "▲" if direction == "above" else "▼"
    dir_text  = "crossed above" if direction == "above" else "crossed below"
    dec = 2 if level >= 10 else (4 if level >= 1 else 5)
    message = (
        f"🔔 *{symbol}* {dir_arrow} {dir_text} `{level:.{dec}f}`\n"
        f"_{label}_ · {interval} · Current: `{current:.{dec}f}`"
    )
    result = {"browser": True, "telegram": False, "error": None}
    if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
        try:
            resp = http_requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "Markdown"},
                timeout=5,
            )
            result["telegram"] = resp.ok
            if not resp.ok: result["error"] = resp.text
        except Exception as e:
            result["error"] = str(e)
    else:
        result["error"] = "Telegram not configured"
    return jsonify(result)


# ─── SocketIO ────────────────────────────────────────────────────────────────

@socketio.on("subscribe_yf")
def on_sub_yf(data):
    sym = data.get("symbol","").upper()
    if not sym: return
    if ds.ACTIVE_FOREX_SOURCE == "oanda":
        # Route to OANDA streaming instead of YF polling
        oanda_stream.subscribe(sym)
    else:
        with yf_lock:
            yf_subs.setdefault(sym, 0)
    logger.info(f"Subscribed: {sym}")

@socketio.on("unsubscribe_yf")
def on_unsub_yf(data):
    sym = data.get("symbol","").upper()
    if ds.ACTIVE_FOREX_SOURCE == "oanda":
        oanda_stream.unsubscribe(sym)
    else:
        with yf_lock: yf_subs.pop(sym, None)

@socketio.on("connect")
def on_connect(): logger.info(f"Browser: {request.sid}")
@socketio.on("disconnect")
def on_disconnect(): logger.info(f"Gone: {request.sid}")


# ─── Forex pairs list ────────────────────────────────────────────────────────
# These are displayed in the symbol dropdown and also control what OANDA
# instruments are offered.  OANDA accepts EUR_USD format; the _oanda_instrument()
# helper converts EUR/USD automatically.

FOREX_PAIRS = {
    "Majors": [
        "EUR/USD","GBP/USD","USD/JPY","AUD/USD","USD/CAD",
        "USD/CHF","NZD/USD","EUR/GBP","EUR/JPY","GBP/JPY",
    ],
    "Minors": [
        "EUR/NZD","EUR/AUD","EUR/CAD","GBP/AUD","GBP/CAD",
        "GBP/NZD","AUD/CAD","AUD/NZD","CAD/JPY","CHF/JPY",
        "NZD/CAD","NZD/JPY","AUD/CHF","CAD/CHF","EUR/CHF",
    ],
    "Exotics": [
        "USD/SGD","USD/HKD","USD/NOK","USD/SEK","USD/DKK",
        "USD/MXN","USD/ZAR","USD/TRY","USD/PLN","USD/HUF",
    ],
    "Metals": [
        "XAU/USD","XAG/USD",
    ],
    "Indices": [
        "SPX500_USD","NAS100_USD","DE30_EUR","UK100_GBP","JP225_USD",
    ],
    "Crypto (YF)": [
        "BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD",
    ],
}

if __name__ == "__main__":
    src  = ds.get_active_source()
    env  = ds.OANDA_ENV if src == "oanda" else ""
    print("\n  ╔═══════════════════════════════════════════════╗")
    print(f"  ║  Joshua Terminal   →  http://localhost:5050    ║")
    print(f"  ║  Forex source: {src:<30}║")
    if src == "oanda":
        print(f"  ║  OANDA env:    {env:<30}║")
        if not ds.OANDA_ACCOUNT_ID:
            print("  ║  ⚠  No OANDA_ACCOUNT_ID — live prices limited  ║")
    else:
        print("  ║  ⚠  No OANDA key — using yfinance fallback      ║")
        print("  ║     Get a free key: oanda.com (practice acct)   ║")
    print("  ╚═══════════════════════════════════════════════╝\n")
    hl_manager.start()
    socketio.run(app, host="0.0.0.0", port=5050, debug=False, use_reloader=False)
