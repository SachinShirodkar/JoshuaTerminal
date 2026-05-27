# Indicators Converted from Pine to JS

## S/D Zones & Major Structure Auto Fib

This indicator uses boxes and labels in Pine Script which are drawing objects. In Joshua Terminal, these are rendered as canvas rectangles and text during each paint cycle. The indicator detects Break of Structure (BOS) by tracking pivot highs/lows and monitoring when price crosses previous structure levels. Supply zones are created when price breaks below a pivot low after a pivot high, and demand zones when price breaks above a pivot high after a pivot low. Major structure Fibonacci levels are calculated between the two most recent opposing major pivots (determined by majorPivotLen). Zones are extended to the current bar and removed when mitigated (price closes through them). The canvas drawing approach means zones and fibs are painted fresh each frame rather than persisted as objects. Colors are hardcoded but can be made configurable via additional parameters.
