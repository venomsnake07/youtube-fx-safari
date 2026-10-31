# Validation — YouTube FX 1.4.0

98 Node tests and 31 WebKit browser checks pass. Tests use the bundled production processors and generated AAC/Opus/stereo fixtures. No compilation is needed to install the extension.

## Recovery regression tests

The previous short tests did not reproduce all intermittent cutouts. A new six-second page-JavaScript stall reproduced a false decoder restart: after the page became responsive, the media clock caught up in several steps, and the extension treated those steps as new seeks. The revised recovery logic retains decoded data, lets clocks settle, and distinguishes a buffered relocation from an uncached seek.

Both the native fragmented-MP4/AAC route and the Opus route now pass this stress test at the reported settings: −1 semitone, 62% reverb, 4.8-second decay, volume 100%. Both report:

- Zero PCM underrun frames before and after the deliberate six-second stall.
- The same PCM epoch before and after the stall; usable audio is not cleared.
- One decoder creation for initial recovery, with no additional restart during the stall.
- No PCM overflow, duplicate-frame playback, or rebuffer fallback during the interval.

The 15 browser recovery checks also cover repeated native MediaSource initialization headers during playback, temporary seeking/readyState flags, real stereo separation through decoding and pitch processing, latency compensation, output volume, pause, seek, disable, and native track restoration.

AAC tests repeat native MSE headers five times while playing. Codec generation, decoder count, and PCM epoch remain unchanged. Both formats tolerate an artificial transient seeking flag with a moving player clock; pitch history is retained.

Linux WebKit lacks WebM MediaSource playback. The Opus case therefore uses the actual WebM demuxer and native Opus AudioDecoder, with AAC/video MSE supplying the player clock. Both fixtures are locally generated. The harness loads both extension script worlds in one test page; it does not fully reproduce native Safari extension isolation.

## Cache and buffer accounting

Node regression checks cover:

- Fifty repeated AAC or Opus headers/fragments retain one codec generation and one copy of each encoded timestamp.
- A same-format changeType call retains useful cached audio; a genuinely changed decoder description creates a new configuration.
- Native append failures do not mutate the extension cache.
- Track selection follows the current playback position and retains a healthy track while another format is prefetched.
- Batch eviction obeys byte/packet limits and protects the playback position.
- Pause/resume and player buffering retain decoded coverage instead of resetting the queue.
- Wall-clock and audio-clock differences do not masquerade as seeks. Several catching-up media-clock samples after a page stall do not restart playback.
- Buffered jumps reuse the queue; an uncached seek still resets the decoder when required.
- A 614-second absolute timestamp never becomes a fictitious 519-second audio reserve. Buffered duration stops at real gaps and remains bounded by physical queue capacity.
- A larger queue renders ten seconds without any page refill and without an underrun.

Page-lifetime received byte/packet totals are reported separately from retained cache bytes. Recent recovery events and audio-context state transitions make later reports more informative, including reports copied after pausing.

## Sound quality checks

The five WebKit offline quality renders exercise the production graph: real stereo AudioWorklet, Signalsmith Stretch, 96-tap band-limited resampler, routing, output level and peak protection. Offline context startup is shimmed; the audio nodes and processing are real.

They verify stereo phase/width, channel balance, high-frequency retention at 14 and 17 kHz, chord bass and mid/side separation, impulse latency, and bounded hot-input peaks. The reverb highpass response is checked at 40, 120 and 1000 Hz, including its non-resonant cutoff. The pitch-only path retains its previous fidelity; no new lossy encoding is added.

Node quality checks include stereo pitch/duration at 44.1 and 48 kHz, cents/octave shifts, opposite-polarity material, hard panning, centered mono, high-frequency retention during drift correction and 44.1-to-48 kHz conversion, alias rejection, smoothed changes, reset/invalid samples, stable memory, and equivalent AudioWorklet/compatibility results.

Rapid decay adjustments are coalesced: one new convolution tail is built after the controls settle. Reverb removes low bass from its wet path while the dry signal retains its bass.

The original 11 browser UI/integration checks also pass: controls, presets, playlist/player replacement, real media binding, bypass, worklet and compatibility paths, convolution tails, measured volume changes and copyable diagnostics.

## Reproduce

From the extracted extension directory:

```sh
node --test tests/*.test.cjs
node tests/browser.cjs
node tests/quality-browser.cjs
node tests/recovery-browser.cjs
```

Browser checks need the optional Playwright development package, its WebKit browser, and browser dependencies. PLAYWRIGHT_MODULE and WEBKIT_EXECUTABLE may select an existing installation. Fixtures are under tests/fixtures and numeric/text results are under tests/results. THIRD-PARTY-NOTICES.md records the unchanged kernel's MIT license and provenance.

## Limits

These are generated-signal and regression tests, not a guarantee of artifact-free transformation of every recording. A real paused player, missing source audio, system sleep, or suspension longer than the available reserve can still interrupt playback. Direct media-element processing adds approximately 0.2–0.5 seconds of pitch latency; the buffered route compensates its processor latency.

No live YouTube end-to-end session, native macOS Safari 27.2 listening test, hardware audio-driver deadline measurement, or AirPlay test was available. Browser checks run in Playwright WebKit 26.5 on Linux. PCM queue counters do not measure every possible hardware rendering glitch.