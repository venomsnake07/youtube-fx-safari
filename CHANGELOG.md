# Changelog

## 1.5.0 — 2026-11-02

- Added linked sample-rate playback from 50% to 200%, with natural pitch changes.
- Added a link/unlink toggle for independent speed and pitch.
- Added +/− buttons beside every slider.
- Updated buffered playback timing, reserve, and latency compensation for variable speed.
- Preserved stereo resampling and added denser processing for extreme independent ratios.
- Included the personal Mac app installer and signing instructions.
- Passed 137 automated checks and 38 WebKit checks; native Mac Safari still needs testing.


## 1.4.0 — 2026-10-31

- Improved recovery stability after page stalls and transient player state changes.
- Avoided redundant decoder restarts from repeated stream headers/fragments.
- Expanded PCM buffering and improved queue/accounting diagnostics.
- Retained stereo pitch engine and refined long-tail reverb bass response.
- Included regression tests and generated media fixtures.

For technical details and test limitations, see [VALIDATION.md](VALIDATION.md).