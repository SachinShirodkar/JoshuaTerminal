# Indicators Converted from Pine to JS

## S/D Zones & Major Structure Auto Fib

This indicator uses boxes and labels in Pine Script which are drawing objects. In Joshua Terminal, these are rendered as canvas rectangles and text during each paint cycle. The indicator detects Break of Structure (BOS) by tracking pivot highs/lows and monitoring when price crosses previous structure levels. Supply zones are created when price breaks below a pivot low after a pivot high, and demand zones when price breaks above a pivot high after a pivot low. Major structure Fibonacci levels are calculated between the two most recent opposing major pivots (determined by majorPivotLen). Zones are extended to the current bar and removed when mitigated (price closes through them). The canvas drawing approach means zones and fibs are painted fresh each frame rather than persisted as objects. Colors are hardcoded but can be made configurable via additional parameters.

## Order Blocks

This is a complex indicator with drawing operations (boxes/rectangles for order blocks). The Pine Script uses box.new() and line.new() with extend.right which draws to future. In Joshua Terminal, rectangles are drawn from block start to canvas edge. Mitigated blocks change color when price crosses them. Some features simplified: candle coloring, alerts, previous day high/low (requires daily timeframe data), and retest highlighting are not included. The core order block detection logic based on break of structure (BOS) is preserved. Parameters like colors and visibility flags should be added to indicator.params. The indicator tracks swing highs/lows and creates blocks when structure breaks occur.

## Fair Value Gap (FVG) — LuxAlgo Style

This indicator draws rectangular zones representing three-candle price imbalances (Fair Value Gaps). The original Pine Script uses box and line drawing primitives translated to canvas `fillRect` operations in Joshua Terminal.

**Detection logic:**
- **Bullish FVG:** `candle[i].low > candle[i-2].high` AND `candle[i-1].close > candle[i-2].high` — a gap exists between the current candle's low and two-bars-ago high, meaning price jumped up leaving an unfilled gap below
- **Bearish FVG:** `candle[i].high < candle[i-2].low` AND `candle[i-1].close < candle[i-2].low` — price fell through leaving an unfilled gap above
- Both conditions respect an optional threshold (minimum gap size as % of price)

**Mitigation tracking:**
- Bullish FVG is mitigated when a subsequent close falls below the gap's lower boundary (`fvg.min`)
- Bearish FVG is mitigated when a subsequent close rises above the gap's upper boundary (`fvg.max`)
- Mitigated zones fade opacity (22% → 12%) and show a dashed border line at the mitigated edge

**Canvas rendering (z-index 9, above Order Blocks):**
- Bullish zones: teal `rgba(8,153,129,...)` fill with top/bottom border lines
- Bearish zones: red `rgba(242,54,69,...)` fill with top/bottom border lines
- Unmitigated zones extend 20 bars forward (`EXTEND_BARS = 20`)
- Mitigated zones extend only to the mitigated candle's timestamp
- Labels: `FVG ▲` / `FVG ▼` + price range shown when zone is tall enough (>8px)
- Dynamic mode: full-width horizontal lines at current dynamic bull/bear levels

**Features implemented:** bullish/bearish detection, threshold filter, auto-threshold from avg bar range, mitigation tracking, showLast filter (N most-recent unmitigated), dynamic level lines, dashed mitigation lines.

**Features not implemented:** dashboard overlay, multi-timeframe mode (could be added as UI enhancements).

**Parameters** (hardcoded defaults, adjust in `_addIndicator` case in `pane.js`):

| Parameter | Default | Description |
|---|---|---|
| thresholdPer | 0 | Minimum gap size as % of price. 0 = detect all gaps. |
| autoThreshold | false | When true, calculates threshold as average bar range across all candles |
| showLast | 0 | 0 = show all FVGs. N = show only N most-recent unmitigated FVGs |
| dynamic | false | Show horizontal dynamic level lines tracking current bull/bear FVG levels |
| EXTEND_BARS | 20 | Bars forward to extend unmitigated zone rectangles (set in `_fvgRender`) |
