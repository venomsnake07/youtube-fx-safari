# Changelog

## 1.4.0 — 2026-10-31

- Improved recovery stability after page stalls and transient player state changes.
- Avoided redundant decoder restarts from repeated stream headers/fragments.
- Expanded PCM buffering and improved queue/accounting diagnostics.
- Retained stereo pitch engine and refined long-tail reverb bass response.
- Included regression tests and generated media fixtures.

For technical details and test limitations, see [VALIDATION.md](VALIDATION.md).