# Validation — YouTube FX 1.5.0

137 Node checks and 38 WebKit checks passed for this build: 12 UI/integration checks, 5 offline quality renders, and 21 AAC/Opus recovery checks. The production DSP, PCM queue, settings, stream parser, and audio graph are exercised. Numeric/text results are in tests/results; screenshots are not included.

## Rate and independent pitch

Generated stereo signals verify natural pitch and elapsed media time at 50%, 95%, 100%, 150%, and 200%. Independent combinations include 50% speed / +12 semitones, 95% / original pitch, 95% / −3 semitones, 150% / +3 semitones, and 200% / −12 semitones. Pitch accuracy and both channel levels pass. At 95%, the linked path retains 14/17 kHz source detail; upward rate changes reject content above the output Nyquist frequency rather than folding it into audible aliases.

Changing rate retains PCM data and its current position. Recovery regression tests verify speed-scaled latency compensation and normal clock advances at 0.5×, 0.95×, 1.5×, and 2×. Linked mode bypasses spectral pitch processing. Independent correction uses the existing stereo algorithm for ordinary shifts and a preallocated denser-overlap engine for combined ratios beyond ±12.5 semitones. No extra lossy encoding is introduced.

WebKit UI checks verify the Sample rate slider, +/− controls, native playbackRate, disabled browser pitch preservation, unlocking without a key jump, independent controls, toolbar messages, presets, reset/bypass, player replacement, compatibility processing, and diagnostics. Old saved pitch-only settings migrate to independent mode at 100% speed.

## Streaming and browser limits

The recovery tests intentionally make MediaElementAudioSourceNode output zeros, reproducing the input failure in the earlier reports. AAC uses native fragmented-MP4 MSE and AudioDecoder. Opus uses the actual WebM demuxer and native Opus decoder; this Linux WebKit build lacks WebM MSE playback, so an AAC/video MSE supplies its clock. The two extension script worlds are loaded in one page, which does not reproduce every Safari extension-isolation detail.

Both formats measure correct, separate left/right pitches at 95% linked, 95% independent original-key, and 150% linked. They maintain timing without a decoder restart or PCM underrun. At the previous −1 semitone / 62% reverb / 4.8-second decay settings, both survive six seconds of blocked page JavaScript with zero queue underruns and no decoder restart. Repeated headers, transient seeking flags, pause/resume, seeking, output level zero, disable, and native track restoration also pass.

A platform-specific test limitation is explicit: this Linux GStreamer build freezes the MSE video clock when changing speed with its native audio track disabled. A separate test without the extension reproduced this; the same MSE rate changes work while the track remains enabled. For the new variable-rate scenarios only, the harness virtualizes the track-enabled switch while retaining the real native video clock, playbackRate, decoder, PCM worklet, and audio graph. Existing 1× streaming checks use real native track switching. Apple Safari uses an AVFoundation media implementation; native macOS rate changes with a disabled track still require testing on the user's Mac. See WebKit's platform notes: https://docs.webkit.org/Deep%20Dive/Modules/MediaSourceExtensions.html

## Sound quality and stability

Five production-graph offline renders check stereo phase/width, panning balance, 14/17 kHz detail, chord bass and mid/side separation, impulse latency, and hot-input peak protection. The reverb highpass response is measured at 40, 120, and 1000 Hz. Node checks also cover 44.1/48 kHz pitch accuracy, octave/cents shifts, opposite polarity, centered mono, hard panning, clock-correction treble, continuous sample-rate conversion, alias rejection, invalid samples, resets, stable processor memory, and compatibility/worklet equivalence.

Retained cache and queue checks cover repeated headers/fragments, duplicate packet rejection, format changes, append failure, current-position track selection, bounded eviction, timestamp rounding, real gaps, pause/seek retention, delayed page clocks, and ten seconds without a page refill. The speed-adjusted queue targets at least twelve seconds of wall-clock reserve when source data is available.

## Personal Mac installer

The 137 Node checks include 21 installer checks using real staging, hashes, file copies, paths with spaces/apostrophes, backups, and replacement. They cover packager names, scheme selection, signing order, Apple-anchor verification, missing tools/certificates, modified resources, unsafe paths, unrelated apps, symlinks, and build/sign/copy failures. Native Xcode, Keychain, codesign, and app launch are mocked. The production-resource checksum list is regenerated for v1.5.0.

No real Mac app was compiled or signed here. Certificate validity, native Safari registration, and persistence after Safari restarts must be checked on the Mac using the included installer and guide.

## Reproduce

From the extracted folder:

```sh
node --test tests/*.test.cjs
node tests/browser.cjs
node tests/quality-browser.cjs
node tests/recovery-browser.cjs
```

Browser checks need Playwright, its WebKit browser, and media dependencies. PLAYWRIGHT_MODULE and WEBKIT_EXECUTABLE can select an existing installation. Fixtures are under tests/fixtures. THIRD-PARTY-NOTICES.md documents the unchanged MIT-licensed kernel.

## Practical limits

Generated-signal tests do not guarantee artifact-free transformation of every recording. Large independent pitch/speed differences can still alter transients or vocal character. Changing modes, seeking, missing source packets, system sleep, or suspension beyond the available reserve can cause transitions. The buffered route compensates steady processor latency; direct media-element pitch processing adds delay.

No live YouTube end-to-end session, native macOS Safari 27.2 listening test, hardware audio deadline measurement, or AirPlay test was available. WebKit checks run on Linux. Queue underrun counters do not measure every possible hardware rendering glitch.
