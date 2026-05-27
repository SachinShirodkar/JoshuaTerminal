# Indicators Converted from Pine to JS

## S/D Zones & Major Structure Auto Fib

This indicator uses boxes and labels in Pine Script which are drawing objects. In Joshua Terminal, these are rendered as canvas rectangles and text during each paint cycle. The indicator detects Break of Structure (BOS) by tracking pivot highs/lows and monitoring when price crosses previous structure levels. Supply zones are created when price breaks below a pivot low after a pivot high, and demand zones when price breaks above a pivot high after a pivot low. Major structure Fibonacci levels are calculated between the two most recent opposing major pivots (determined by majorPivotLen). Zones are extended to the current bar and removed when mitigated (price closes through them). The canvas drawing approach means zones and fibs are painted fresh each frame rather than persisted as objects. Colors are hardcoded but can be made configurable via additional parameters.

## Order Blocks

This is a complex indicator with drawing operations (boxes/rectangles for order blocks). The Pine Script uses box.new() and line.new() with extend.right which draws to future. In Joshua Terminal, rectangles are drawn from block start to canvas edge. Mitigated blocks change color when price crosses them. Some features simplified: candle coloring, alerts, previous day high/low (requires daily timeframe data), and retest highlighting are not included. The core order block detection logic based on break of structure (BOS) is preserved. Parameters like colors and visibility flags should be added to indicator.params. The indicator tracks swing highs/lows and creates blocks when structure breaks occur.
