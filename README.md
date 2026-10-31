# YouTube FX — Reverb & Pitch for Safari

**Current version:** 1.4.0 · **License:** MIT · **Platform:** macOS Safari 18.4+

> Free, open-source, and independent. Not affiliated with YouTube, Google, or Apple.


A Safari Web Extension for YouTube and YouTube Music. Requires Safari 18.4 or later on macOS. No extra app or Xcode is required for temporary installation.

## Features

- Adjust pitch independently from video playback speed (−12 to +12 semitones, plus fine tuning).
- Mix in reverb with adjustable decay and output level.
- Run audio processing locally on YouTube and YouTube Music.
- Recover audio from certain buffered AAC/Opus streams when Safari feeds silence into the standard audio connection.
- Keep the same settings in the page panel and toolbar popup.

**Note:** The extension shifts audio pitch without slowing video playback. It is designed for the YouTube domains in the manifest, not every website.

## Quick installation

1. Download the repository as a ZIP (or download the packaged release ZIP, when available).
2. In Safari, enable **Show features for web developers** under Settings → Advanced.
3. In Settings → Developer, select **Add Temporary Extension…**, then choose the extracted folder containing `manifest.json` (or the extension ZIP).
4. Enable the extension and allow it on YouTube/YouTube Music. Reload open YouTube tabs.
5. Play a video and use the **ƒx** panel to enable and configure effects.

Temporary extensions are removed after 24 hours or when Safari quits. This free development installation does **not** make the extension permanent. For details, see Apple’s [installation guide](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).

## Update from an earlier version

1. Remove the old temporary extension in Safari Settings → Extensions.
2. Add YouTube-FX-Safari-1.4.0.zip under Safari Settings → Developer → Add Temporary Extension.
3. Reload every YouTube tab. A full reload is essential: this version observes the player’s stream setup from the beginning of page loading.
4. Check the panel header says **v1.4.0**, set YouTube playback speed to **Normal (1×)**, and start a video.
5. Enable effects and allow about **5–10 seconds** for automatic recovery if Safari’s original audio connection returns zeros.

The audio meter should move. When recovery is needed, the status reads **Audio detected · Safari stream recovery.**

## Playback stability in 1.4.0

This update fixes unnecessary recovery cycles during normal playback:

- Repeated stream headers with the same codec configuration no longer restart the decoder.
- Re-appended encoded fragments are deduplicated. Cache eviction happens in batches, without repeatedly shifting large packet arrays.
- Playback keeps up to 12 seconds of decoded audio ahead, when YouTube has supplied it. Audio-thread low-buffer messages and incoming fragments can request a refill without waiting for the page timer.
- Brief player-state flags, pause/resume, and buffering retain usable decoded data. A buffered seek can reuse the queue.
- Playback clocks receive a settling interval after a delayed page callback. Clock catch-up is not treated as a succession of new seeks.
- Decoded sample buffers transfer to the audio thread, reducing extra copies and page memory.
- Recovery selects a track covering the playback position rather than staying on a stale audio buffer.
- A previously unlocked audio context receives a resume attempt when the page becomes active again.

The diagnostic report now records restart reasons and recent transitions. Its buffered duration describes contiguous, usable audio, rather than subtracting an absolute video timestamp from zero. `streamTap.bytes` and `streamTap.packets` are page-lifetime received counters; `streamTap.cachedBytes` is the retained encoded cache size.

## Sound quality

The stereo phase-linked pitch engine and 96-tap band-limited resampling from 1.3.0 are retained. Processing uses floating-point samples without adding lossy encoding or changing YouTube's selected audio quality.

Reverb now removes very low bass from its wet path, reducing buildup with long tails and strong mixes. The original dry bass remains in the mix. Rapid tail-length adjustments build one new convolution tail after the control settles, rather than constructing many competing tails.

For a pitch-only comparison, use **−1 semitone**, **reverb 0%**, and **volume 100%**. The **62% reverb / 4.8-second decay** example setting is covered by the playback stress tests. The panel should say **v1.4.0** after updating.

## Audio input

The earlier versions depended on MediaElementAudioSourceNode. Safari can play streamed media normally while that connection returns silent samples. This version moves audio handling into the page’s own JavaScript world and adds a second route: it observes already-loaded clear audio fragments, decodes them locally with WebCodecs, and feeds their samples directly into the effects.

Recovery supports AAC and Opus in fragmented MP4, plus Opus in WebM. It renders a continuous PCM timeline against the video clock. The original audio track is disabled only while decoded audio covers the current playback position, then restored when effects are turned off, playback pauses, or decoding fails. The extension does not change YouTube’s playbackRate.

This is a substantial input-path change. It is not proof that every current Safari/YouTube variant works; see VALIDATION.md for the exact tests and limits.

## First installation

1. In Safari → Settings → Advanced, enable **Show features for web developers**.
2. Under **Developer**, click **Add Temporary Extension…** and select this ZIP or the extracted folder containing manifest.json.
3. Enable **YouTube FX — Reverb & Pitch** in Extensions and allow it on **youtube.com**. Also allow **music.youtube.com** if needed.
4. Reload YouTube, open a video, click **ƒx** at the bottom right, and click **Enable effects**.

Safari removes temporary extensions after 24 hours or when you quit Safari. Re-add the ZIP when necessary. This is an unsigned development extension. Apple’s instructions: https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension

## Controls

- **Pitch:** −12 to +12 semitones, independent of the video speed.
- **Reverb:** 0–100%. Try Piano hall or start around 20–30%.
- **Fine tuning:** ±50 cents, tail length from 0.4 to 6 seconds, and output level.
- **Effects on · Turn off:** restores original audio.
- **Reset:** turns effects off, sets pitch and reverb to zero, and restores output level.
- The Safari toolbar popup and the page panel share settings saved locally on your Mac.

## Troubleshooting

With a video playing, open **Troubleshooting → Copy diagnostics**. If Safari blocks automatic copying, select the report and press **⌘C**. Review the diagnostics before sharing them in a GitHub issue. The extension does not intentionally include video URLs or account identifiers. For continuity problems, include `recovery.recentEvents`, `lastResetReason`, `decoderResets`, and `playback.underrunFrames`. Zero underrun frames means the queue has not run out of PCM data during the current playback epoch. The report also includes page visibility and recent audio-context state changes.

- A flat meter means no samples are reaching the effects, even if the video is audible.
- If the status asks for a page click, click **Enable audio** on the YouTube page.
- If recovery asks for a reload, reload the entire YouTube page after installing this version.
- Recovery currently requires **Normal (1×)** playback speed. Direct media-element processing can still work at other speeds when Safari supplies audio normally.
- Disable other volume or audio-processing extensions and reload if they compete for the player.
- After reloading or removing this extension, reload YouTube too. Use the extension’s own Turn off button for normal bypass.

Recovery requires page-visible MediaSource audio buffers and the browser’s audio decoder. Native HLS without page-visible fragments, streams built inside dedicated workers, encrypted rentals, and remote playback such as AirPlay may remain unsupported. Missing or undecodable buffers keep the original track enabled.

The buffered-stream route compensates the processor delay during steady playback. A genuine network stall, paused player, system sleep, or suspension beyond the available reserve can still interrupt audio. The direct media-element route adds roughly 0.2–0.5 seconds of processing delay, depending on pitch. Large shifts can still soften attacks or alter vocal character; pitch changes, seeking, and buffering can have brief transitions. Reverb tails may continue briefly after pause.

## Privacy and source

The extension runs only on the YouTube domains listed in its manifest. Audio and encoded chunks remain in local browser memory; caches are bounded. There is no microphone access, recording, audio upload, analytics, account, server, or remote executable code.

All JavaScript, the bundled WebAssembly kernel, HTML, icons, and tests are included. No build step is needed to install. Test fixtures contain locally generated stereo tones and black video. Tests are optional development tools. THIRD-PARTY-NOTICES.md records the audio kernel license, upstream source, pinned release, and reproducible embedding tool.

Released under the MIT License. Not affiliated with YouTube, Google, or Apple.

## Contributing

Bug reports, test results, and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Please do not include account data, cookies, or private URLs in bug reports.

## License

MIT — see [LICENSE](LICENSE). Third-party component acknowledgements are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).