/**
 * pane.js — ChartPane class
 * Fixed: chart init deferred until after layout is painted (requestAnimationFrame)
 * Fixed: interval list includes 30m, proper dedup, robust error handling
 */

const INTERVALS = ["1m","3m","5m","15m","30m","1h","2h","4h","8h","12h","1d","1w"];

const INDICATOR_DEFS = [
  { group: "Moving Averages", items: [
    { id:"sma20",  label:"SMA (20)",    color:"#2196f3", type:"overlay" },
    { id:"sma50",  label:"SMA (50)",    color:"#ff9800", type:"overlay" },
    { id:"sma200", label:"SMA (200)",   color:"#f44336", type:"overlay" },
    { id:"ema20",  label:"EMA (20)",    color:"#00e676", type:"overlay" },
    { id:"ema50",  label:"EMA (50)",    color:"#ce93d8", type:"overlay" },
    { id:"ema200", label:"EMA (200)",   color:"#ff6b6b", type:"overlay" },
    { id:"vwap",   label:"VWAP",        color:"#f0e040", type:"overlay" },
    { id:"vwma",   label:"VWMA (20)",   color:"#80deea", type:"overlay" },
  ]},
  { group: "Bands & Channels", items: [
    { id:"bb",       label:"Bollinger (20, 2)",  color:"#808080", type:"band" },
    { id:"donchian", label:"Donchian (20)",       color:"#00bcd4", type:"band" },
    { id:"keltner",  label:"Keltner (20, 1.5)",  color:"#9c27b0", type:"band" },
  ]},
  { group: "Trend", items: [
    { id:"supertrend", label:"Supertrend (10, 3)", color:"#ff9800", type:"overlay" },
    { id:"ichimoku",   label:"Ichimoku Cloud",     color:"#26a69a", type:"overlay" },
    { id:"psar",       label:"Parabolic SAR",      color:"#ff9800", type:"overlay" },
    { id:"pivots",     label:"Pivot Points",       color:"#f0a500", type:"overlay" },
  ]},
  { group: "Volume", items: [
    { id:"volume", label:"Volume", color:"#546e7a", type:"subpane" },
  ]},
  { group: "Oscillators", items: [
    { id:"rsi",      label:"RSI (14)",            color:"#ce93d8", type:"subpane" },
    { id:"macd",     label:"MACD (12, 26, 9)",    color:"#2196f3", type:"subpane" },
    { id:"stoch",    label:"Stochastic (14,3,3)", color:"#ff9800", type:"subpane" },
    { id:"stochrsi", label:"Stoch RSI (14)",      color:"#e040fb", type:"subpane" },
    { id:"atr",      label:"ATR (14)",            color:"#78909c", type:"subpane" },
    { id:"adx",      label:"ADX (14)",            color:"#ef5350", type:"subpane" },
    { id:"cci",      label:"CCI (20)",            color:"#ffa726", type:"subpane" },
    { id:"cmf",      label:"CMF (20)",            color:"#26c6da", type:"subpane" },
    { id:"obv",      label:"OBV",                 color:"#26c6da", type:"subpane" },
    { id:"mfi",      label:"MFI (14)",            color:"#ec407a", type:"subpane" },
    { id:"williams", label:"Williams %R",         color:"#00e676", type:"subpane" },
    { id:"momentum", label:"Momentum (10)",       color:"#ffca28", type:"subpane" },
  ]},
  { group: "Others", items: [
   { id: "sd_zones_auto_fib", label: "S/D Zones & Auto Fib", color: "#5b9cf6", type: "overlay" },
   { id: "order_blocks",      label: "Order Blocks",          color: "#DBA632", type: "overlay" },
  ]},
];

window.INDICATOR_DEFS = INDICATOR_DEFS;

class ChartPane {
  constructor(id, container, socket, symbolLists, config = {}) {
    this.id          = id;
    this.container   = container;
    this.socket      = socket;
    this.symbolLists = symbolLists;

    this.source   = config.source   || 'oanda';
    this.symbol   = (config.symbol  || 'EURUSD=X').toUpperCase();
    this.interval = config.interval || '15m';

    this.candles          = [];
    this.activeIndicators = new Set();
    this.indicatorSeries  = {};
    this.subPanes         = {};
    this.chart            = null;
    this.candleSeries     = null;
    this.currentPrice     = null;
    this._ro              = null;

    // ── Drawing tools state ──────────────────────────────
    this.drawingMode      = null;   // 'fib' | null
    this._fibDrawing      = null;   // { startPrice, startTime, series[] } during drag
    this._fibs            = [];     // completed fib drawings [{ series[], levels }]
    this.fibLevels        = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]; // editable
    this._overlayCanvas   = null;   // transparent canvas for mouse events during drag
    this._hoveredFibId    = null;   // fib currently under cursor
    this._previewSeries   = null;   // series shown during drag preview

    // ── Trendline state ──────────────────────────────────
    this._trendlines      = [];   // [{ id, color, ptA:{price,time}, ptB:{price,time} }]
    this._trendDrawing    = null; // { ptA, startPx } while mouse held for new line
    this._trendPreviewPx  = null; // { x1,y1,x2,y2 } raw pixels shown during draw
    this._trendDragging   = null; // { t, ep:'A'|'B' } while dragging endpoint
    this._selectedTrendId = null;

    // ── Horizontal line state ────────────────────────────
    this._hlines          = [];   // [{ id, price, color }]
    this._selectedHlineId = null;
    this._hlineDragging   = null; // { h } while dragging

    // ── Vertical line state ──────────────────────────────
    this._vlines          = [];   // [{ id, time, color }]
    this._selectedVlineId = null;
    this._vlineDragging   = null; // { v } while dragging

    // ── Long/Short position state ────────────────────────
    this._positions       = [];     // committed positions
    this._posDrawing      = null;   // { side, entryPrice } during initial drag
    this._posIdCounter    = 0;
    this._posPreview      = null;   // { side, entryPrice, slPrice, tpPrice } preview
    this._posCanvas       = null;   // shared canvas for block rendering
    this._sdCanvas        = null;   // canvas for S/D zones & fib overlay
    this._sdData          = null;   // { supplyZones, demandZones, fibLevels }
    this._obCanvas        = null;   // canvas for Order Blocks overlay
    this._obData          = null;   // { bearishBlocks, bullishBlocks, bosLines }

    // ── Persistence state ────────────────────────────────
    this._isDirty         = false;  // true when there are unsaved changes
    this._dirtyTimer      = null;   // debounce handle

    // Step 1: build HTML skeleton immediately
    this._buildHTML();
    this._attachEvents();

    // Step 2: init chart only once the container has real pixel dimensions.
    // We use a ResizeObserver that fires as soon as the element is measured.
    this._waitForSize();
  }

  _waitForSize() {
    const el = document.getElementById(`pane-chart-${this.id}`);
    if (!el) { setTimeout(() => this._waitForSize(), 50); return; }

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 10 && height > 10) {
          ro.disconnect();           // only need it once
          this._initChart(width, height);
          this._loadData();
          return;
        }
      }
    });
    ro.observe(el);
    // Fallback: if the element already has size right now
    if (el.offsetWidth > 10 && el.offsetHeight > 10) {
      ro.disconnect();
      this._initChart(el.offsetWidth, el.offsetHeight);
      this._loadData();
    }
  }

  // ── Build HTML skeleton (no chart yet) ─────────────

  _buildHTML() {
    this.container.innerHTML = `
      <div class="pane-toolbar">
        <select class="pane-source-select">
          <option value="oanda"       ${this.source==='oanda'       ? 'selected':''}>OANDA</option>
          <option value="yfinance"    ${this.source==='yfinance'    ? 'selected':''}>Yahoo Finance</option>
          <option value="hyperliquid" ${this.source==='hyperliquid' ? 'selected':''}>Hyperliquid (Crypto)</option>
        </select>
        <div class="symbol-wrap" style="position:relative">
          <input class="pane-symbol-input" type="text"
                 value="${this.symbol}" spellcheck="false" autocomplete="off" />
        </div>
        <select class="pane-interval-select">
          ${INTERVALS.map(i=>`<option value="${i}"${i===this.interval?' selected':''}>${i}</option>`).join('')}
        </select>
        <div class="pane-toolbar-spacer"></div>
        <button class="btn-save-state" title="Save chart state for ${this.symbol}" style="display:none">
          <span class="save-dirty-dot"></span>SAVE
        </button>
        <button class="btn-popout" data-pane="${this.id}" title="Pop out to new window">⧉</button>
        <button class="btn-screenshot" data-pane="${this.id}" title="Save chart as PNG">📷</button>
        <button class="btn-notes" data-pane="${this.id}" title="Notes for ${this.symbol}">📝</button>
        <button class="btn-draw-open ${this.drawingMode ? 'active' : ''}" data-pane="${this.id}" title="Drawing Tools">DRAW</button>
        <button class="btn-indicators" data-pane="${this.id}">INDICATORS</button>
      </div>
      <div class="pane-ticker">
        <span class="ticker-symbol">${this.symbol}</span>
        <span class="ticker-price">—</span>
        <span class="ticker-change">—</span>
        <span class="ticker-arrow">—</span>
        <span class="ticker-spacer"></span>
        <span class="ticker-time"></span>
      </div>
      <div class="pane-chart-wrap">
        <div class="pane-chart" id="pane-chart-${this.id}"></div>
      </div>
    `;
  }

  // ── Init Lightweight Charts ────────────────────────

  _initChart(w, h) {
    const el = document.getElementById(`pane-chart-${this.id}`);
    if (!el) { console.error(`[Pane ${this.id}] chart element not found`); return; }

    // Use measured dimensions, never 0
    w = w || el.offsetWidth  || 600;
    h = h || el.offsetHeight || 400;
    console.log(`[Pane ${this.id}] initChart ${w}x${h}`);

    this.chart = LightweightCharts.createChart(el, {
      width:  w,
      height: h,
      layout: {
        background: { type: 'solid', color: '#0a0c0f' },
        textColor:  '#7a8599',
      },
      grid: {
        vertLines: { color: '#141820' },
        horzLines: { color: '#141820' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color:'#3a4a63', style:1, width:1 },
        horzLine: { color:'#3a4a63', style:1, width:1 },
      },
      rightPriceScale: {
        borderColor:   '#1e2535',
        scaleMargins:  { top: 0.06, bottom: 0.06 },
      },
      timeScale: {
        borderColor:    '#1e2535',
        timeVisible:    true,
        secondsVisible: false,
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });

    this.candleSeries = this.chart.addCandlestickSeries({
      upColor:         '#00e676',
      downColor:       '#ff3d5a',
      borderUpColor:   '#00e676',
      borderDownColor: '#ff3d5a',
      wickUpColor:     '#00e676',
      wickDownColor:   '#ff3d5a',
    });

    // Track ongoing resize (after chart is created)
    this._ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 10 && height > 10 && this.chart) {
          try { this.chart.resize(width, height); } catch(e) {}
        }
      }
    });
    this._ro.observe(el);

    // Attach drawing interaction layer
    this._initDrawingLayer(el);
    // Canvas for coloured position blocks
    this._initPosCanvas(el);

    // Click on chart when NOT drawing → deselect trendline
    this.chart.subscribeClick(param => {
      if (this.drawingMode) return;
      if (!param.point) return;
      const price = this._pixelToPrice(param.point.y);
      if (price === null) return;
      if (!this._trySelectPositionAtPrice(price, param.point.y)) {
        this._trySelectFibAtPrice(price, param.point.y);
      }
      // Trendline clicks are handled by the trendOverlay, not subscribeClick
    });

    // Crosshair move → highlight drawings near cursor
    this.chart.subscribeCrosshairMove(param => {
      if (this.drawingMode || !param.point) return;
      const price = this._pixelToPrice(param.point.y);
      if (price === null) { this._unhighlightFibs(); return; }
      this._hoverFibAtPrice(price, param.point.y);
      this._hoverPositionAtPrice(price, param.point.y);
    });
  }

  // ── Events ──────────────────────────────────────────

  _attachEvents() {
    const sourceEl   = this.container.querySelector('.pane-source-select');
    const symbolEl   = this.container.querySelector('.pane-symbol-input');
    const intervalEl = this.container.querySelector('.pane-interval-select');

    sourceEl.addEventListener('change', () => {
      this._unsubscribeYF();
      this.source = sourceEl.value;
      this._loadData();
    });

    intervalEl.addEventListener('change', () => {
      this.interval = intervalEl.value;
      this._loadData();
    });

    symbolEl.addEventListener('focus',  () => this._showDropdown(symbolEl));
    symbolEl.addEventListener('input',  () => this._filterDropdown());
    symbolEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const v = symbolEl.value.trim().toUpperCase();
        this._closeDropdown();
        if (v && v !== this.symbol) this._changeSymbol(v, symbolEl);
      }
      if (e.key === 'Escape') this._closeDropdown();
    });
    symbolEl.addEventListener('blur', () => setTimeout(() => this._closeDropdown(), 200));

    // Save button
    const saveBtn = this.container.querySelector('.btn-save-state');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this._saveState());
    }

    // Popout button
    const popoutBtn = this.container.querySelector('.btn-popout');
    if (popoutBtn) {
      popoutBtn.addEventListener('click', () => this._popout());
    }

    // Screenshot button
    const shotBtn = this.container.querySelector('.btn-screenshot');
    if (shotBtn) {
      shotBtn.addEventListener('click', () => this._takeScreenshot());
    }

    this.container.addEventListener('mousedown', () => {
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      this.container.classList.add('active');
    });

    // Drawing tool button clicks are handled by the app-level drawing flyout.
    // The DRAW button itself just signals app.js to open the flyout.
    // (btn-draw-open click is wired in app.js via event delegation on the grid)
  }

  // ── Public: called by drawing flyout in app.js ──────────────────────────
  setDrawingTool(tool) {
    // Toggle off if same tool clicked again
    this.drawingMode = (this.drawingMode === tool) ? null : tool;
    this._updateDrawingUI();
  }

  clearAllDrawings() {
    this._clearAllFibs();
    this._clearAllPositions();
    this._trendClearAll();
    this._hlineClearAll();
    this._vlineClearAll();
    this.markDirty();
  }

  // ── Symbol dropdown ──────────────────────────────────

  _showDropdown(input) {
    this._closeDropdown();
    const dd = document.createElement('div');
    dd.className = 'symbol-dropdown';
    const lists = this.source === 'hyperliquid'
      ? { "Crypto Perps": window._hlSymbols || [] }
      : (this.symbolLists || {});
    // symbolLists already has Majors/Minors/Exotics groups from /api/symbols/forex

    for (const [group, symbols] of Object.entries(lists)) {
      const g = document.createElement('div');
      g.className = 'symbol-dropdown-group';
      g.textContent = group;
      dd.appendChild(g);
      (symbols || []).forEach(sym => {
        const item = document.createElement('div');
        item.className = 'symbol-dropdown-item';
        item.textContent = sym;
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          this._changeSymbol(sym, input);
        });
        dd.appendChild(item);
      });
    }

    input.parentElement.appendChild(dd);
    this._activeDropdown = dd;
  }

  _filterDropdown() {
    if (!this._activeDropdown) return;
    const q = this.container.querySelector('.pane-symbol-input').value.toUpperCase();
    this._activeDropdown.querySelectorAll('.symbol-dropdown-item').forEach(el => {
      el.style.display = el.textContent.includes(q) ? '' : 'none';
    });
  }

  _closeDropdown() {
    if (this._activeDropdown) { this._activeDropdown.remove(); this._activeDropdown = null; }
  }

  _changeSymbol(sym, input) {
    this._unsubscribeYF();
    // Save current state before leaving this symbol
    if (this._isDirty) this._saveState();
    // Clear all drawings — new symbol gets its own workspace
    this._clearAllFibs();
    this._clearAllPositions();
    this._trendClearAll();
    this._hlineClearAll();
    this._vlineClearAll();
    this._isDirty = false;
    this.symbol = sym.toUpperCase();
    input.value = this.symbol;
    this.container.querySelector('.ticker-symbol').textContent = this.symbol;
    // Update save button title
    const saveBtn = this.container.querySelector('.btn-save-state');
    if (saveBtn) saveBtn.title = `Save chart state for ${this.symbol}`;
    this._closeDropdown();
    this._loadData();
  }

  // ── Data loading ────────────────────────────────────

  async _loadData() {
    if (!this.chart) {
      // Chart not ready yet, retry shortly
      setTimeout(() => this._loadData(), 100);
      return;
    }
    this._showLoading(true);
    try {
      const url = `/api/candles?symbol=${encodeURIComponent(this.symbol)}&interval=${encodeURIComponent(this.interval)}&source=${this.source}&limit=400`;
      console.log(`[Pane ${this.id}] → ${url}`);

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const data = await res.json();
      console.log(`[Pane ${this.id}] ← ${data.count} candles for ${data.symbol} (${data.source})`);

      if (!data.candles || data.candles.length === 0) {
        this._showError(`No data returned for "${this.symbol}" — try a different symbol or interval`);
        return;
      }

      this.candles = this._dedup(data.candles);
      this._renderCandles();
      this._renderActiveIndicators();
      this._subscribeYF();
      // Restore saved state (drawings shared across intervals, indicators per-interval)
      this._restoreState();

    } catch(e) {
      console.error(`[Pane ${this.id}] fetch error:`, e);
      this._showError(`Fetch failed: ${e.message}`);
    } finally {
      this._showLoading(false);
    }
  }

  _dedup(candles) {
    const seen = new Set();
    return candles
      .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; })
      .sort((a,b) => a.time - b.time);
  }

  _renderCandles() {
    const last = this.candles[this.candles.length - 1];
    if (last) this.currentPrice = last.close;  // set before _symbolPriceFormat

    const { precision, minMove } = this._symbolPriceFormat();
    this.candleSeries.applyOptions({
      priceFormat: { type: 'price', precision, minMove },
    });

    this.candleSeries.setData(this.candles);
    this.chart.timeScale().fitContent();
    if (last) this._updateTicker(last.close, last.close, 0, 0, 'up');
  }

  // ── Live subscriptions ───────────────────────────────

  _subscribeYF() {
    if (this.source !== 'hyperliquid') {
      this.socket.emit('subscribe_yf', { symbol: this.symbol });
    }
    // Hyperliquid: allMids covers all symbols automatically
  }

  _unsubscribeYF() {
    if (this.source !== 'hyperliquid') {
      this.socket.emit('unsubscribe_yf', { symbol: this.symbol });
    }
  }

  // ── Live price tick ──────────────────────────────────

  onPriceUpdate(data) {
    const price = parseFloat(data.price);
    if (!price || isNaN(price)) return;

    const prev = this.currentPrice || price;
    this.currentPrice = price;

    const change    = data.change    || (price - prev);
    const changePct = data.change_pct || 0;
    const dir       = data.dir       || (price >= prev ? 'up' : 'down');

    this._updateTicker(price, prev, change, changePct, dir);

    // Hline alert cross detection
    if (prev !== price && window.AlertEngine) {
      for (const h of this._hlines) {
        if (!h.alert) continue;
        const crossedAbove = prev < h.price && price >= h.price;
        const crossedBelow = prev > h.price && price <= h.price;
        if (crossedAbove || crossedBelow) {
          AlertEngine.trigger({
            symbol:    this.symbol,
            interval:  this.interval,
            type:      'price_cross',
            direction: crossedAbove ? 'above' : 'below',
            level:     h.price,
            current:   price,
            label:     'Horizontal Line',
          });
        }
      }
    }

    if (this.candles.length > 0) {
      const intervalMs = this._intervalToMs(this.interval);
      const nowSec     = Math.floor(Date.now() / 1000);
      const last       = this.candles[this.candles.length - 1];
      const barEndSec  = last.time + Math.floor(intervalMs / 1000);

      if (intervalMs > 0 && nowSec >= barEndSec) {
        // Advance to the next bar boundary (handles gaps if multiple bars missed)
        const barDurSec   = Math.floor(intervalMs / 1000);
        const barsElapsed = Math.floor((nowSec - last.time) / barDurSec);
        const newBarTime  = last.time + barsElapsed * barDurSec;
        const newBar = { time: newBarTime, open: price, high: price, low: price, close: price };
        this.candles.push(newBar);
        try { this.candleSeries.update(newBar); } catch(e) {}
      } else {
        const updated = { ...last, close: price,
          high: Math.max(last.high, price),
          low:  Math.min(last.low,  price) };
        this.candles[this.candles.length - 1] = updated;
        try { this.candleSeries.update(updated); } catch(e) {}
      }
    }
  }

  // Convert interval string to milliseconds
  _intervalToMs(interval) {
    const map = {
      '1m':  60,    '3m':  180,   '5m':   300,  '15m':  900,
      '30m': 1800,  '1h':  3600,  '2h':   7200, '4h':   14400,
      '8h':  28800, '12h': 43200, '1d':   86400, '1w':  604800,
    };
    return (map[interval] || 0) * 1000;
  }

  _updateTicker(price, prev, change, changePct, dir) {
    const ticker   = this.container.querySelector('.pane-ticker');
    const priceEl  = this.container.querySelector('.ticker-price');
    const changeEl = this.container.querySelector('.ticker-change');
    const arrowEl  = this.container.querySelector('.ticker-arrow');
    const timeEl   = this.container.querySelector('.ticker-time');
    if (!ticker) return;

    const dec = this._symbolPriceFormat().dec;
    const isUp = dir === 'up' || price >= prev;

    priceEl.textContent = price.toFixed(dec);
    priceEl.className   = `ticker-price ${isUp ? 'up' : 'down'}`;

    const sign = change >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${change.toFixed(dec)} (${sign}${Number(changePct).toFixed(2)}%)`;
    changeEl.className   = `ticker-change ${change >= 0 ? 'up' : 'down'}`;
    arrowEl.textContent  = isUp ? '▲' : '▼';
    arrowEl.className    = `ticker-arrow ${isUp ? 'up' : 'down'}`;

    ticker.classList.remove('flash-up','flash-down');
    void ticker.offsetWidth;   // force reflow so animation restarts
    ticker.classList.add(isUp ? 'flash-up' : 'flash-down');

    timeEl.textContent = new Date().toTimeString().slice(0,8);
  }

  // ── Indicators ───────────────────────────────────────

  toggleIndicator(id) {
    if (this.activeIndicators.has(id)) {
      this._removeIndicator(id);
      this.activeIndicators.delete(id);
      this._saveIndicators();
      return false;
    }
    this.activeIndicators.add(id);
    this._addIndicator(id);
    this._saveIndicators();
    return true;
  }

  _renderActiveIndicators() {
    for (const id of [...this.activeIndicators]) {
      this._removeIndicator(id);
      this._addIndicator(id);
    }
  }

  _addIndicator(id) {
    if (!this.candles.length || !this.chart) return;
    const c   = this.candles;
    const def = INDICATOR_DEFS.flatMap(g => g.items).find(i => i.id === id);
    if (!def) return;

    const addLine = (data, color, lineWidth=1) => {
      if (!data || !data.length) return null;
      const s = this.chart.addLineSeries({
        color, lineWidth, priceLineVisible:false, lastValueVisible:false,
      });
      s.setData(data);
      return s;
    };

    try {
      switch(id) {
        case 'sma20':  this.indicatorSeries[id] = addLine(Indicators.sma(c,20),  def.color); break;
        case 'sma50':  this.indicatorSeries[id] = addLine(Indicators.sma(c,50),  def.color); break;
        case 'sma200': this.indicatorSeries[id] = addLine(Indicators.sma(c,200), def.color, 2); break;
        case 'ema20':  this.indicatorSeries[id] = addLine(Indicators.ema(c,20),  def.color); break;
        case 'ema50':  this.indicatorSeries[id] = addLine(Indicators.ema(c,50),  def.color); break;
        case 'ema200': this.indicatorSeries[id] = addLine(Indicators.ema(c,200), def.color, 2); break;
        case 'vwap':   this.indicatorSeries[id] = addLine(Indicators.vwap(c),    def.color); break;
        case 'vwma':   this.indicatorSeries[id] = addLine(Indicators.vwma(c,20), def.color); break;
        case 'bb': {
          const {upper,middle,lower} = Indicators.bollingerBands(c);
          this.indicatorSeries[id] = {
            upper:  addLine(upper, '#808080'),
            middle: addLine(middle,'#444d60'),
            lower:  addLine(lower, '#808080'),
          }; break;
        }
        case 'donchian': {
          const {upper,lower,middle} = Indicators.donchian(c);
          this.indicatorSeries[id] = {
            upper:  addLine(upper, '#00bcd4'),
            middle: addLine(middle,'#006e7f'),
            lower:  addLine(lower, '#00bcd4'),
          }; break;
        }
        case 'keltner': {
          const {upper,lower,middle} = Indicators.keltner(c);
          this.indicatorSeries[id] = {
            upper:  addLine(upper, '#9c27b0'),
            middle: addLine(middle,'#6a1b9a'),
            lower:  addLine(lower, '#9c27b0'),
          }; break;
        }
        case 'ichimoku': {
          const { tenkan, kijun, chikouSpan, senkouA, senkouB } = Indicators.ichimoku(c);
          this.indicatorSeries[id] = {
            tenkan:  addLine(tenkan,     '#e91e63', 1),
            kijun:   addLine(kijun,      '#2196f3', 1),
            chikou:  addLine(chikouSpan, '#00e676', 1),
            senkouA: addLine(senkouA,    'rgba(38,166,154,0.4)', 1),
            senkouB: addLine(senkouB,    'rgba(239,83,80,0.4)',  1),
          }; break;
        }
        case 'psar': {
          const sarData = Indicators.parabolicSAR(c);
          this.indicatorSeries[id] = {
            up: addLine(sarData.filter(d => d.isLong) .map(d => ({ time: d.time, value: d.value })), '#00e676', 1),
            dn: addLine(sarData.filter(d => !d.isLong).map(d => ({ time: d.time, value: d.value })), '#ff3d5a', 1),
          }; break;
        }
        case 'supertrend': {
          const st = Indicators.supertrend(c);
          this.indicatorSeries[id] = {
            up: addLine(st.filter(d=>d.trend===1) .map(d=>({time:d.time,value:d.value})), '#00e676', 2),
            dn: addLine(st.filter(d=>d.trend===-1).map(d=>({time:d.time,value:d.value})), '#ff3d5a', 2),
          }; break;
        }
        case 'pivots': {
          const pts = Indicators.pivotPoints(c);
          this.indicatorSeries[id] = pts.map(pt =>
            addLine(
              [{time:c[0].time,value:pt.value},{time:c[c.length-1].time,value:pt.value}],
              pt.color, 1
            )
          ); break;
        }
        case 'sd_zones_auto_fib': {
          const result = Indicators.sdZonesAutoFib(
            this.candles, 3, 10, 0.1, 5, true,
            [0.0, 0.5, 0.618, 0.786, 0.88, 1.0, -0.27, -0.618]
          );
          // Resolve zone times up front (indices → timestamps)
          this._sdData = {
            supplyZones: (result.supplyZones || []).map(z => ({
              t0: this.candles[z.leftIdx].time,
              t1: this.candles[z.rightIdx].time,
              top: z.top, bottom: z.bottom,
            })),
            demandZones: (result.demandZones || []).map(z => ({
              t0: this.candles[z.leftIdx].time,
              t1: this.candles[z.rightIdx].time,
              top: z.top, bottom: z.bottom,
            })),
            fibLevels: result.fibLevels || [],
          };
          this._initSdCanvas();
          this._sdRender();
          this.indicatorSeries[id] = '__sd_canvas__'; // sentinel so _removeIndicator knows it exists
          break;
        }
        case 'order_blocks': {
          const result = Indicators.orderBlocks(
            this.candles,
            25,    // inputRange
            false, // showBearishBOS
            false, // showBullishBOS
            false  // useMitigatedBlocks
          );
          this._obData = {
            bearishBlocks: result.bearishBlocks,
            bullishBlocks: result.bullishBlocks,
            bosLines:      result.bosLines,
          };
          this._initObCanvas();
          this._obRender();
          this.indicatorSeries[id] = '__ob_canvas__';
          break;
        }
        default:
          if (def.type === 'subpane') this._addSubPane(id, def, c);
      }
    } catch(e) {
      console.warn(`[Pane ${this.id}] indicator error [${id}]:`, e);
    }
  }

  _addSubPane(id, def, c) {
    // Avoid adding twice
    if (this.subPanes[id]) return;

    const wrap  = this.container.querySelector('.pane-chart-wrap');
    const subEl = document.createElement('div');
    subEl.className = 'sub-pane';
    wrap.appendChild(subEl);

    const subChart = LightweightCharts.createChart(subEl, {
      width:  subEl.offsetWidth  || 400,
      height: 80,
      layout:  { background:{ type:'solid', color:'#0a0c0f' }, textColor:'#454f63' },
      grid:    { vertLines:{ color:'#141820' }, horzLines:{ color:'#141820' } },
      rightPriceScale: { borderColor:'#1e2535', scaleMargins:{top:0.05,bottom:0.05} },
      timeScale: { borderColor:'#1e2535', visible:false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      handleScale: { mouseWheel:false },
    });

    let mainSeries = null;
    try {
      switch(id) {
        case 'volume': {
          mainSeries = subChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'right'});
          mainSeries.setData(Indicators.volumeBars(c));
          break;
        }
        case 'rsi': {
          mainSeries = subChart.addLineSeries({color:def.color,lineWidth:1,priceLineVisible:false});
          mainSeries.setData(Indicators.rsi(c));
          subChart.addLineSeries({color:'rgba(255,61,90,0.3)',lineWidth:1,priceLineVisible:false}).setData(c.map(d=>({time:d.time,value:70})));
          subChart.addLineSeries({color:'rgba(0,230,118,0.3)',lineWidth:1,priceLineVisible:false}).setData(c.map(d=>({time:d.time,value:30})));
          break;
        }
        case 'macd': {
          const {macdLine,signalLine,histogram} = Indicators.macd(c);
          const hSeries = subChart.addHistogramSeries({priceLineVisible:false});
          hSeries.setData(histogram.map(d=>({time:d.time,value:d.value,color:d.value>=0?'rgba(0,230,118,0.5)':'rgba(255,61,90,0.5)'})));
          subChart.addLineSeries({color:'#2196f3',lineWidth:1,priceLineVisible:false}).setData(macdLine);
          mainSeries = subChart.addLineSeries({color:'#ff9800',lineWidth:1,priceLineVisible:false});
          mainSeries.setData(signalLine);
          break;
        }
        case 'stoch': {
          const {k,d} = Indicators.stochastic(c);
          subChart.addLineSeries({color:'#2196f3',lineWidth:1,priceLineVisible:false}).setData(k);
          mainSeries = subChart.addLineSeries({color:'#ff9800',lineWidth:1,priceLineVisible:false});
          mainSeries.setData(d);
          break;
        }
        case 'atr':     mainSeries = subChart.addLineSeries({color:def.color,lineWidth:1,priceLineVisible:false}); mainSeries.setData(Indicators.atr(c)); break;
        case 'adx':     mainSeries = subChart.addLineSeries({color:def.color,lineWidth:1,priceLineVisible:false}); mainSeries.setData(Indicators.adx(c)); break;
        case 'cci':     mainSeries = subChart.addLineSeries({color:def.color,lineWidth:1,priceLineVisible:false}); mainSeries.setData(Indicators.cci(c)); break;
        case 'obv':     mainSeries = subChart.addLineSeries({color:def.color,lineWidth:1,priceLineVisible:false}); mainSeries.setData(Indicators.obv(c)); break;
        case 'mfi':     mainSeries = subChart.addLineSeries({color:def.color,lineWidth:1,priceLineVisible:false}); mainSeries.setData(Indicators.mfi(c)); break;
        case 'williams':mainSeries = subChart.addLineSeries({color:def.color,lineWidth:1,priceLineVisible:false}); mainSeries.setData(Indicators.williamsR(c)); break;
        case 'cmf': {
          mainSeries = subChart.addHistogramSeries({ priceLineVisible: false });
          mainSeries.setData(Indicators.cmf(c).map(d => ({
            time: d.time, value: d.value,
            color: d.value >= 0 ? 'rgba(0,230,118,0.6)' : 'rgba(255,61,90,0.6)',
          })));
          subChart.addLineSeries({ color: 'rgba(255,255,255,0.15)', lineWidth: 1, priceLineVisible: false })
            .setData(c.map(d => ({ time: d.time, value: 0 })));
          break;
        }
        case 'momentum': {
          const momData = Indicators.momentum(c);
          mainSeries = subChart.addHistogramSeries({ priceLineVisible: false });
          mainSeries.setData(momData.map(d => ({
            time: d.time, value: d.value,
            color: d.value >= 0 ? 'rgba(255,202,40,0.7)' : 'rgba(255,61,90,0.7)',
          })));
          subChart.addLineSeries({ color: 'rgba(255,255,255,0.15)', lineWidth: 1, priceLineVisible: false })
            .setData(c.slice(c.length - momData.length).map(d => ({ time: d.time, value: 0 })));
          break;
        }
        case 'stochrsi': {
          const { k, d } = Indicators.stochRSI(c);
          subChart.addLineSeries({ color: def.color, lineWidth: 1, priceLineVisible: false }).setData(k);
          mainSeries = subChart.addLineSeries({ color: '#ff9800', lineWidth: 1, priceLineVisible: false });
          mainSeries.setData(d);
          subChart.addLineSeries({ color: 'rgba(255,61,90,0.3)',  lineWidth: 1, priceLineVisible: false }).setData(c.map(d => ({ time: d.time, value: 80 })));
          subChart.addLineSeries({ color: 'rgba(0,230,118,0.3)', lineWidth: 1, priceLineVisible: false }).setData(c.map(d => ({ time: d.time, value: 20 })));
          break;
        }
      }
    } catch(e) {
      console.warn(`[Pane ${this.id}] subpane error [${id}]:`, e);
    }

    subChart.timeScale().fitContent();

    // Sync scroll/zoom with main chart
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) { try { subChart.timeScale().setVisibleLogicalRange(range); } catch(e){} }
    });

    const ro = new ResizeObserver(() => {
      const w = subEl.offsetWidth;
      if (w > 0) { try { subChart.resize(w, 80); } catch(e){} }
    });
    ro.observe(subEl);

    this.subPanes[id] = { chart:subChart, series:mainSeries, el:subEl, ro };
  }

  _removeIndicator(id) {
    const s = this.indicatorSeries[id];
    if (s) {
      if (s === '__sd_canvas__') {
        // Remove the SD zones canvas layer
        if (this._sdCanvas) {
          try { this._sdCanvas.remove(); } catch(e) {}
          this._sdCanvas = null;
        }
        this._sdData = null;
      } else if (s === '__ob_canvas__') {
        if (this._obCanvas) {
          try { this._obCanvas.remove(); } catch(e) {}
          this._obCanvas = null;
        }
        this._obData = null;
      } else {
        const rm = x => { if(x) { try { this.chart.removeSeries(x); } catch(e){} } };
        if (Array.isArray(s))    s.forEach(rm);
        else if (s.upper  !== undefined) { rm(s.upper); rm(s.lower); rm(s.middle); }
        else if (s.tenkan !== undefined) { rm(s.tenkan); rm(s.kijun); rm(s.chikou); rm(s.senkouA); rm(s.senkouB); }
        else if (s.up     !== undefined) { rm(s.up); rm(s.dn); }
        else rm(s);
      }
      delete this.indicatorSeries[id];
    }
    if (this.subPanes[id]) {
      const {chart,el,ro} = this.subPanes[id];
      try { ro.disconnect(); } catch(e){}
      try { chart.remove();  } catch(e){}
      try { el.remove();     } catch(e){}
      delete this.subPanes[id];
    }
  }

  // ── UI helpers ───────────────────────────────────────

  _showLoading(show) {
    const chartEl = document.getElementById(`pane-chart-${this.id}`);
    if (!chartEl) return;
    let el = chartEl.querySelector('.pane-loading');
    if (show) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'pane-loading';
        el.innerHTML = '<div class="spinner"></div>LOADING';
        chartEl.appendChild(el);
      }
    } else if (el) {
      el.remove();
    }
  }

  _showError(msg) {
    const chartEl = document.getElementById(`pane-chart-${this.id}`);
    if (!chartEl) return;
    let el = chartEl.querySelector('.pane-error');
    if (!el) { el = document.createElement('div'); el.className = 'pane-error'; chartEl.appendChild(el); }
    el.textContent = msg;
    setTimeout(() => { try { el.remove(); } catch(e){} }, 8000);
  }

  // ═══════════════════════════════════════════════════════════
  // DRAWING TOOLS
  // ═══════════════════════════════════════════════════════════

  _updateDrawingUI() {
    // Highlight the DRAW button in the toolbar when any tool is active
    const drawBtn = this.container.querySelector('.btn-draw-open');
    if (drawBtn) drawBtn.classList.toggle('active', !!this.drawingMode);

    // Sync tool buttons inside the drawing flyout (if open for this pane)
    document.querySelectorAll('.draw-flyout-btn').forEach(btn => {
      if (parseInt(btn.dataset.pane) !== this.id) return;
      const tool = btn.dataset.tool;
      btn.classList.toggle('active', this.drawingMode === tool);
      if (tool === 'long')  btn.style.color = this.drawingMode === 'long'  ? '#00e676' : '';
      if (tool === 'short') btn.style.color = this.drawingMode === 'short' ? '#ff3d5a' : '';
    });

    const el = document.getElementById(`pane-chart-${this.id}`);
    if (el) el.style.cursor = this.drawingMode ? 'crosshair' : 'default';

    if (!this.drawingMode) {
      document.dispatchEvent(new CustomEvent('drawing-tool-exited', { detail: { paneId: this.id } }));
    }
  }

  // ── Drawing layer: transparent div sits over the chart ──────────────────────
  _initDrawingLayer(chartEl) {
    const overlay = document.createElement('div');
    overlay.className = 'drawing-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:5;pointer-events:none;user-select:none;';
    chartEl.style.position = 'relative';
    chartEl.appendChild(overlay);
    this._overlayEl = overlay;

    // ── Trendline canvas — drawn on top, pointer-events:none always ──────────
    const tc = document.createElement('canvas');
    tc.style.cssText = 'position:absolute;inset:0;z-index:8;pointer-events:none;';
    tc.width  = chartEl.offsetWidth  || 600;
    tc.height = chartEl.offsetHeight || 400;
    chartEl.appendChild(tc);
    this._trendCanvas = tc;

    // Resize trendline canvas with chart
    new ResizeObserver(() => {
      tc.width  = chartEl.offsetWidth;
      tc.height = chartEl.offsetHeight;
      this._trendRender();
    }).observe(chartEl);

    // Redraw trendlines on scroll/zoom
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this._trendRender());
    this.chart.subscribeCrosshairMove(() => this._trendRender());
    // ── Chart-level events for drawing tools and trendline interaction ────────
    chartEl.addEventListener('mousedown', e => this._onDrawMouseDown(e));
    chartEl.addEventListener('mousemove', e => this._onDrawMouseMove(e));
    chartEl.addEventListener('mouseup',   e => this._onDrawMouseUp(e));
    chartEl.addEventListener('mouseleave', () => {
      if (this._fibDrawing) this._cancelFibDrag();
      if (this._posDrawing) {
        this._clearPositionPreview();
        this._posDrawing = null;
        this.chart.applyOptions({ handleScale:{mouseWheel:true,pinch:true}, handleScroll:{mouseWheel:true,pressedMouseMove:true} });
      }
    });
  }

  // ── Coordinate helpers ───────────────────────────────────────────────────────
  _pixelToPrice(y) {
    try { return this.candleSeries.coordinateToPrice(y); } catch(e) { return null; }
  }
  _pixelToTime(x) {
    try {
      const logical = this.chart.timeScale().coordinateToLogical(x);
      if (logical === null) return null;
      // snap to nearest candle time
      const idx = Math.max(0, Math.min(Math.round(logical), this.candles.length - 1));
      return this.candles[idx] ? this.candles[idx].time : null;
    } catch(e) { return null; }
  }
  _priceToPixel(price) {
    try { return this.candleSeries.priceToCoordinate(price); } catch(e) { return null; }
  }

  // ── Mouse handlers ───────────────────────────────────────────────────────────
  _onDrawMouseDown(e) {
    if (e.button !== 0) return;
    // Let clicks inside any floating panel pass through untouched
    if (e.target.closest('.trend-edit-panel, .fib-edit-panel, .pos-panel')) return;
    if (!this.drawingMode) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const consumed = this._trendMouseDown(mx, my);
      if (consumed) e.preventDefault();
      // Attach document-level listeners for any active drag (trendline endpoint, hline, vline)
      if (this._trendDragging || this._hlineDragging || this._vlineDragging) {
        this.chart.applyOptions({ handleScale:{mouseWheel:false,pinch:false}, handleScroll:{mouseWheel:false,pressedMouseMove:false} });
        const r = e.currentTarget.getBoundingClientRect();
        const onDocMove = ev => {
          this._trendMouseMove(ev.clientX - r.left, ev.clientY - r.top, e.currentTarget);
        };
        const onDocUp = () => {
          document.removeEventListener('mousemove', onDocMove);
          document.removeEventListener('mouseup',   onDocUp);
          this._trendMouseUp();
          this.chart.applyOptions({ handleScale:{mouseWheel:true,pinch:true}, handleScroll:{mouseWheel:true,pressedMouseMove:true} });
        };
        document.addEventListener('mousemove', onDocMove);
        document.addEventListener('mouseup',   onDocUp);
      }
      return;
    }
    if (this.drawingMode === 'long' || this.drawingMode === 'short') {
      e.preventDefault();
      e.stopPropagation();
      this.chart.applyOptions({ handleScale:{mouseWheel:false,pinch:false}, handleScroll:{mouseWheel:false,pressedMouseMove:false} });
      const rect  = e.currentTarget.getBoundingClientRect();
      const price = this._pixelToPrice(e.clientY - rect.top);
      if (price === null) return;
      this._posDrawing = { side: this.drawingMode, entryPrice: price, series: [], overlayEl: null };
      return;
    }
    if (this.drawingMode === 'trend') {
      e.preventDefault();
      e.stopPropagation();
      this.chart.applyOptions({ handleScale:{mouseWheel:false,pinch:false}, handleScroll:{mouseWheel:false,pressedMouseMove:false} });
      const rect  = e.currentTarget.getBoundingClientRect();
      const price = this._pixelToPrice(e.clientY - rect.top);
      const time  = this._pixelToTime(e.clientX - rect.left);
      if (price === null || time === null) return;
      const startPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this._trendDrawing = { ptA: { price, time }, startPx };
      return;
    }
    if (this.drawingMode === 'hline') {
      e.preventDefault();
      e.stopPropagation();
      const rect  = e.currentTarget.getBoundingClientRect();
      const price = this._pixelToPrice(e.clientY - rect.top);
      if (price === null) return;
      const id = Date.now();
      this._hlines.push({ id, price, color: '#00c8ff', alert: false });
      this._hlineSelect(id);
      this.drawingMode = null;
      this._updateDrawingUI();
      this.markDirty();
      return;
    }
    if (this.drawingMode === 'vline') {
      e.preventDefault();
      e.stopPropagation();
      const rect  = e.currentTarget.getBoundingClientRect();
      const time  = this._trendXToTimeFree(e.clientX - rect.left);
      if (time === null) return;
      const id = Date.now();
      this._vlines.push({ id, time, color: '#00c8ff' });
      this._vlineSelect(id);
      this.drawingMode = null;
      this._updateDrawingUI();
      this.markDirty();
      return;
    }
    if (this.drawingMode === 'fib') {
      e.preventDefault();
      e.stopPropagation();
      // Temporarily disable chart scroll/scale so drag works
      this.chart.applyOptions({ handleScale: { mouseWheel:false, pinch:false }, handleScroll: { mouseWheel:false, pressedMouseMove:false } });
      const rect  = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const price = this._pixelToPrice(y);
      const time  = this._pixelToTime(x);
      if (price === null || time === null) return;
      this._fibDrawing = { startPrice: price, startTime: time, startY: y, series: [] };
      this._overlayEl.style.pointerEvents = 'none'; // let mousemove through to chart el
    }
  }

  _onDrawMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const chartEl = e.currentTarget;

    if (this._posDrawing) {
      const slPrice = this._pixelToPrice(my);
      if (slPrice !== null) this._drawPositionPreview(this._posDrawing.side, this._posDrawing.entryPrice, slPrice);
      return;
    }
    if (this._trendDrawing) {
      // Update raw preview pixels — _trendRender() reads _trendPreviewPx directly
      this._trendPreviewPx = { x1: this._trendDrawing.startPx.x, y1: this._trendDrawing.startPx.y, x2: mx, y2: my };
      this._trendRender();
      return;
    }
    // Trendline endpoint drag or hover cursor
    if (!this.drawingMode) {
      const consumed = this._trendMouseMove(mx, my, chartEl);
      if (!consumed && chartEl) chartEl.style.cursor = 'default';
      return;
    }
    if (!this._fibDrawing) return;
    const price = this._pixelToPrice(my);
    if (price !== null) this._drawFibPreview(this._fibDrawing.startPrice, price);
  }

  _onDrawMouseUp(e) {
    if (this._posDrawing) {
      const rect  = e.currentTarget.getBoundingClientRect();
      const slPrice = this._pixelToPrice(e.clientY - rect.top);
      this.chart.applyOptions({ handleScale:{mouseWheel:true,pinch:true}, handleScroll:{mouseWheel:true,pressedMouseMove:true} });
      if (slPrice !== null && Math.abs(slPrice - this._posDrawing.entryPrice) > 0.000001) {
        this._commitPosition(this._posDrawing.side, this._posDrawing.entryPrice, slPrice);
        this.drawingMode = null;
        this._updateDrawingUI();
      } else {
        this._clearPositionPreview();
      }
      this._posDrawing = null;
      return;
    }
    if (this._trendDrawing) {
      const rect  = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const price = this._trendYToPrice(my);
      const time  = this._trendXToTimeFree(mx);
      this.chart.applyOptions({ handleScale:{mouseWheel:true,pinch:true}, handleScroll:{mouseWheel:true,pressedMouseMove:true} });
      const ptA = this._trendDrawing.ptA;
      this._trendDrawing   = null;
      this._trendPreviewPx = null;
      if (price !== null && time !== null && (time !== ptA.time || Math.abs(price - ptA.price) > 0)) {
        const id = Date.now();
        this._trendlines.push({ id, color: '#00c8ff', ptA, ptB: { price, time } });
        this._trendSelect(id);
        this.markDirty();
      } else {
        this._trendRender();
      }
      this.drawingMode = null;
      this._updateDrawingUI();
      return;
    }
    // Trendline endpoint drag is handled by document listeners in _onDrawMouseDown
    if (!this._fibDrawing) return;
    const rect  = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const endPrice = this._pixelToPrice(y);
    const endTime  = this._pixelToTime(e.clientX - rect.left);
    this.chart.applyOptions({ handleScale: { mouseWheel:true, pinch:true }, handleScroll: { mouseWheel:true, pressedMouseMove:true } });
    if (endPrice !== null && Math.abs(endPrice - this._fibDrawing.startPrice) > 0) {
      this._commitFib(this._fibDrawing.startPrice, endPrice);
      this.drawingMode = null;
      this._updateDrawingUI();
    } else {
      this._clearFibPreview();
    }
    this._fibDrawing = null;
  }

  _cancelFibDrag() {
    this.chart.applyOptions({ handleScale: { mouseWheel:true, pinch:true }, handleScroll: { mouseWheel:true, pressedMouseMove:true } });
    this._clearFibPreview();
    this._fibDrawing = null;
  }

  // ── Preview during drag (lightweight — just remove+re-add) ───────────────────
  _clearFibPreview() {
    if (this._previewSeries) {
      this._previewSeries.forEach(s => { try { this.chart.removeSeries(s); } catch(e){} });
      this._previewSeries = null;
    }
  }

  _drawFibPreview(priceA, priceB) {
    this._clearFibPreview();
    if (!this.candles.length) return;
    this._previewSeries = this._buildFibSeries(priceA, priceB, 0.5);
  }

  // ── Commit final fib ─────────────────────────────────────────────────────────
  _commitFib(priceA, priceB) {
    this._clearFibPreview();
    if (!this.candles.length) return;
    const series = this._buildFibSeries(priceA, priceB, 1.0);
    const fibId = Date.now();
    this._fibs.push({ id: fibId, series, priceA, priceB });
    // Show edit popup
    this._showFibEditPanel(fibId, priceA, priceB);
    this.markDirty();
  }

  // ── Core: build one set of fib level series ──────────────────────────────────
  _buildFibSeries(priceA, priceB, opacity = 1.0) {
    const c   = this.candles;
    const t0  = c[0].time;
    const t1  = c[c.length - 1].time;
    const range = priceB - priceA;

    const FIB_COLORS = {
      0:     `rgba(120,120,120,${opacity})`,
      0.236: `rgba(100,181,246,${opacity})`,
      0.382: `rgba(129,199,132,${opacity})`,
      0.5:   `rgba(255,183,77,${opacity})`,
      0.618: `rgba(229,115,115,${opacity})`,
      0.786: `rgba(186,104,200,${opacity})`,
      1.0:   `rgba(120,120,120,${opacity})`,
      1.272: `rgba(100,181,246,${opacity})`,
      1.414: `rgba(129,199,132,${opacity})`,
      1.618: `rgba(229,115,115,${opacity})`,
      2.0:   `rgba(186,104,200,${opacity})`,
      2.618: `rgba(255,183,77,${opacity})`,
    };

    const series = [];
    for (const level of this.fibLevels) {
      const price = priceA + range * level;
      const color = FIB_COLORS[level] || `rgba(200,200,200,${opacity})`;
      const s = this.chart.addLineSeries({
        color,
        lineWidth: level === 0 || level === 1.0 ? 2 : 1,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: 'price', precision: 5, minMove: 0.00001 },
        title: `${(level * 100).toFixed(1)}%`,
      });
      s.setData([{ time: t0, value: price }, { time: t1, value: price }]);
      series.push(s);
    }
    return series;
  }

  // ── Remove one fib ───────────────────────────────────────────────────────────
  _removeFib(fibId) {
    const idx = this._fibs.findIndex(f => f.id === fibId);
    if (idx === -1) return;
    this._fibs[idx].series.forEach(s => { try { this.chart.removeSeries(s); } catch(e){} });
    this._fibs.splice(idx, 1);
    this.markDirty();
  }

  // ── Redraw a fib with updated levels ────────────────────────────────────────
  _redrawFib(fibId) {
    const fib = this._fibs.find(f => f.id === fibId);
    if (!fib) return;
    fib.series.forEach(s => { try { this.chart.removeSeries(s); } catch(e){} });
    fib.series = this._buildFibSeries(fib.priceA, fib.priceB, 1.0);
  }

  // ── Clear all fibs ───────────────────────────────────────────────────────────
  _clearAllFibs() {
    this._clearFibPreview();
    this._fibs.forEach(fib => {
      fib.series.forEach(s => { try { this.chart.removeSeries(s); } catch(e){} });
    });
    this._fibs = [];
    this._closeFibEditPanel();
  }

  // ── Fib levels edit panel ────────────────────────────────────────────────────
  _closeFibEditPanel() {
    const existing = document.getElementById(`fib-edit-${this.id}`);
    if (existing) existing.remove();
  }

  _showFibEditPanel(fibId, priceA, priceB) {
    this._closeFibEditPanel();

    const chartEl = document.getElementById(`pane-chart-${this.id}`);
    if (!chartEl) return;

    const panel = document.createElement('div');
    panel.id = `fib-edit-${this.id}`;
    panel.className = 'fib-edit-panel';

    const range    = priceB - priceA;
    const dir      = range >= 0 ? 'UP' : 'DOWN';
    const dec      = this._symbolPriceFormat().dec;
    const fmt      = v => v.toFixed(dec);

    panel.innerHTML = `
      <div class="fib-edit-header">
        <span class="fib-edit-title">FIBONACCI · ${dir} · ${fmt(priceA)} → ${fmt(priceB)}</span>
        <button class="fib-edit-close" title="Close">✕</button>
      </div>
      <div class="fib-edit-body">
        <div class="fib-edit-levels" id="fib-levels-${this.id}">
          ${this.fibLevels.map((lv, i) => `
            <div class="fib-level-row" data-idx="${i}">
              <input class="fib-level-input" type="number" step="0.001" min="-2" max="5"
                     value="${lv}" data-idx="${i}"/>
              <span class="fib-level-price">${fmt(priceA + range * lv)}</span>
              <button class="fib-level-del" data-idx="${i}" title="Remove">−</button>
            </div>
          `).join('')}
        </div>
        <div class="fib-edit-actions">
          <button class="fib-btn-add">+ Add Level</button>
          <button class="fib-btn-reset">Reset</button>
          <button class="fib-btn-delete">Delete Fib</button>
        </div>
      </div>
    `;

    chartEl.appendChild(panel);

    // Position top-right of chart
    panel.style.top  = '8px';
    panel.style.right = '48px';

    // ── wire up events ──────────────────────────────────
    panel.querySelector('.fib-edit-close').onclick = () => this._closeFibEditPanel();

    // Level value changed
    panel.querySelectorAll('.fib-level-input').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.idx);
        const val = parseFloat(inp.value);
        if (!isNaN(val)) {
          this.fibLevels[idx] = val;
          this._redrawFib(fibId);
          this.markDirty();
          // update price display
          const row = panel.querySelector(`.fib-level-row[data-idx="${idx}"]`);
          if (row) row.querySelector('.fib-level-price').textContent = fmt(priceA + range * val);
        }
      });
    });

    // Delete individual level
    panel.querySelectorAll('.fib-level-del').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        this.fibLevels.splice(idx, 1);
        this._redrawFib(fibId);
        this.markDirty();
        this._showFibEditPanel(fibId, priceA, priceB); // re-render panel
      };
    });

    // Add new level
    panel.querySelector('.fib-btn-add').onclick = () => {
      this.fibLevels.push(0.5);
      this.fibLevels.sort((a,b) => a - b);
      this._redrawFib(fibId);
      this.markDirty();
      this._showFibEditPanel(fibId, priceA, priceB);
    };

    // Reset to defaults
    panel.querySelector('.fib-btn-reset').onclick = () => {
      this.fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
      this._redrawFib(fibId);
      this.markDirty();
      this._showFibEditPanel(fibId, priceA, priceB);
    };

    // Delete entire fib
    panel.querySelector('.fib-btn-delete').onclick = () => {
      this._removeFib(fibId);
      this._closeFibEditPanel();
    };

    // Make panel draggable
    this._makeDraggable(panel);
  }

  _makeDraggable(el) {
    // Works with both .fib-edit-header and .pos-panel-header
    const header = el.querySelector('.fib-edit-header, .pos-panel-header');
    if (!header) return;
    header.style.cursor = 'move';

    let startX = 0, startY = 0, startL = 0, startT = 0;

    const onMove = ev => {
      el.style.left  = (startL + ev.clientX - startX) + 'px';
      el.style.top   = (startT + ev.clientY - startY) + 'px';
      el.style.right = 'auto';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    header.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      e.stopPropagation();   // prevent chart drag handlers from firing
      startX = e.clientX;
      startY = e.clientY;
      // offsetLeft/Top are already relative to the positioned parent (chart container)
      // — no coordinate system mismatch, no jump on first move
      startL = el.offsetLeft;
      startT = el.offsetTop;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ── Fib hit-testing: find which fib (if any) is near a price ──────────────────
  //   "near" = within a pixel tolerance in screen space
  _fibAtPrice(price, pixelY, tolerancePx = 6) {
    let best = null, bestDist = Infinity;
    for (const fib of this._fibs) {
      const range = fib.priceB - fib.priceA;
      for (const level of this.fibLevels) {
        const levelPrice = fib.priceA + range * level;
        const levelPx    = this._priceToPixel(levelPrice);
        if (levelPx === null) continue;
        const dist = Math.abs(pixelY - levelPx);
        if (dist < tolerancePx && dist < bestDist) {
          bestDist = dist;
          best = fib;
        }
      }
    }
    return best;
  }

  // Click: open edit panel for the clicked fib
  _trySelectFibAtPrice(price, pixelY) {
    const fib = this._fibAtPrice(price, pixelY);
    if (!fib) {
      // Click on empty area → close panel
      this._closeFibEditPanel();
      this._unhighlightFibs();
      return;
    }
    this._highlightFib(fib.id);
    this._showFibEditPanel(fib.id, fib.priceA, fib.priceB);
  }

  // Hover: show pointer cursor and subtly highlight nearby fib
  _hoverFibAtPrice(price, pixelY) {
    const chartEl = document.getElementById(`pane-chart-${this.id}`);
    const fib = this._fibAtPrice(price, pixelY, 8);
    if (fib) {
      if (chartEl) chartEl.style.cursor = 'pointer';
      if (this._hoveredFibId !== fib.id) {
        this._unhighlightFibs();
        this._hoveredFibId = fib.id;
        this._highlightFib(fib.id, true); // soft highlight on hover
      }
    } else {
      if (chartEl) chartEl.style.cursor = 'default';
      if (this._hoveredFibId) {
        this._unhighlightFibs();
        this._hoveredFibId = null;
      }
    }
  }

  // Brighten lines of a specific fib (hover = soft, select = bright)
  _highlightFib(fibId, soft = false) {
    for (const fib of this._fibs) {
      const isTarget = fib.id === fibId;
      fib.series.forEach(s => {
        try {
          if (isTarget) {
            s.applyOptions({ lineWidth: soft ? 2 : 3 });
          } else {
            s.applyOptions({ lineWidth: 1 });
          }
        } catch(e) {}
      });
    }
  }

  // Reset all fib lines to normal weight
  _unhighlightFibs() {
    for (const fib of this._fibs) {
      const range = fib.priceB - fib.priceA;
      fib.series.forEach((s, i) => {
        const level = this.fibLevels[i];
        const isAnchor = (level === 0 || level === 1.0);
        try { s.applyOptions({ lineWidth: isAnchor ? 2 : 1 }); } catch(e) {}
      });
    }
  }


  // ═══════════════════════════════════════════════════════════
  // LONG / SHORT POSITION TOOLS  (canvas-based coloured blocks)
  // ═══════════════════════════════════════════════════════════

  // ── Helpers ──────────────────────────────────────────────
  _priceDec() { return this._symbolPriceFormat().dec; }

  // Returns { dec, precision, minMove } based on symbol name
  _symbolPriceFormat() {
    const sym = (this.symbol || '').toUpperCase().replace(/[\/_\-=X]/g, '');
    // JPY pairs: 3 decimal places
    if (sym.endsWith('JPY') || sym.startsWith('JPY')) {
      return { dec: 3, precision: 3, minMove: 0.001 };
    }
    // Crypto / large-price assets handled by currentPrice fallback
    const p = this.currentPrice || 0;
    if (p > 10000) return { dec: 1, precision: 1, minMove: 0.1 };
    if (p > 1000)  return { dec: 2, precision: 2, minMove: 0.01 };
    if (p > 10)    return { dec: 3, precision: 3, minMove: 0.001 };
    // Default forex: 5 decimal places
    return { dec: 5, precision: 5, minMove: 0.00001 };
  }
  _toPips(diff, price) {
    if (price < 10)  return Math.round(Math.abs(diff) / 0.0001);
    if (price < 500) return Math.round(Math.abs(diff) / 0.01);
    return +Math.abs(diff).toFixed(2);
  }

  // ── Canvas layer ─────────────────────────────────────────
  // One shared canvas per pane, drawn over the chart.
  // Re-rendered on every crosshair move / scroll / resize.
  _initPosCanvas(chartEl) {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;';
    cv.width  = chartEl.offsetWidth;
    cv.height = chartEl.offsetHeight;
    chartEl.appendChild(cv);
    this._posCanvas = cv;

    // Resize canvas when chart resizes
    new ResizeObserver(() => {
      cv.width  = chartEl.offsetWidth;
      cv.height = chartEl.offsetHeight;
      this._renderAllPositions();
    }).observe(chartEl);

    // Redraw on scroll / zoom
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this._renderAllPositions());
    this.chart.subscribeCrosshairMove(() => this._renderAllPositions());
  }

  _renderAllPositions() {
    const cv = this._posCanvas;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    // Draw committed positions
    for (const pos of this._positions) {
      this._drawPosOnCanvas(ctx, pos, 1.0, pos._dragging || null);
    }
    // Draw preview
    if (this._posPreview) {
      this._drawPosOnCanvas(ctx, this._posPreview, 0.45, null);
    }
  }

  _drawPosOnCanvas(ctx, pos, alpha, dragging) {
    const { side, entryPrice, slPrice, tpPrice } = pos;
    const isLong = side === 'long';

    const entryY = this._priceToPixel(entryPrice);
    const slY    = this._priceToPixel(slPrice);
    const tpY    = this._priceToPixel(tpPrice);
    if (entryY === null || slY === null || tpY === null) return;

    const W = this._posCanvas.width;
    const GREEN = `rgba(0,230,118,${alpha * 0.18})`;
    const RED   = `rgba(255,61,90,${alpha * 0.18})`;
    const GREEN_LINE = `rgba(0,230,118,${alpha})`;
    const RED_LINE   = `rgba(255,61,90,${alpha})`;
    const GOLD_LINE  = `rgba(240,165,0,${alpha})`;
    const GREEN_LABEL_BG = `rgba(0,180,90,${alpha})`;
    const RED_LABEL_BG   = `rgba(220,40,60,${alpha})`;
    const GOLD_LABEL_BG  = `rgba(200,130,0,${alpha})`;

    const dec = this._priceDec();
    const riskPips = this._toPips(Math.abs(entryPrice - slPrice), entryPrice);
    const rewPips  = this._toPips(Math.abs(tpPrice - entryPrice), entryPrice);

    // ── TP block — always green (profit zone regardless of direction) ──
    const tpBlockTop    = Math.min(entryY, tpY);
    const tpBlockBot    = Math.max(entryY, tpY);
    ctx.fillStyle = GREEN;
    ctx.fillRect(0, tpBlockTop, W, tpBlockBot - tpBlockTop);

    // ── SL block — always red (loss zone regardless of direction) ──
    const slBlockTop    = Math.min(entryY, slY);
    const slBlockBot    = Math.max(entryY, slY);
    ctx.fillStyle = RED;
    ctx.fillRect(0, slBlockTop, W, slBlockBot - slBlockTop);

    // ── Helper: draw a horizontal price line + right-hand label ──
    const drawLine = (y, color, labelBg, labelText, handleRadius = 5) => {
      // Line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = dragging ? 1.5 : 1.5;
      ctx.setLineDash([]);
      ctx.moveTo(0, y);
      ctx.lineTo(W - 90, y);   // leave room for label
      ctx.stroke();
      ctx.setLineDash([]);

      // Right-hand label badge (like TV's price tag)
      const lblW = 82, lblH = 18, lblX = W - 88, lblY = y - lblH / 2;
      ctx.fillStyle = labelBg;
      ctx.beginPath();
      ctx.roundRect(lblX, lblY, lblW, lblH, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(labelText, lblX + 5, lblY + 12);

      // Drag handle circle (small dot on the left edge of the label)
      ctx.beginPath();
      ctx.arc(lblX + 2, y, handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = labelBg;
      ctx.fill();
    };

    drawLine(tpY,    GREEN_LINE, GREEN_LABEL_BG, `TP  ${tpPrice.toFixed(dec)}`);
    drawLine(entryY, GOLD_LINE,  GOLD_LABEL_BG,  `ENT ${entryPrice.toFixed(dec)}`);
    drawLine(slY,    RED_LINE,   RED_LABEL_BG,   `SL  ${slPrice.toFixed(dec)}`);

    // ── Small pips labels inside the blocks ──
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    const tpMid = (tpBlockTop + tpBlockBot) / 2;
    const slMid = (slBlockTop + slBlockBot) / 2;
    if (Math.abs(tpBlockBot - tpBlockTop) > 14) {
      ctx.fillStyle = GREEN_LINE;
      ctx.fillText(`+${rewPips} pips`, 8, tpMid + 4);
    }
    if (Math.abs(slBlockBot - slBlockTop) > 14) {
      ctx.fillStyle = RED_LINE;
      ctx.fillText(`-${riskPips} pips`, 8, slMid + 4);
    }
  }

  // ── Preview during initial drag ───────────────────────────
  _clearPositionPreview() {
    this._posPreview = null;
    this._renderAllPositions();
  }

  _drawPositionPreview(side, entryPrice, slPrice) {
    const tpPrice = entryPrice + (entryPrice - slPrice);
    this._posPreview = { side, entryPrice, slPrice, tpPrice };
    this._renderAllPositions();
  }

  // ── Commit ────────────────────────────────────────────────
  _commitPosition(side, entryPrice, slPrice) {
    this._posPreview = null;
    const tpPrice  = entryPrice + (entryPrice - slPrice);
    const posId    = ++this._posIdCounter;
    const pos = { id: posId, side, entryPrice, slPrice, tpPrice,
                  _dragging: null,
                  // saved calc values persist across panel rebuilds
                  _calcAcct: 10000, _calcRisk: 1, _calcLotSz: 100000 };
    this._positions.push(pos);
    this._renderAllPositions();
    this._showPosPanel(posId);
    this._attachPosDragHandles(posId);
    this.markDirty();
  }

  // ── Drag handles: mouse events on chartEl to drag TP/SL ──
  _attachPosDragHandles(posId) {
    const chartEl = document.getElementById(`pane-chart-${this.id}`);
    if (!chartEl) return;

    let dragging = null;   // 'tp' | 'sl' | 'entry'

    const onDown = e => {
      if (this.drawingMode) return;
      const pos = this._positions.find(p => p.id === posId);
      if (!pos) return;
      const rect = chartEl.getBoundingClientRect();
      const my = e.clientY - rect.top;
      const tol = 10;
      const entY = this._priceToPixel(pos.entryPrice);
      const slY  = this._priceToPixel(pos.slPrice);
      const tpY  = this._priceToPixel(pos.tpPrice);
      if (tpY !== null && Math.abs(my - tpY) < tol) dragging = 'tp';
      else if (slY !== null && Math.abs(my - slY) < tol) dragging = 'sl';
      else if (entY !== null && Math.abs(my - entY) < tol) dragging = 'entry';
      if (!dragging) return;
      e.stopPropagation();
      e.preventDefault();
      this.chart.applyOptions({ handleScale:{mouseWheel:false,pinch:false}, handleScroll:{mouseWheel:false,pressedMouseMove:false} });
      pos._dragging = dragging;
    };

    const onMove = e => {
      if (!dragging) return;
      const pos = this._positions.find(p => p.id === posId);
      if (!pos) return;
      const rect = chartEl.getBoundingClientRect();
      const newPrice = this._pixelToPrice(e.clientY - rect.top);
      if (newPrice === null) return;

      if (dragging === 'tp') {
        pos.tpPrice = newPrice;   // TP moves freely — SL untouched
      } else if (dragging === 'sl') {
        pos.slPrice = newPrice;   // SL moves freely — TP untouched
      } else if (dragging === 'entry') {
        const slDiff = pos.entryPrice - pos.slPrice;
        const tpDiff = pos.tpPrice - pos.entryPrice;
        pos.entryPrice = newPrice;
        pos.slPrice = newPrice - slDiff;
        pos.tpPrice = newPrice + tpDiff;
      }
      this._renderAllPositions();
      this._updatePosPanel(posId);  // live-update the info panel
    };

    const onUp = e => {
      if (!dragging) return;
      const pos = this._positions.find(p => p.id === posId);
      if (pos) pos._dragging = null;
      dragging = null;
      this.chart.applyOptions({ handleScale:{mouseWheel:true,pinch:true}, handleScroll:{mouseWheel:true,pressedMouseMove:true} });
      this._renderAllPositions();
      this._updatePosPanel(posId);
      this.markDirty();
    };

    chartEl.addEventListener('mousedown', onDown);
    chartEl.addEventListener('mousemove', onMove);
    chartEl.addEventListener('mouseup', onUp);
    chartEl.addEventListener('mouseleave', onUp);
  }

  // ── Position info panel (collapsible) ────────────────────
  _getPosPanel(posId) { return document.getElementById(`pos-panel-${posId}`); }

  _showPosPanel(posId) {
    const pos = this._positions.find(p => p.id === posId);
    if (!pos) return;
    const chartEl = document.getElementById(`pane-chart-${this.id}`);
    if (!chartEl) return;

    const old = this._getPosPanel(posId);
    if (old) { old.remove(); }

    const isLong   = pos.side === 'long';
    const clrMain  = isLong ? '#00e676' : '#ff3d5a';  // side badge/header only
    const CLR_TP   = '#00e676';   // TP always green  (profit)
    const CLR_SL   = '#ff3d5a';   // SL always red    (loss)
    const dec      = this._priceDec();
    const riskPx   = Math.abs(pos.entryPrice - pos.slPrice);
    const rewPx    = Math.abs(pos.tpPrice    - pos.entryPrice);
    const rr       = riskPx > 0 ? (rewPx / riskPx).toFixed(2) : '—';
    const slPips   = this._toPips(riskPx, pos.entryPrice);
    const tpPips   = this._toPips(rewPx,  pos.entryPrice);
    const pctTP    = riskPx > 0 ? ((rewPx  / pos.entryPrice) * 100).toFixed(3) : '—';
    const pctSL    = riskPx > 0 ? ((riskPx / pos.entryPrice) * 100).toFixed(3) : '—';

    const panel = document.createElement('div');
    panel.id        = `pos-panel-${posId}`;
    panel.className = 'pos-panel';
    panel.innerHTML = `
      <div class="pos-panel-header" style="border-color:${clrMain}" title="Drag to move">
        <span class="pos-side-badge" style="background:${clrMain}22;color:${clrMain}">
          ${isLong ? '▲ LONG' : '▼ SHORT'}
        </span>
        <span class="pos-entry-label">@ <span class="pos-entry-val">${pos.entryPrice.toFixed(dec)}</span></span>
        <button class="pos-collapse-btn" title="Collapse / Expand">⊟</button>
        <button class="pos-close-btn">✕</button>
      </div>
      <div class="pos-panel-collapsible">
        <div class="pos-panel-body">
          <div class="pos-row">
            <span class="pos-lbl">TP</span>
            <span class="pos-val pos-tp-val" style="color:${CLR_TP}">${pos.tpPrice.toFixed(dec)}</span>
            <span class="pos-pip pos-tp-pip" style="color:${CLR_TP}">+<span class="pos-tp-pips">${tpPips}</span> pips</span>
          </div>
          <div class="pos-row">
            <span class="pos-lbl">SL</span>
            <span class="pos-val pos-sl-val" style="color:${CLR_SL}">${pos.slPrice.toFixed(dec)}</span>
            <span class="pos-pip pos-sl-pip" style="color:${CLR_SL}">-<span class="pos-sl-pips">${slPips}</span> pips</span>
          </div>
          <div class="pos-divider"></div>
          <div class="pos-row pos-rr-row">
            <span class="pos-lbl">R:R</span>
            <span class="pos-rr-val"><span class="pos-rr-num">1 : ${rr}</span></span>
          </div>
          <div class="pos-row">
            <span class="pos-lbl">TP%</span>
            <span class="pos-val"><span class="pos-tp-pct">${pctTP}</span>%</span>
          </div>
          <div class="pos-row">
            <span class="pos-lbl">SL%</span>
            <span class="pos-val"><span class="pos-sl-pct">${pctSL}</span>%</span>
          </div>
        </div>
        <div class="pos-calc-section">
          <div class="pos-calc-header">RISK CALCULATOR</div>
          <div class="pos-calc-body">
            <div class="pos-calc-row">
              <label>Account ($)</label>
              <input class="pos-calc-input" id="pos-acct-${posId}" type="number"
                     value="${pos._calcAcct}" min="0" step="100"/>
            </div>
            <div class="pos-calc-row">
              <label>Risk %</label>
              <input class="pos-calc-input" id="pos-risk-${posId}" type="number"
                     value="${pos._calcRisk}" min="0.1" max="100" step="0.1"/>
            </div>
            <div class="pos-calc-row">
              <label>Lot size</label>
              <input class="pos-calc-input" id="pos-lotsize-${posId}" type="number"
                     value="${pos._calcLotSz}" min="1000" step="1000"
                     title="Standard=100000 Mini=10000 Micro=1000"/>
            </div>
            <div class="pos-calc-result">
              <div class="pos-calc-result-row"><span>Risk $</span><span id="pos-rdollar-${posId}">—</span></div>
              <div class="pos-calc-result-row"><span>Lots</span><span id="pos-lots-${posId}">—</span></div>
              <div class="pos-calc-result-row"><span>Units</span><span id="pos-units-${posId}">—</span></div>
              <div class="pos-calc-result-row"><span>TP $</span>
                <span id="pos-tpdollar-${posId}" style="color:#00e676">—</span></div>
            </div>
          </div>
        </div>
      </div>
    `;

    chartEl.appendChild(panel);
    panel.style.top  = '8px';
    panel.style.left = '8px';

    // Collapse toggle
    const collapsible = panel.querySelector('.pos-panel-collapsible');
    const colBtn      = panel.querySelector('.pos-collapse-btn');
    colBtn.onclick = () => {
      const collapsed = collapsible.classList.toggle('collapsed');
      colBtn.textContent = collapsed ? '⊞' : '⊟';
    };

    // Close
    panel.querySelector('.pos-close-btn').onclick = () => this._removePosition(posId);

    // Calc inputs — save values back to pos object so they survive panel rebuilds
    const recalc = () => {
      pos._calcAcct  = parseFloat(document.getElementById(`pos-acct-${posId}`)?.value)    || 10000;
      pos._calcRisk  = parseFloat(document.getElementById(`pos-risk-${posId}`)?.value)    || 1;
      pos._calcLotSz = parseFloat(document.getElementById(`pos-lotsize-${posId}`)?.value) || 100000;
      this._recalcPos(posId);
    };
    panel.querySelectorAll('.pos-calc-input').forEach(i => i.addEventListener('input', recalc));
    this._recalcPos(posId);

    this._makeDraggable(panel);
  }

  // Live-update the info panel when user drags a level
  _updatePosPanel(posId) {
    const pos    = this._positions.find(p => p.id === posId);
    const panel  = this._getPosPanel(posId);
    if (!pos || !panel) return;
    const dec    = this._priceDec();
    const isLong = pos.side === 'long';
    const riskPx  = Math.abs(pos.entryPrice - pos.slPrice);
    const rewPx   = Math.abs(pos.tpPrice    - pos.entryPrice);
    const rr      = riskPx > 0 ? (rewPx / riskPx).toFixed(2) : '—';
    const slPips  = this._toPips(riskPx, pos.entryPrice);
    const tpPips  = this._toPips(rewPx,  pos.entryPrice);
    const pctTP   = riskPx > 0 ? ((rewPx  / pos.entryPrice) * 100).toFixed(3) : '—';
    const pctSL   = riskPx > 0 ? ((riskPx / pos.entryPrice) * 100).toFixed(3) : '—';

    const set = (sel, val) => { const el = panel.querySelector(sel); if (el) el.textContent = val; };
    set('.pos-entry-val',  pos.entryPrice.toFixed(dec));
    set('.pos-tp-val',     pos.tpPrice.toFixed(dec));
    set('.pos-sl-val',     pos.slPrice.toFixed(dec));
    set('.pos-tp-pips',    tpPips);
    set('.pos-sl-pips',    slPips);
    set('.pos-rr-num',     `1 : ${rr}`);
    set('.pos-tp-pct',     pctTP);
    set('.pos-sl-pct',     pctSL);
    this._recalcPos(posId);
  }

  _recalcPos(posId) {
    const pos = this._positions.find(p => p.id === posId);
    if (!pos) return;
    const { entryPrice: entry, slPrice: sl, tpPrice: tp,
            _calcAcct: acct, _calcRisk: riskPct, _calcLotSz: lotSz } = pos;
    const riskDollar = acct * riskPct / 100;
    const pipSize    = entry < 10 ? 0.0001 : entry < 500 ? 0.01 : 1;
    const pipValPerLotUSD = entry < 10 ? pipSize * lotSz : (pipSize * lotSz) / entry;
    const slPipCount = Math.abs(entry - sl) / pipSize;
    const tpPipCount = Math.abs(tp - entry) / pipSize;
    const lots       = slPipCount > 0 ? riskDollar / (slPipCount * pipValPerLotUSD * (lotSz / 100000)) : 0;
    const tpDollar   = lots * tpPipCount * pipValPerLotUSD * (lotSz / 100000);
    const fmt = (v, d=2) => isNaN(v)||!isFinite(v) ? '—' : v.toFixed(d);
    const set = (id, val, clr) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val;
      if (clr) el.style.color = clr;
    };
    set(`pos-rdollar-${posId}`, `$${fmt(acct * riskPct / 100)}`);
    set(`pos-lots-${posId}`,    fmt(lots, 2));
    set(`pos-units-${posId}`,   Math.round(lots * 100000).toLocaleString());
    set(`pos-tpdollar-${posId}`,`$${fmt(tpDollar)}`, '#00e676');
  }

  // ── Remove / clear ────────────────────────────────────────
  _removePosition(posId) {
    const idx = this._positions.findIndex(p => p.id === posId);
    if (idx === -1) return;
    this._positions.splice(idx, 1);
    const panel = this._getPosPanel(posId);
    if (panel) panel.remove();
    this._renderAllPositions();
    this.markDirty();
  }

  _clearAllPositions() {
    this._posPreview = null;
    this._positions.forEach(pos => {
      const panel = this._getPosPanel(pos.id);
      if (panel) panel.remove();
    });
    this._positions = [];
    this._renderAllPositions();
  }

  // ── Hit-test for click/hover ──────────────────────────────
  _posAtPrice(pixelY, tolerancePx = 8) {
    let best = null, bestDist = Infinity;
    for (const pos of this._positions) {
      for (const price of [pos.entryPrice, pos.slPrice, pos.tpPrice]) {
        const py = this._priceToPixel(price);
        if (py === null) continue;
        const d = Math.abs(pixelY - py);
        if (d < tolerancePx && d < bestDist) { bestDist = d; best = pos; }
      }
    }
    return best;
  }

  _trySelectPositionAtPrice(price, pixelY) {
    const pos = this._posAtPrice(pixelY);
    if (!pos) return false;
    const existing = this._getPosPanel(pos.id);
    if (!existing) this._showPosPanel(pos.id);
    return true;
  }

  _hoverPositionAtPrice(price, pixelY) {
    const chartEl = document.getElementById(`pane-chart-${this.id}`);
    const pos = this._posAtPrice(pixelY, 10);
    if (pos && chartEl) chartEl.style.cursor = 'ns-resize';
  }

  // ═══════════════════════════════════════════════════════════
  // TRENDLINE TOOL — pure canvas, events on chartEl
  // ═══════════════════════════════════════════════════════════
  //
  // Stored as { id, color, ptA:{price,time}, ptB:{price,time} }
  // _trendPreviewPx: { x1,y1,x2,y2 } set during draw, included in every render
  // No overlay div — mouse handling lives in _onDrawMouseDown/Move/Up

  // ── Coordinate helpers ───────────────────────────────────────────────────
  _trendPriceToY(price) {
    try { return this.candleSeries.priceToCoordinate(price); } catch(e) { return null; }
  }
  _trendTimeToX(time) {
    try {
      const x = this.chart.timeScale().timeToCoordinate(time);
      if (x !== null) return x;
      // Time is beyond visible candles — extrapolate using pixel-per-bar
      const c = this.candles;
      if (!c || c.length < 2) return null;
      const lastX = this.chart.timeScale().timeToCoordinate(c[c.length-1].time);
      const prevX = this.chart.timeScale().timeToCoordinate(c[c.length-2].time);
      if (lastX === null || prevX === null) return null;
      const pxPerBar = lastX - prevX;
      const barMs    = c[c.length-1].time - c[c.length-2].time;
      if (barMs === 0) return lastX;
      return lastX + ((time - c[c.length-1].time) / barMs) * pxPerBar;
    } catch(e) { return null; }
  }
  _trendYToPrice(y) {
    try { return this.candleSeries.coordinateToPrice(y); } catch(e) { return null; }
  }
  // Extrapolates beyond last candle using average bar interval
  _trendXToTimeFree(x) {
    try {
      const c = this.candles;
      if (!c.length) return null;
      // Compute bar width in pixels by comparing two known candle x positions
      if (c.length < 2) return c[0].time;
      const barMs = (c[c.length-1].time - c[0].time) / (c.length - 1);
      // Get x of last candle in pixels
      const lastX = this.chart.timeScale().timeToCoordinate(c[c.length-1].time);
      if (lastX === null) return c[c.length-1].time;
      // Get x of second-to-last candle to compute pixel-per-bar
      const prevX = this.chart.timeScale().timeToCoordinate(c[c.length-2].time);
      if (prevX === null) return c[c.length-1].time;
      const pxPerBar = lastX - prevX; // pixels between adjacent bars
      if (Math.abs(pxPerBar) < 0.001) return c[c.length-1].time;
      const barsFromLast = (x - lastX) / pxPerBar;
      return Math.round(c[c.length-1].time + barsFromLast * barMs);
    } catch(e) { return null; }
  }

  // ── Canvas render ────────────────────────────────────────────────────────
  // ── S/D Zones canvas layer ──────────────────────────────────────────────────
  _initSdCanvas() {
    // If a canvas already exists (re-adding indicator), remove it first
    if (this._sdCanvas) { try { this._sdCanvas.remove(); } catch(e) {} }

    const chartEl = document.getElementById(`pane-chart-${this.id}`);
    if (!chartEl) return;

    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;z-index:7;pointer-events:none;';
    cv.width  = chartEl.offsetWidth  || 600;
    cv.height = chartEl.offsetHeight || 400;
    chartEl.appendChild(cv);
    this._sdCanvas = cv;

    // Resize with chart
    new ResizeObserver(() => {
      cv.width  = chartEl.offsetWidth;
      cv.height = chartEl.offsetHeight;
      this._sdRender();
    }).observe(chartEl);

    // Redraw on scroll / zoom / crosshair
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this._sdRender());
    this.chart.subscribeCrosshairMove(() => this._sdRender());
  }

  _sdRender() {
    const cv = this._sdCanvas;
    if (!cv || !this._sdData) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    const dec = this._symbolPriceFormat ? this._symbolPriceFormat().dec : 5;

    const toX = t => {
      try {
        const x = this.chart.timeScale().timeToCoordinate(t);
        if (x !== null) return x;
        // Extrapolate beyond visible range
        const c = this.candles;
        if (!c || c.length < 2) return null;
        const lastX = this.chart.timeScale().timeToCoordinate(c[c.length-1].time);
        const prevX = this.chart.timeScale().timeToCoordinate(c[c.length-2].time);
        if (lastX === null || prevX === null) return null;
        const pxPerBar = lastX - prevX;
        const barMs    = c[c.length-1].time - c[c.length-2].time;
        if (!barMs) return lastX;
        return lastX + ((t - c[c.length-1].time) / barMs) * pxPerBar;
      } catch(e) { return null; }
    };
    const toY = p => { try { return this.candleSeries.priceToCoordinate(p); } catch(e) { return null; } };

    // ── Supply zones (red) ────────────────────────────────────────────────────
    for (const z of (this._sdData.supplyZones || [])) {
      const x0 = toX(z.t0), x1 = toX(z.t1);
      const y0 = toY(z.top), y1 = toY(z.bottom);
      if (x0===null||x1===null||y0===null||y1===null) continue;
      const rx = Math.min(x0, x1), ry = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
      // Fill
      ctx.fillStyle = 'rgba(255,61,90,0.12)';
      ctx.fillRect(rx, ry, rw, rh);
      // Border lines (top + bottom only)
      ctx.strokeStyle = 'rgba(255,61,90,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(rx, y0); ctx.lineTo(rx + rw, y0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx, y1); ctx.lineTo(rx + rw, y1); ctx.stroke();
      // Label on right edge
      if (rh > 10) {
        ctx.fillStyle = 'rgba(255,61,90,0.9)';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('SUPPLY', rx + rw - 4, ry + 11);
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(255,61,90,0.6)';
        ctx.fillText(z.top.toFixed(dec), rx + rw - 4, ry + rh - 3);
      }
    }

    // ── Demand zones (green) ──────────────────────────────────────────────────
    for (const z of (this._sdData.demandZones || [])) {
      const x0 = toX(z.t0), x1 = toX(z.t1);
      const y0 = toY(z.top), y1 = toY(z.bottom);
      if (x0===null||x1===null||y0===null||y1===null) continue;
      const rx = Math.min(x0, x1), ry = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
      // Fill
      ctx.fillStyle = 'rgba(0,230,118,0.10)';
      ctx.fillRect(rx, ry, rw, rh);
      // Border lines
      ctx.strokeStyle = 'rgba(0,230,118,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(rx, y0); ctx.lineTo(rx + rw, y0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx, y1); ctx.lineTo(rx + rw, y1); ctx.stroke();
      // Label
      if (rh > 10) {
        ctx.fillStyle = 'rgba(0,230,118,0.9)';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('DEMAND', rx + rw - 4, ry + 11);
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(0,230,118,0.6)';
        ctx.fillText(z.bottom.toFixed(dec), rx + rw - 4, ry + rh - 3);
      }
    }

    // ── Fibonacci levels (dashed lines across full width) ─────────────────────
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    for (const fib of (this._sdData.fibLevels || [])) {
      const y = toY(fib.price);
      if (y === null) continue;
      ctx.strokeStyle = 'rgba(91,156,246,0.55)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      // Label: level ratio + price
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(91,156,246,0.85)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${fib.level.toFixed(3)}  ${fib.price.toFixed(dec)}`, W - 4, y - 3);
      ctx.setLineDash([5, 4]);
    }
    ctx.setLineDash([]);
  }

  _initObCanvas() {
    if (this._obCanvas) { try { this._obCanvas.remove(); } catch(e) {} }
    const chartEl = document.getElementById(`pane-chart-${this.id}`);
    if (!chartEl) return;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;z-index:8;pointer-events:none;';
    cv.width  = chartEl.offsetWidth  || 600;
    cv.height = chartEl.offsetHeight || 400;
    chartEl.appendChild(cv);
    this._obCanvas = cv;
    new ResizeObserver(() => {
      cv.width  = chartEl.offsetWidth;
      cv.height = chartEl.offsetHeight;
      this._obRender();
    }).observe(chartEl);
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this._obRender());
    this.chart.subscribeCrosshairMove(() => this._obRender());
  }

  _obRender() {
    const cv = this._obCanvas;
    if (!cv || !this._obData) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    const dec = this._symbolPriceFormat ? this._symbolPriceFormat().dec : 5;

    const toX = t => {
      try {
        const x = this.chart.timeScale().timeToCoordinate(t);
        if (x !== null) return x;
        const c = this.candles;
        if (!c || c.length < 2) return null;
        const lastX = this.chart.timeScale().timeToCoordinate(c[c.length-1].time);
        const prevX = this.chart.timeScale().timeToCoordinate(c[c.length-2].time);
        if (lastX === null || prevX === null) return null;
        const pxPerBar = lastX - prevX;
        const barMs    = c[c.length-1].time - c[c.length-2].time;
        if (!barMs) return lastX;
        return lastX + ((t - c[c.length-1].time) / barMs) * pxPerBar;
      } catch(e) { return null; }
    };
    const toY = p => { try { return this.candleSeries.priceToCoordinate(p); } catch(e) { return null; } };

    // ── Bearish order blocks (gold/grey if mitigated) ────────────────────────
    for (const block of (this._obData.bearishBlocks || [])) {
      const x0 = toX(block.startTime);
      const y0 = toY(block.top), y1 = toY(block.bottom);
      if (x0 === null || y0 === null || y1 === null) continue;
      const ry = Math.min(y0, y1), rh = Math.abs(y1 - y0);
      const rw = W - x0;
      ctx.fillStyle = block.isMitigated ? 'rgba(207,203,202,0.08)' : 'rgba(219,166,50,0.07)';
      ctx.fillRect(x0, ry, rw, rh);
      ctx.strokeStyle = block.isMitigated ? 'rgba(207,203,202,0.4)' : 'rgba(219,166,50,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + rw, y0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0 + rw, y1); ctx.stroke();
      if (rh > 10) {
        ctx.fillStyle = block.isMitigated ? 'rgba(207,203,202,0.7)' : 'rgba(219,166,50,0.9)';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('OB ▼', W - 4, ry + 11);
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillStyle = block.isMitigated ? 'rgba(207,203,202,0.5)' : 'rgba(219,166,50,0.6)';
        ctx.fillText(block.top.toFixed(dec), W - 4, ry + rh - 3);
      }
    }

    // ── Bullish order blocks (green/grey if mitigated) ───────────────────────
    for (const block of (this._obData.bullishBlocks || [])) {
      const x0 = toX(block.startTime);
      const y0 = toY(block.top), y1 = toY(block.bottom);
      if (x0 === null || y0 === null || y1 === null) continue;
      const ry = Math.min(y0, y1), rh = Math.abs(y1 - y0);
      const rw = W - x0;
      ctx.fillStyle = block.isMitigated ? 'rgba(207,203,202,0.08)' : 'rgba(192,230,174,0.07)';
      ctx.fillRect(x0, ry, rw, rh);
      ctx.strokeStyle = block.isMitigated ? 'rgba(207,203,202,0.4)' : 'rgba(192,230,174,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + rw, y0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0 + rw, y1); ctx.stroke();
      if (rh > 10) {
        ctx.fillStyle = block.isMitigated ? 'rgba(207,203,202,0.7)' : 'rgba(192,230,174,0.9)';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('OB ▲', W - 4, ry + 11);
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillStyle = block.isMitigated ? 'rgba(207,203,202,0.5)' : 'rgba(192,230,174,0.6)';
        ctx.fillText(block.bottom.toFixed(dec), W - 4, ry + rh - 3);
      }
    }

    // ── BOS lines ────────────────────────────────────────────────────────────
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    for (const line of (this._obData.bosLines || [])) {
      const x0 = toX(line.startTime), x1 = toX(line.endTime);
      const y  = toY(line.value);
      if (x0 === null || x1 === null || y === null) continue;
      ctx.strokeStyle = line.color;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = line.color;
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('BOS', x1 - 4, y - 3);
      ctx.setLineDash([6, 4]);
    }
    ctx.setLineDash([]);
  }

  _trendRender() {
    const cv = this._trendCanvas;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);

    // ── Horizontal lines ─────────────────────────────────
    for (const h of this._hlines) {
      const y = this._trendPriceToY(h.price);
      if (y === null) continue;
      const sel = h.id === this._selectedHlineId;
      const dec = this._symbolPriceFormat().dec;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y);
      ctx.strokeStyle = h.color; ctx.lineWidth = sel ? 2 : 1.5;
      ctx.setLineDash(sel ? [] : [6, 3]); ctx.stroke(); ctx.setLineDash([]);
      // Price label on right edge
      ctx.fillStyle = h.color;
      ctx.font = '11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(h.price.toFixed(dec), cv.width - 4, y - 4);
      // Drag handle when selected
      if (sel) {
        ctx.beginPath(); ctx.arc(cv.width / 2, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = h.color; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    // ── Vertical lines ───────────────────────────────────
    for (const v of this._vlines) {
      const x = this._trendTimeToX(v.time);
      if (x === null) continue;
      const sel = v.id === this._selectedVlineId;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height);
      ctx.strokeStyle = v.color; ctx.lineWidth = sel ? 2 : 1.5;
      ctx.setLineDash(sel ? [] : [6, 3]); ctx.stroke(); ctx.setLineDash([]);
      // Drag handle when selected
      if (sel) {
        ctx.beginPath(); ctx.arc(x, cv.height / 2, 5, 0, Math.PI * 2);
        ctx.fillStyle = v.color; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    // ── Diagonal trendlines ──────────────────────────────
    for (const t of this._trendlines) {
      const x1 = this._trendTimeToX(t.ptA.time), y1 = this._trendPriceToY(t.ptA.price);
      const x2 = this._trendTimeToX(t.ptB.time), y2 = this._trendPriceToY(t.ptB.price);
      if (x1===null||y1===null||x2===null||y2===null) continue;
      const sel = t.id === this._selectedTrendId;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
      ctx.strokeStyle = t.color; ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.setLineDash([]); ctx.stroke();
      if (sel) { this._trendDrawHandle(ctx,x1,y1,t.color); this._trendDrawHandle(ctx,x2,y2,t.color); }
    }

    // Live draw preview — raw pixels, always up to date
    const p = this._trendPreviewPx;
    if (p) {
      ctx.beginPath(); ctx.moveTo(p.x1,p.y1); ctx.lineTo(p.x2,p.y2);
      ctx.strokeStyle = 'rgba(0,200,255,0.85)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([5,3]); ctx.stroke(); ctx.setLineDash([]);
      this._trendDrawHandle(ctx, p.x1, p.y1, '#00c8ff');
    }
  }

  _trendDrawHandle(ctx, x, y, color) {
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // ── Select / deselect ────────────────────────────────────────────────────
  _trendSelect(id) {
    this._selectedTrendId = id;
    this._trendRender();
    if (id !== null) this._trendShowPanel(id);
  }
  _trendDeselect() {
    this._selectedTrendId = null;
    this._trendRender();
    this._trendClosePanel();
  }

  // ── Hit-test helpers ─────────────────────────────────────────────────────
  _trendHandleHit(t, mx, my, r) {
    r = r || 12;
    const ax = this._trendTimeToX(t.ptA.time), ay = this._trendPriceToY(t.ptA.price);
    const bx = this._trendTimeToX(t.ptB.time), by = this._trendPriceToY(t.ptB.price);
    if (ax!==null&&ay!==null&&Math.hypot(mx-ax,my-ay)<=r) return 'A';
    if (bx!==null&&by!==null&&Math.hypot(mx-bx,my-by)<=r) return 'B';
    return null;
  }
  _trendLineHit(t, mx, my, tol) {
    tol = tol || 8;
    const x1=this._trendTimeToX(t.ptA.time), y1=this._trendPriceToY(t.ptA.price);
    const x2=this._trendTimeToX(t.ptB.time), y2=this._trendPriceToY(t.ptB.price);
    if (x1===null||y1===null||x2===null||y2===null) return false;
    const dx=x2-x1, dy=y2-y1, lenSq=dx*dx+dy*dy;
    if (lenSq===0) return Math.hypot(mx-x1,my-y1)<=tol;
    const u=Math.max(0,Math.min(1,((mx-x1)*dx+(my-y1)*dy)/lenSq));
    return Math.hypot(mx-(x1+u*dx), my-(y1+u*dy))<=tol;
  }

  // ── Mouse handling — called from _onDrawMouseDown/Move/Up ────────────────
  _trendMouseDown(mx, my) {
    if (this.drawingMode) return false; // drawing mode handled separately

    // ── Hline hit / drag ────────────────────────────────
    for (const h of this._hlines) {
      if (this._hlineHit(h, my)) {
        const lineY = this._trendPriceToY(h.price) ?? my;
        this._selectedHlineId = h.id;  // select without opening panel yet
        this._trendRender();
        this._hlineDragging = { h, offsetY: my - lineY };
        return true;
      }
    }

    // ── Vline hit / drag ────────────────────────────────
    for (const v of this._vlines) {
      if (this._vlineHit(v, mx)) {
        const lineX = this._trendTimeToX(v.time) ?? mx;
        this._selectedVlineId = v.id;  // select without opening panel yet
        this._trendRender();
        this._vlineDragging = { v, offsetX: mx - lineX };
        return true;
      }
    }

    // Check handles of selected trendline first
    if (this._selectedTrendId) {
      const t = this._trendlines.find(t => t.id === this._selectedTrendId);
      if (t) {
        const ep = this._trendHandleHit(t, mx, my);
        if (ep) { this._trendDragging = { t, ep }; return true; }
      }
    }
    // Check line body
    for (const t of this._trendlines) {
      if (this._trendLineHit(t, mx, my)) { this._trendSelect(t.id); return true; }
    }
    // Empty click — deselect if something was selected
    if (this._selectedTrendId) { this._trendDeselect(); return true; }
    if (this._selectedHlineId) { this._hlineDeselect(); return true; }
    if (this._selectedVlineId) { this._vlineDeselect(); return true; }
    return false;
  }

  _trendMouseMove(mx, my, chartEl) {
    if (this._hlineDragging) {
      const newPrice = this._trendYToPrice(my - this._hlineDragging.offsetY);
      if (newPrice !== null) { this._hlineDragging.h.price = newPrice; this._trendRender(); }
      if (chartEl) chartEl.style.cursor = 'ns-resize';
      return true;
    }
    if (this._vlineDragging) {
      const newTime = this._trendXToTimeFree(mx - this._vlineDragging.offsetX);
      if (newTime !== null) { this._vlineDragging.v.time = newTime; this._trendRender(); }
      if (chartEl) chartEl.style.cursor = 'ew-resize';
      return true;
    }
    if (this._trendDragging) {
      const { t, ep } = this._trendDragging;
      const newPrice = this._trendYToPrice(my);
      const newTime  = this._trendXToTimeFree(mx);
      if (newPrice!==null && newTime!==null) {
        if (ep==='A') t.ptA = { price:newPrice, time:newTime };
        else          t.ptB = { price:newPrice, time:newTime };
      }
      this._trendRender();
      return true;
    }
    // Cursor hints
    if (this._selectedTrendId) {
      const t = this._trendlines.find(t => t.id === this._selectedTrendId);
      if (t && this._trendHandleHit(t, mx, my)) {
        if (chartEl) chartEl.style.cursor = 'crosshair';
        return true;
      }
    }
    for (const t of this._trendlines) {
      if (this._trendLineHit(t, mx, my)) {
        if (chartEl) chartEl.style.cursor = 'pointer';
        return true;
      }
    }
    for (const h of this._hlines) {
      if (this._hlineHit(h, my)) { if (chartEl) chartEl.style.cursor = 'ns-resize'; return true; }
    }
    for (const v of this._vlines) {
      if (this._vlineHit(v, mx)) { if (chartEl) chartEl.style.cursor = 'ew-resize'; return true; }
    }
    return false;
  }

  _trendMouseUp() {
    if (this._hlineDragging) {
      const { h } = this._hlineDragging;
      this._hlineDragging = null;
      this._trendRender();
      this._hlineShowPanel(h.id);
      this.markDirty();
      return true;
    }
    if (this._vlineDragging) {
      const { v } = this._vlineDragging;
      this._vlineDragging = null;
      this._trendRender();
      this._vlineShowPanel(v.id);
      this.markDirty();
      return true;
    }
    if (this._trendDragging) {
      const { t } = this._trendDragging;
      this._trendDragging = null;
      this._trendRender();
      this._trendShowPanel(t.id);
      this.markDirty();
      return true;
    }
    return false;
  }

  // ── Clear all ────────────────────────────────────────────────────────────
  _trendClearAll() {
    this._trendlines      = [];
    this._trendDrawing    = null;
    this._trendPreviewPx  = null;
    this._trendDragging   = null;
    this._selectedTrendId = null;
    this._trendClosePanel();
    this._trendRender();
  }

  // ── Edit panel ───────────────────────────────────────────────────────────
  _trendClosePanel() {
    const el = document.getElementById('trend-panel-' + this.id);
    if (el) el.remove();
  }

  _trendShowPanel(id) {
    this._trendClosePanel();
    const chartEl = document.getElementById('pane-chart-' + this.id);
    if (!chartEl) return;
    const t = this._trendlines.find(t => t.id === id);
    if (!t) return;
    const dec = this._symbolPriceFormat().dec;
    const fmt = v => Number(v).toFixed(dec);
    const swatches = ['#00c8ff','#00e676','#ff3d5a','#f0a500','#ce93d8','#ffffff','#ff9800','#2196f3']
      .map(c => '<button class="trend-swatch' + (t.color===c?' active':'') + '" data-color="' + c + '" style="background:' + c + '"></button>')
      .join('');
    const panel = document.createElement('div');
    panel.id = 'trend-panel-' + this.id;
    panel.className = 'trend-edit-panel';
    panel.innerHTML =
      '<div class="trend-edit-header">' +
        '<span class="trend-edit-title">TRENDLINE ' + fmt(t.ptA.price) + ' \u2192 ' + fmt(t.ptB.price) + '</span>' +
        '<button class="trend-edit-close">\u2715</button>' +
      '</div>' +
      '<div class="trend-edit-body">' +
        '<div class="trend-color-row">' +
          '<span class="trend-color-label">COLOUR</span>' +
          '<div class="trend-color-swatches">' + swatches + '</div>' +
        '</div>' +
        '<div class="trend-edit-actions"><button class="trend-btn-delete">Delete</button></div>' +
      '</div>';
    chartEl.appendChild(panel);
    panel.style.top = '8px'; panel.style.right = '48px';
    panel.querySelector('.trend-edit-close').onclick = () => this._trendDeselect();
    panel.querySelector('.trend-btn-delete').onclick = () => {
      this._trendlines = this._trendlines.filter(x => x.id !== id);
      this._trendDeselect();
      this.markDirty();
    };
    panel.querySelectorAll('.trend-swatch').forEach(function(btn) {
      btn.onclick = function() {
        t.color = btn.dataset.color;
        this._trendRender();
        this.markDirty();
        panel.querySelectorAll('.trend-swatch').forEach(function(b) { b.classList.toggle('active', b===btn); });
      }.bind(this);
    }.bind(this));
    const hdr = panel.querySelector('.trend-edit-header');
    hdr.style.cursor = 'move';
    var sx,sy,sl,st;
    hdr.addEventListener('mousedown', function(ev) {
      if (ev.target.closest('button')) return;
      ev.preventDefault();
      sx=ev.clientX; sy=ev.clientY; sl=panel.offsetLeft; st=panel.offsetTop;
      function onM(mv) { panel.style.left=(sl+mv.clientX-sx)+'px'; panel.style.top=(st+mv.clientY-sy)+'px'; panel.style.right='auto'; }
      function onU() { document.removeEventListener('mousemove',onM); document.removeEventListener('mouseup',onU); }
      document.addEventListener('mousemove',onM); document.addEventListener('mouseup',onU);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // HORIZONTAL LINE TOOL
  // ═══════════════════════════════════════════════════════════

  _hlineHit(h, my, tol=6) {
    const y = this._trendPriceToY(h.price);
    return y !== null && Math.abs(my - y) <= tol;
  }
  _hlineSelect(id) {
    this._selectedHlineId = id;
    this._hlineClosePanel();
    this._trendRender();
    if (id !== null) this._hlineShowPanel(id);
  }
  _hlineDeselect() {
    this._selectedHlineId = null;
    this._trendRender();
    this._hlineClosePanel();
  }
  _hlineClosePanel() {
    const el = document.getElementById('hline-panel-' + this.id);
    if (el) el.remove();
  }
  _hlineShowPanel(id) {
    this._hlineClosePanel();
    const chartEl = document.getElementById('pane-chart-' + this.id);
    if (!chartEl) return;
    const h = this._hlines.find(h => h.id === id);
    if (!h) return;
    const dec = this._symbolPriceFormat().dec;
    const swatches = ['#00c8ff','#00e676','#ff3d5a','#f0a500','#ce93d8','#ffffff','#ff9800','#2196f3']
      .map(c => `<button class="trend-swatch${h.color===c?' active':''}" data-color="${c}" style="background:${c}"></button>`)
      .join('');
    const panel = document.createElement('div');
    panel.id = 'hline-panel-' + this.id;
    panel.className = 'trend-edit-panel';
    panel.innerHTML =
      `<div class="trend-edit-header">` +
        `<span class="trend-edit-title">H-LINE  ${h.price.toFixed(dec)}</span>` +
        `<button class="trend-edit-close">✕</button>` +
      `</div>` +
      `<div class="trend-edit-body">` +
        `<div class="trend-color-row"><span class="trend-color-label">COLOUR</span>` +
          `<div class="trend-color-swatches">${swatches}</div></div>` +
        `<div class="trend-alert-row">` +
          `<span class="trend-color-label">ALERT</span>` +
          `<button class="btn-hline-alert ${h.alert ? 'active' : ''}" title="Toggle price alert">` +
            `${h.alert ? '🔔' : '🔕'}` +
          `</button>` +
          `<span class="hline-alert-status">${h.alert ? 'Armed' : 'Off'}</span>` +
        `</div>` +
        `<div class="trend-edit-actions"><button class="trend-btn-delete">Delete</button></div>` +
      `</div>`;
    chartEl.appendChild(panel);
    panel.style.top = '8px'; panel.style.right = '48px';
    panel.querySelector('.trend-edit-close').onclick = () => this._hlineDeselect();
    panel.querySelector('.trend-btn-delete').onclick = () => {
      this._hlines = this._hlines.filter(x => x.id !== id);
      this._hlineDeselect();
      this.markDirty();
    };
    panel.querySelectorAll('.trend-swatch').forEach(btn => {
      btn.onclick = () => {
        h.color = btn.dataset.color;
        this._trendRender();
        this.markDirty();
        panel.querySelectorAll('.trend-swatch').forEach(b => b.classList.toggle('active', b === btn));
      };
    });

    const bellBtn = panel.querySelector('.btn-hline-alert');
    const alertStatus = panel.querySelector('.hline-alert-status');
    if (bellBtn) {
      bellBtn.onclick = () => {
        h.alert = !h.alert;
        bellBtn.textContent = h.alert ? '🔔' : '🔕';
        bellBtn.classList.toggle('active', h.alert);
        alertStatus.textContent = h.alert ? 'Armed' : 'Off';
        if (h.alert && window.AlertEngine) AlertEngine.requestPermission();
        this.markDirty();
      };
    }

    const hdr = panel.querySelector('.trend-edit-header');
    hdr.style.cursor = 'move';
    let sx, sy, sl, st;
    hdr.addEventListener('mousedown', ev => {
      if (ev.target.closest('button')) return;
      ev.preventDefault();
      sx = ev.clientX; sy = ev.clientY; sl = panel.offsetLeft; st = panel.offsetTop;
      const onM = mv => { panel.style.left = (sl + mv.clientX - sx) + 'px'; panel.style.top = (st + mv.clientY - sy) + 'px'; panel.style.right = 'auto'; };
      const onU = () => { document.removeEventListener('mousemove', onM); document.removeEventListener('mouseup', onU); };
      document.addEventListener('mousemove', onM); document.addEventListener('mouseup', onU);
    });
  }
  _hlineClearAll() {
    this._hlines = []; this._selectedHlineId = null; this._hlineDragging = null;
    this._hlineClosePanel(); this._trendRender();
  }

  // ═══════════════════════════════════════════════════════════
  // VERTICAL LINE TOOL
  // ═══════════════════════════════════════════════════════════

  _vlineHit(v, mx, tol=6) {
    const x = this._trendTimeToX(v.time);
    return x !== null && Math.abs(mx - x) <= tol;
  }
  _vlineSelect(id) {
    this._selectedVlineId = id;
    this._vlineClosePanel();
    this._trendRender();
    if (id !== null) this._vlineShowPanel(id);
  }
  _vlineDeselect() {
    this._selectedVlineId = null;
    this._trendRender();
    this._vlineClosePanel();
  }
  _vlineClosePanel() {
    const el = document.getElementById('vline-panel-' + this.id);
    if (el) el.remove();
  }
  _vlineShowPanel(id) {
    this._vlineClosePanel();
    const chartEl = document.getElementById('pane-chart-' + this.id);
    if (!chartEl) return;
    const v = this._vlines.find(v => v.id === id);
    if (!v) return;
    const dateStr = new Date(v.time * 1000).toUTCString().slice(0, 22);
    const swatches = ['#00c8ff','#00e676','#ff3d5a','#f0a500','#ce93d8','#ffffff','#ff9800','#2196f3']
      .map(c => `<button class="trend-swatch${v.color===c?' active':''}" data-color="${c}" style="background:${c}"></button>`)
      .join('');
    const panel = document.createElement('div');
    panel.id = 'vline-panel-' + this.id;
    panel.className = 'trend-edit-panel';
    panel.innerHTML =
      `<div class="trend-edit-header">` +
        `<span class="trend-edit-title">V-LINE  ${dateStr}</span>` +
        `<button class="trend-edit-close">✕</button>` +
      `</div>` +
      `<div class="trend-edit-body">` +
        `<div class="trend-color-row"><span class="trend-color-label">COLOUR</span>` +
          `<div class="trend-color-swatches">${swatches}</div></div>` +
        `<div class="trend-alert-row">` +
          `<span class="trend-color-label">ALERT</span>` +
          `<button class="btn-hline-alert ${h.alert ? 'active' : ''}" title="Toggle price alert">` +
            `${h.alert ? '🔔' : '🔕'}` +
          `</button>` +
          `<span class="hline-alert-status">${h.alert ? 'Armed' : 'Off'}</span>` +
        `</div>` +
        `<div class="trend-edit-actions"><button class="trend-btn-delete">Delete</button></div>` +
      `</div>`;
    chartEl.appendChild(panel);
    panel.style.top = '8px'; panel.style.right = '48px';
    panel.querySelector('.trend-edit-close').onclick = () => this._vlineDeselect();
    panel.querySelector('.trend-btn-delete').onclick = () => {
      this._vlines = this._vlines.filter(x => x.id !== id);
      this._vlineDeselect();
      this.markDirty();
    };
    panel.querySelectorAll('.trend-swatch').forEach(btn => {
      btn.onclick = () => {
        v.color = btn.dataset.color;
        this._trendRender();
        this.markDirty();
        panel.querySelectorAll('.trend-swatch').forEach(b => b.classList.toggle('active', b === btn));
      };
    });
    const hdr = panel.querySelector('.trend-edit-header');
    hdr.style.cursor = 'move';
    let sx, sy, sl, st;
    hdr.addEventListener('mousedown', ev => {
      if (ev.target.closest('button')) return;
      ev.preventDefault();
      sx = ev.clientX; sy = ev.clientY; sl = panel.offsetLeft; st = panel.offsetTop;
      const onM = mv => { panel.style.left = (sl + mv.clientX - sx) + 'px'; panel.style.top = (st + mv.clientY - sy) + 'px'; panel.style.right = 'auto'; };
      const onU = () => { document.removeEventListener('mousemove', onM); document.removeEventListener('mouseup', onU); };
      document.addEventListener('mousemove', onM); document.addEventListener('mouseup', onU);
    });
  }
  _vlineClearAll() {
    this._vlines = []; this._selectedVlineId = null; this._vlineDragging = null;
    this._vlineClosePanel(); this._trendRender();
  }

  // END TRENDLINE TOOL
  // ═══════════════════════════════════════════════════════════

  // END DRAWING TOOLS
  // ═══════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════
  // STATE PERSISTENCE
  // ═══════════════════════════════════════════════════════════

  /**
   * Mark that the current state has unsaved changes.
   * Shows the save button and an unsaved indicator dot.
   */
  markDirty() {
    this._isDirty = true;
    this._updateSaveBtn();
  }

  _updateSaveBtn() {
    const btn = this.container.querySelector('.btn-save-state');
    if (!btn) return;
    btn.style.display = '';
    const dot = btn.querySelector('.save-dirty-dot');
    if (dot) dot.style.display = this._isDirty ? 'inline-block' : 'none';
    btn.classList.toggle('saved', !this._isDirty);
    btn.title = this._isDirty
      ? `Save chart state for ${this.symbol} (unsaved changes)`
      : `State saved for ${this.symbol}`;
  }

  /**
   * Save drawings snapshot to StateStore. Called when user clicks Save button.
   */
  _saveState() {
    const drawings = {
      fibs: this._fibs.map(f => ({
        id:     f.id,
        priceA: f.priceA,
        priceB: f.priceB,
      })),
      trendlines: this._trendlines.map(t => ({
        id:    t.id,
        color: t.color,
        ptA:   { price: t.ptA.price, time: t.ptA.time },
        ptB:   { price: t.ptB.price, time: t.ptB.time },
      })),
      hlines: this._hlines.map(h => ({
        id: h.id, price: h.price, color: h.color, alert: h.alert || false,
      })),
      vlines: this._vlines.map(v => ({
        id: v.id, time: v.time, color: v.color,
      })),
      positions: this._positions.map(p => ({
        id:         p.id,
        side:       p.side,
        entryPrice: p.entryPrice,
        slPrice:    p.slPrice,
        tpPrice:    p.tpPrice,
      })),
    };

    const ok = window.StateStore.saveDrawings(this.symbol, drawings, this.fibLevels);
    if (ok) {
      this._isDirty = false;
      this._updateSaveBtn();
      this._showSaveFeedback();
    }
  }

  /**
   * Save the active indicator set for the current interval.
   * Called automatically whenever indicators are toggled.
   */
  _saveIndicators() {
    window.StateStore.saveIndicators(
      this.symbol,
      this.interval,
      [...this.activeIndicators]
    );
  }

  /** Brief green flash on the Save button to confirm. */
  _showSaveFeedback() {
    const btn = this.container.querySelector('.btn-save-state');
    if (!btn) return;
    btn.classList.add('save-flash');
    setTimeout(() => btn.classList.remove('save-flash'), 800);
  }

  /**
   * Restore saved state for the current symbol+interval.
   * Called after candles are loaded. Drawings are shared across intervals;
   * indicators are per-interval.
   */
  _restoreState() {
    if (!window.StateStore) return;

    // Restore indicators for this specific interval
    const savedIndicators = window.StateStore.loadIndicators(this.symbol, this.interval);
    if (savedIndicators && savedIndicators.length) {
      // Clear current set first to avoid duplicates
      [...this.activeIndicators].forEach(id => {
        this._removeIndicator(id);
        this.activeIndicators.delete(id);
      });
      savedIndicators.forEach(id => {
        this.activeIndicators.add(id);
        this._addIndicator(id);
      });
    }

    // Restore custom fib levels for this symbol
    const savedLevels = window.StateStore.loadFibLevels(this.symbol);
    if (savedLevels && Array.isArray(savedLevels)) {
      this.fibLevels = savedLevels;
    }

    // Restore drawings (shared across all intervals for this symbol)
    const drawings = window.StateStore.loadDrawings(this.symbol);
    if (!drawings) return;

    (drawings.fibs       || []).forEach(f  => this._restoreFib(f));
    (drawings.trendlines || []).forEach(t  => this._restoreTrendline(t));
    (drawings.hlines     || []).forEach(h  => this._restoreHline(h));
    (drawings.vlines     || []).forEach(v  => this._restoreVline(v));
    (drawings.positions  || []).forEach(p  => this._restorePosition(p));

    // State is clean — it matches what's on disk
    this._isDirty = false;
    // Show button only if there is saved state
    if (window.StateStore.hasSavedState(this.symbol)) {
      this._updateSaveBtn();
    }
  }

  _restoreFib(saved) {
    if (!this.candles.length || !this.chart) return;
    const series = this._buildFibSeries(saved.priceA, saved.priceB, 1.0);
    this._fibs.push({ id: saved.id, series, priceA: saved.priceA, priceB: saved.priceB });
  }

  _restoreTrendline(saved) {
    this._trendlines.push({
      id:    saved.id,
      color: saved.color || '#00c8ff',
      ptA:   { price: saved.ptA.price, time: saved.ptA.time },
      ptB:   { price: saved.ptB.price, time: saved.ptB.time },
    });
    this._trendRender();
  }

  _restoreHline(saved) {
    this._hlines.push({ id: saved.id, price: saved.price, color: saved.color || '#00c8ff', alert: saved.alert || false });
    this._trendRender();
  }

  _restoreVline(saved) {
    this._vlines.push({ id: saved.id, time: saved.time, color: saved.color || '#00c8ff' });
    this._trendRender();
  }

  _restorePosition(saved) {
    const posId = saved.id;
    // Keep id counter above any restored ids
    if (posId >= this._posIdCounter) this._posIdCounter = posId;
    const pos = {
      id:         posId,
      side:       saved.side,
      entryPrice: saved.entryPrice,
      slPrice:    saved.slPrice,
      tpPrice:    saved.tpPrice,
      _dragging:  null,
      _calcAcct:  10000, _calcRisk: 1, _calcLotSz: 100000,
    };
    this._positions.push(pos);
    this._renderAllPositions();
    this._attachPosDragHandles(posId);
    // Don't auto-open the panel on restore — too noisy if multiple positions
  }

  // END STATE PERSISTENCE
  // ═══════════════════════════════════════════════════════════

  // ── Popout ───────────────────────────────────────────────────────────────────
  _popout() {
    const sym = encodeURIComponent(this.symbol);
    const url = `/popout?symbol=${sym}&interval=${this.interval}&source=${this.source}`;
    const w = window.screen.width;
    const h = window.screen.height;
    const features = `width=${w},height=${h},left=${w},top=0,menubar=no,toolbar=no,location=no,status=no`;
    window.open(url, `popout_${this.id}_${Date.now()}`, features);
  }

  // ── Screenshot ────────────────────────────────────────────────────────────────
  _takeScreenshot() {
    if (!this.chart) return;
    const baseCanvas = this.chart.takeScreenshot();
    const w = baseCanvas.width;
    const h = baseCanvas.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.drawImage(baseCanvas, 0, 0);
    if (this._sdCanvas)    ctx.drawImage(this._sdCanvas,    0, 0);
    if (this._obCanvas)    ctx.drawImage(this._obCanvas,    0, 0);
    if (this._trendCanvas) ctx.drawImage(this._trendCanvas, 0, 0);
    if (this._posCanvas)   ctx.drawImage(this._posCanvas,   0, 0);
    const date = new Date().toISOString().slice(0, 10);
    const sym  = this.symbol.replace(/[^A-Z0-9]/gi, '');
    const filename = `${sym}_${this.interval}_${date}.png`;
    out.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  // ── applyTheme ────────────────────────────────────────────────────────────────
  applyTheme(chartBg, chartText, subText) {
    if (this.chart) {
      this.chart.applyOptions({
        layout: { background: { type: 'solid', color: chartBg }, textColor: chartText },
      });
    }
    Object.values(this.subPanes).forEach(sp => {
      if (sp.chart) {
        sp.chart.applyOptions({
          layout: { background: { type: 'solid', color: chartBg }, textColor: subText },
        });
      }
    });
  }

  destroy() {
    this._unsubscribeYF();
    if (this._ro) { try { this._ro.disconnect(); } catch(e){} }
    Object.keys(this.subPanes).forEach(id => {
      try { this.subPanes[id].ro.disconnect(); } catch(e){}
      try { this.subPanes[id].chart.remove();  } catch(e){}
      try { this.subPanes[id].el.remove();     } catch(e){}
    });
    this._clearAllFibs();
    this._closeFibEditPanel();
    this._clearAllPositions();
    this._trendClearAll();
    try { if (this.chart) this.chart.remove(); } catch(e){}
  }
}
