# Contributing to YouTube FX

Thanks for helping improve the Safari extension.

## Report a bug

- State your macOS version, Safari version, and whether the issue occurs on YouTube or YouTube Music.
- Describe steps to reproduce, what you expected, and what occurred.
- Optionally include diagnostics from **Troubleshooting → Copy diagnostics** after reviewing them for private information.
- **Never post** account credentials, cookies, tokens, private links, or personally identifying information.

## Development

The browser extension source is in this repository's root. No build step is required for temporary Safari installation.

Run the portable Node tests:

```sh
node --test tests/*.test.cjs
```

Additional WebKit browser checks are documented in [VALIDATION.md](VALIDATION.md). They require a separately installed Playwright/WebKit development environment.

For changes to the WASM pitch processor, review `tools/vendor-pitch.cjs` and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) before updating the pinned dependency. Retain the upstream license notices.

## Pull requests

Keep changes focused, describe the user-visible behavior, and include regression tests when practical. Please test in Safari when changing media or audio routing; browser emulation is not a substitute for Safari testing.