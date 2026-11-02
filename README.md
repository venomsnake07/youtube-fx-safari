# YouTube FX — Rate, Pitch & Reverb for Safari

**Current version:** 1.5.0 · **License:** MIT · **Platform:** macOS Safari 18.4+

[Download v1.5.0](https://github.com/venomsnake07/youtube-fx-safari/releases/tag/v1.5.0)

> Free, open-source, and independent. Not affiliated with YouTube, Google, or Apple.

A Safari Web Extension for YouTube and YouTube Music. Requires Safari 18.4 or later on macOS. Playback rate, independent pitch, and reverb use local stereo audio processing.

## Stay installed after quitting Safari

Extract the whole permanent-install ZIP and follow **PERMANENT-INSTALL.md**. Install Xcode, create an Apple Development certificate in its account settings, then double-click **INSTALL-ON-MAC.command**. The installer builds and signs a Mac app on your Mac, verifies both signatures, and installs it in **Home → Applications**. Enable the installed extension in Safari, remove the old temporary entry, and reload every YouTube tab.

This is a personal development installation. It survives Safari restarts, subject to Apple's signing validity; it may eventually need re-signing. It is not an already signed/notarized app download. The Mac build and restart check must be completed on your Mac. The instructions below also retain the temporary testing option.

## Update a temporary testing installation

1. Remove the old temporary extension in Safari Settings → Extensions.
2. Add the extracted folder containing manifest.json under Safari Settings → Developer → Add Temporary Extension.
3. Reload every YouTube tab. A full reload is essential: this version observes the player’s stream setup from the beginning of page loading.
4. Check the panel header says **v1.5.0**, start a video, and use **Sample rate** to set the speed.
5. Enable effects and allow about **5–10 seconds** for automatic recovery if Safari’s original audio connection returns zeros.

The audio meter should move. When recovery is needed, the status reads **Audio detected · Safari stream recovery.**

## New controls in 1.5.0

Use **Sample rate 95%** with the chain linked for a natural slowdown: speed becomes 0.95× and pitch falls about 0.89 semitones. Click **Unlink** for separate speed and pitch. For 95% speed at the original key, unlink and set Pitch and Pitch fine tune to zero. The linked path does not run a spectral pitch shifter.

The queue now follows speeds from 50% to 200%, retains data across rate changes, adjusts latency compensation for speed, and targets at least 12 seconds of wall-clock reserve when available (24 media seconds at 200%). Existing header deduplication and pause/seek protections are retained. Old saved pitch-only settings migrate at 100% speed in independent mode.

## Retained playback stability

The previous stability fixes remain in this version:

- Repeated stream headers with the same codec configuration no longer restart the decoder.
- Re-appended encoded fragments are deduplicated. Cache eviction happens in batches, without repeatedly shifting large packet arrays.
- Playback keeps a speed-adjusted reserve of decoded audio ahead, when YouTube has supplied it. Audio-thread low-buffer messages and incoming fragments can request a refill without waiting for the page timer.
- Brief player-state flags, pause/resume, and buffering retain usable decoded data. A buffered seek can reuse the queue.
- Playback clocks receive a settling interval after a delayed page callback. Clock catch-up is not treated as a succession of new seeks.
- Decoded sample buffers transfer to the audio thread, reducing extra copies and page memory.
- Recovery selects a track covering the playback position rather than staying on a stale audio buffer.
- A previously unlocked audio context receives a resume attempt when the page becomes active again.

The diagnostic report now records restart reasons and recent transitions. Its buffered duration describes contiguous, usable audio, rather than subtracting an absolute video timestamp from zero. `streamTap.bytes` and `streamTap.packets` are page-lifetime received counters; `streamTap.cachedBytes` is the retained encoded cache size.

## Sound quality

Linked mode uses natural stereo resampling and bypasses the spectral pitch shifter. Independent mode uses the phase-linked Signalsmith engine and a 96-tap band-limited resampler. The established analysis configuration handles ordinary shifts; extreme combined ratios use a preallocated engine with denser overlap. The denser overlap improves large speed/pitch combinations; the resampler filter bank covers their extended range. Processing uses floating-point samples without adding lossy encoding or changing YouTube's selected audio quality.

Reverb now removes very low bass from its wet path, reducing buildup with long tails and strong mixes. The original dry bass remains in the mix. Rapid tail-length adjustments build one new convolution tail after the control settles, rather than constructing many competing tails.

For a pitch-only comparison, use **−1 semitone**, **reverb 0%**, and **volume 100%**. The **62% reverb / 4.8-second decay** example settings are covered by the new playback stress tests. The panel should say **v1.5.0** after updating. Saved pitch-only settings from older versions reopen in independent mode at 100% speed so their sound is preserved; click **Link** to switch to natural rate changes.

## Audio input

The earlier versions depended on MediaElementAudioSourceNode. Safari can play streamed media normally while that connection returns silent samples. This version moves audio handling into the page’s own JavaScript world and adds a second route: it observes already-loaded clear audio fragments, decodes them locally with WebCodecs, and feeds their samples directly into the effects.

Recovery supports AAC and Opus in fragmented MP4, plus Opus in WebM. It renders a continuous PCM timeline against the video clock. The original audio track is disabled only while decoded audio covers the current playback position, then restored when effects are turned off, playback pauses, or decoding fails. The extension sets the native video playback rate to match the selected speed and disables browser pitch preservation while effects are on. The decoded queue follows that rate and compensates processor latency in media time. Turning effects off restores the pre-extension rate and pitch-preservation setting.

This is a substantial input-path change. It is not proof that every current Safari/YouTube variant works; see VALIDATION.md for the exact tests and limits.

## First installation

1. In Safari → Settings → Advanced, enable **Show features for web developers**.
2. Under **Developer**, click **Add Temporary Extension…** and select this ZIP or the extracted folder containing manifest.json.
3. Enable **YouTube FX — Rate, Pitch & Reverb** in Extensions and allow it on **youtube.com**. Also allow **music.youtube.com** if needed.
4. Reload YouTube, open a video, click **ƒx** at the bottom right, and click **Enable effects**.

Safari removes temporary extensions after 24 hours or when you quit Safari. Re-add the ZIP when necessary. This is an unsigned development extension. Apple’s instructions: https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension

## Controls

- **Sample rate:** 50–200%. At **95%**, tempo and pitch both fall to 95% of their original rate. This is a playback/resampling ratio; it does not change the Mac’s hardware sample-rate setting.
- **Link / Unlink:** linked by default for new settings. Unlinking reveals **Speed** and **Pitch**. The toggle initially keeps the audible key; speed and pitch can then be adjusted separately. Pitch covers −12 to +12 semitones, with cent adjustment in Fine tuning.
- **+ / − buttons:** adjust each slider precisely. Rate moves in 1 percentage-point steps; pitch in semitones, cents in cents, reverb/volume in percent, and tail in 0.1-second steps. Double-click a slider to restore its default.
- **Reverb:** 0–100%. Try Piano hall or start around 20–30%.
- **Fine tuning:** ±50 cents, tail length from 0.4 to 6 seconds, and output level.
- **Effects on · Turn off:** restores original audio.
- **Reset:** turns effects off, selects linked 100% rate, zeroes pitch/reverb, and restores output level.
- The Safari toolbar popup and the page panel share settings saved locally on your Mac.

## Troubleshooting

With a video playing, open **Troubleshooting → Copy diagnostics** and review the report before sharing it in a GitHub issue. If Safari blocks automatic copying, select the displayed report and press **⌘C**. No video URLs or account identifiers are included. For continuity problems, include `recovery.recentEvents`, `lastResetReason`, `decoderResets`, and `playback.underrunFrames`. Zero underrun frames means the queue has not run out of PCM data during the current playback epoch. The report also includes page visibility and recent audio-context state changes.

- A flat meter means no samples are reaching the effects, even if the video is audible.
- If the status asks for a page click, click **Enable audio** on the YouTube page.
- If recovery asks for a reload, reload the entire YouTube page after installing this version.
- Both the direct and recovered audio routes support 50–200% speed. While effects are on, the extension controls speed; use its Speed or Sample rate slider rather than YouTube’s native speed menu.
- Disable other volume or audio-processing extensions and reload if they compete for the player.
- After reloading or removing this extension, reload YouTube too. Use the extension’s own Turn off button for normal bypass.

Recovery requires page-visible MediaSource audio buffers and the browser’s audio decoder. Native HLS without page-visible fragments, streams built inside dedicated workers, encrypted rentals, and remote playback such as AirPlay may remain unsupported. Missing or undecodable buffers keep the original track enabled.

The buffered-stream route compensates the processor delay during steady playback. A genuine network stall, paused player, system sleep, or suspension beyond the available reserve can still interrupt audio. The direct media-element route adds roughly 0.2–0.5 seconds of processing delay, depending on pitch. Large shifts can still soften attacks or alter vocal character; pitch changes, seeking, and buffering can have brief transitions. Reverb tails may continue briefly after pause.

## Privacy and source

The extension runs only on the YouTube domains listed in its manifest. Audio and encoded chunks remain in local browser memory; caches are bounded. There is no microphone access, recording, audio upload, analytics, account, server, or remote executable code.

All JavaScript, the bundled WebAssembly kernel, HTML, icons, and tests are included. Temporary testing needs no build step. The signed Mac app uses the Xcode build described in PERMANENT-INSTALL.md. Test fixtures contain locally generated stereo tones and black video. Tests are optional development tools. THIRD-PARTY-NOTICES.md records the audio kernel license, upstream source, pinned release, and reproducible embedding tool.

Released under the MIT License. Not affiliated with YouTube, Google, or Apple.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Do not include account data, cookies, or private URLs in reports.
