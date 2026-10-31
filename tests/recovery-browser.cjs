'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {webkit} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fs.existsSync(path.resolve(__dirname, '../manifest.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../extension');
const fixtures = fs.existsSync(path.join(__dirname, 'fixtures')) ? path.join(__dirname, 'fixtures') : path.resolve(__dirname, '../../stream-fixtures');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))), mainFiles = manifest.content_scripts.find(script => script.world === 'MAIN').js, isolatedFiles = manifest.content_scripts.find(script => script.world === 'ISOLATED').js;
const checks = [];
async function poll(callback, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {const result = await callback(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 120));}
  throw new Error('Timed out waiting for a measured audio condition.');
}
async function run() {
  const browser = await webkit.launch({headless: true, ...(process.env.WEBKIT_EXECUTABLE ? {executablePath: process.env.WEBKIT_EXECUTABLE} : {})});
  try {
    for (const type of ['mp4', 'webm']) {
      const context = await browser.newContext({viewport: {width: 1100, height: 900}});
      await context.addInitScript(() => {
        const events = [], changed = []; let stored = {};
        globalThis.browser = {runtime: {id: 'recovery-fixture', getURL: file => 'https://www.youtube.com/__fx/' + file, onMessage: {addListener: callback => events.push(callback)}}, storage: {local: {get: async key => ({[key]: stored[key]}), set: async value => {stored = {...stored, ...value}; for (const [key, next] of Object.entries(value)) changed.forEach(callback => callback({[key]: {newValue: next}}, 'local'));}}, onChanged: {addListener: callback => changed.push(callback)}}};
        globalThis.__message = message => new Promise(resolve => events.forEach(callback => callback(message, {id: 'recovery-fixture'}, resolve)));
        // Reproduce the user's failure: the media element plays, but its Web
        // Audio source outputs ONLY zeros. This is the input bug, not DSP.
        AudioContext.prototype.createMediaElementSource = function() {const silent = this.createGain(); silent.gain.value = 0; return silent;};
      });
      const errors = [], page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await context.route('https://www.youtube.com/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/__fx/')) {const file = path.join(root, path.basename(url.pathname)); return route.fulfill({contentType: 'text/javascript', body: fs.readFileSync(file)});}
        if (/^\/fixture\.(mp4|webm)$/.test(url.pathname)) {const extension = url.pathname.split('.').at(-1); return route.fulfill({contentType: extension === 'mp4' ? 'audio/mp4' : 'audio/webm', body: fs.readFileSync(path.join(fixtures, 'stereo.' + extension))});}
        if (url.pathname === '/video.mp4') return route.fulfill({contentType: 'video/mp4', body: fs.readFileSync(path.join(fixtures, 'stereo-video.mp4'))});
        return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Streaming recovery</title><style>body{background:#111;color:white;font:16px system-ui;padding:40px}video{width:600px;height:300px;background:#242838}button{padding:15px}</style><h1>Stream recovery fixture</h1><div id="movie_player"><video class="html5-main-video" controls loop></video></div><button id="play">Play stream</button>'});
      });
      await page.goto('https://www.youtube.com/watch?v=recovery');
      for (const file of mainFiles) {
        await page.addScriptTag({url: 'https://www.youtube.com/__fx/' + file});
        if (file === 'audio-engine.js') await page.evaluate(() => {
          const Original = globalThis.YouTubeFXAudioEngine;
          globalThis.YouTubeFXAudioEngine = class extends Original {constructor(...args) {super(...args); globalThis.__nativeFixtureEngine = this;}};
        });
      }
      for (const file of isolatedFiles) await page.addScriptTag({url: 'https://www.youtube.com/__fx/' + file});
      const load = await page.evaluate(async type => {
        const mime = type === 'mp4' ? 'audio/mp4; codecs="mp4a.40.2"' : 'audio/webm; codecs="opus"';
        const nativeWebM = MediaSource.isTypeSupported(mime);
        const playbackMime = nativeWebM ? mime : 'audio/mp4; codecs="mp4a.40.2"';
        const video = document.querySelector('video'), media = new MediaSource(), blob = URL.createObjectURL(media);
        video.src = blob; await new Promise(resolve => media.addEventListener('sourceopen', resolve, {once: true}));
        const buffer = media.addSourceBuffer(playbackMime), videoBuffer = media.addSourceBuffer('video/mp4; codecs="avc1.42C01E"');
        const videoBytes = await (await fetch('/video.mp4')).arrayBuffer();
        await new Promise((resolve, reject) => {videoBuffer.addEventListener('updateend', resolve, {once: true}); videoBuffer.addEventListener('error', reject, {once: true}); videoBuffer.appendBuffer(videoBytes);});
        const bytes = await (await fetch('/fixture.' + (nativeWebM ? type : 'mp4'))).arrayBuffer();
        await new Promise((resolve, reject) => {buffer.addEventListener('updateend', resolve, {once: true}); buffer.addEventListener('error', reject, {once: true}); buffer.appendBuffer(bytes);});
        videoBuffer.timestampOffset = buffer.timestampOffset = 16;
        for (const [target, data] of [[videoBuffer, videoBytes], [buffer, bytes]]) await new Promise((resolve, reject) => {target.addEventListener('updateend', resolve, {once: true}); target.addEventListener('error', reject, {once: true}); target.appendBuffer(data);});
        if (playbackMime.startsWith('audio/mp4')) {
          const moov = YouTubeFXDemux.boxes(new Uint8Array(bytes)).find(box => box.type === 'moov');
          globalThis.__repeatHeader = async () => {
            const header = bytes.slice(0, moov.end);
            await new Promise((resolve, reject) => {buffer.addEventListener('updateend', resolve, {once: true}); buffer.addEventListener('error', reject, {once: true}); buffer.appendBuffer(header);});
          };
        }
        media.endOfStream(); document.querySelector('#play').onclick = () => video.play();
        if (!nativeWebM) {
          // Linux WebKit does not expose WebM MSE. Test the exact WebM parser
          // and native Opus decoder against a playable AAC/video clock.
          const webm = new Uint8Array(await (await fetch('/fixture.webm')).arrayBuffer()), track = {mime, packets: [], generation: 1}; let serial = 0;
          const parser = new YouTubeFXDemux.WebMAudio(config => track.config = config, packet => {packet.id = ++serial; track.packets.push(packet);});
          parser.append(webm);
          track.packets.push(...track.packets.map(packet => ({...packet, id: ++serial, timestamp: packet.timestamp + 16e6})));
          globalThis.__youtubeFXTap = {find: () => track, diagnostics: () => ({fixture: 'Opus demux/decoder with AAC media clock', packets: track.packets.length, codec: track.config?.codec})};
        }
        return {mime, nativeMSE: nativeWebM, tap: __youtubeFXTap.diagnostics()};
      }, type);
      assert.ok(!load.unsupported, load.unsupported);
      assert.ok(load.tap.packets > 300, JSON.stringify(load));
      await page.getByRole('button', {name: 'Play stream', exact: true}).click();
      await page.getByRole('button', {name: 'YouTube FX audio controls'}).click();
      await page.getByRole('button', {name: 'Enable effects', exact: true}).click();
      const report = () => page.evaluate(() => __message({type: 'youtube-fx:diagnostics'}));
      await poll(async () => {const data = await report(); return data.recovery?.active && data.inputPeak > 0.00001 && data.outputPeak > 0.00001;}, 20000);
      let data = await report(); console.log('First recovered report:', JSON.stringify(data)); assert.equal(data.audio.route, 'buffered-stream'); assert.equal(data.captureWorld, 'page'); assert.equal(data.sampleRate, 48000);
      assert.equal(await page.locator('video').evaluate(video => video.audioTracks[0].enabled), false);
      assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1);
      checks.push(type + ': a silent media-element connection recovers real decoded PCM and disables the original audio track to prevent doubling.');
      await page.evaluate(() => __message({type: 'youtube-fx:set', patch: {semitones: -1, reverb: 0, volume: 100}}));
      await page.evaluate(() => {
        const engine = __nativeFixtureEngine, split = engine.context.createChannelSplitter(2);
        globalThis.__stereoAnalysers = [engine.context.createAnalyser(), engine.context.createAnalyser()];
        engine.output.connect(split); __stereoAnalysers.forEach((analyser, channel) => {analyser.fftSize = 16384; split.connect(analyser, channel);});
        globalThis.__qualityStarted = engine.context.currentTime;
      });
      await page.waitForFunction(() => __nativeFixtureEngine.context.currentTime - __qualityStarted > 1.5);
      const stereo = await page.evaluate(() => {
        const channels = __stereoAnalysers.map(analyser => {const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); return data;});
        const amplitude = (data, frequency) => {
          let real = 0, imag = 0, weight = 0;
          for (let i = 0; i < data.length; i++) {const w = .5 - .5 * Math.cos(2 * Math.PI * i / data.length), value = data[i] * w; real += value * Math.cos(2 * Math.PI * i * frequency / 48000); imag += value * Math.sin(2 * Math.PI * i * frequency / 48000); weight += w;}
          return Math.hypot(real, imag) * 2 / weight;
        };
        const r = 2 ** (-1 / 12);
        return {left: amplitude(channels[0], 440 * r), right: amplitude(channels[1], 660 * r),
          leftLeak: amplitude(channels[0], 660 * r), rightLeak: amplitude(channels[1], 440 * r)};
      });
      if (!(stereo.left > .12 && stereo.right > .12)) console.log('Unexpected stereo report:', JSON.stringify(await report()));
      assert.ok(stereo.left > .12 && stereo.right > .12, JSON.stringify(stereo));
      assert.ok(stereo.leftLeak < .001 && stereo.rightLeak < .001, JSON.stringify(stereo));
      data = await report(); assert.equal(data.pitch.stereo, 'phase-linked'); assert.ok(data.recovery.latencyCompensationMs > 310 && data.recovery.latencyCompensationMs < 325);
      console.log('Decoded pitch-only stereo measurement:', JSON.stringify({type, ...stereo, lookaheadMs: data.recovery.latencyCompensationMs}));
      checks.push(type + ': real decoded pitch-only output preserves distinct left/right tones and compensates processing latency.');
      if (type === 'mp4') {
        const beforeHeaders = await report();
        await page.evaluate(async () => {for (let i = 0; i < 5; i++) await __repeatHeader();});
        await page.waitForTimeout(150);
        const afterHeaders = await report();
        assert.equal(afterHeaders.recovery.decoderResets, beforeHeaders.recovery.decoderResets);
        assert.equal(afterHeaders.recovery.playback.epoch, beforeHeaders.recovery.playback.epoch);
        assert.ok(afterHeaders.streamTap.tracks[0].configRepeats >= 6);
        checks.push(type + ': five repeated native MSE initialization headers do not reset the decoder or PCM queue.');
      }
      const beforeFlags = await report();
      await page.evaluate(() => {
        const video = document.querySelector('video');
        globalThis.__pitchResetCalls = 0; const engine = __nativeFixtureEngine, original = engine.resetPitch.bind(engine);
        engine.resetPitch = () => {__pitchResetCalls++; original();};
        Object.defineProperty(video, 'seeking', {configurable: true, get: () => true});
        Object.defineProperty(video, 'readyState', {configurable: true, get: () => 1}); video.dispatchEvent(new Event('seeking'));
      });
      await page.waitForTimeout(350);
      await page.evaluate(() => {const video = document.querySelector('video'); delete video.seeking; delete video.readyState;});
      const afterFlags = await report();
      assert.equal(afterFlags.recovery.decoderResets, beforeFlags.recovery.decoderResets);
      assert.equal(afterFlags.recovery.playback.epoch, beforeFlags.recovery.playback.epoch);
      assert.equal(await page.evaluate(() => __pitchResetCalls), 0); assert.ok(afterFlags.outputPeak > .03);
      checks.push(type + ': progressing playback tolerates a transient seeking/readyState flag without erasing pitch history or resetting PCM.');
      await page.evaluate(() => __message({type: 'youtube-fx:set', patch: {semitones: -1, reverb: 62, decay: 4.8, volume: 100}}));
      await poll(async () => (await report()).recovery.playback?.renderedFrames >= 48000);
      const continuous = await report(); assert.equal(continuous.recovery.playback.backend, 'AudioWorklet queue');
      assert.equal(continuous.recovery.playback.underrunFrames, 0); assert.equal(continuous.recovery.scheduled, 0);
      await page.evaluate(() => {const end = performance.now() + 6000; while (performance.now() < end) { /* Deliberately stall page JavaScript. */ }});
      await poll(async () => (await report()).recovery.playback?.renderedFrames > continuous.recovery.playback.renderedFrames + 4800);
      const afterStall = await report();
      if (afterStall.recovery.decoderResets !== continuous.recovery.decoderResets) console.log('Clock/stall diagnostics:', JSON.stringify({before: continuous, after: afterStall}));
      assert.equal(afterStall.recovery.playback.underrunFrames, 0); assert.equal(afterStall.recovery.decoderResets, continuous.recovery.decoderResets);
      console.log('Continuity after page stall:', JSON.stringify({type, playback: afterStall.recovery.playback, resets: afterStall.recovery.decoderResets}));
      checks.push(type + ': at -1 semitone / 62% reverb / 4.8s decay, playback survives a six-second page stall with zero underruns and no decoder reset.');
      await page.evaluate(() => __message({type: 'youtube-fx:set', patch: {semitones: -3, reverb: 100, volume: 0}}));
      await poll(async () => {const data = await report(); return data.inputPeak > 0.00001 && data.outputPeak < 0.000001;});
      checks.push(type + ': slider changes affect the recovered signal; output level zero produces zero processed output.');
      await page.evaluate(() => document.querySelector('video').pause());
      await page.waitForFunction(() => document.querySelector('video').audioTracks[0].enabled);
      await page.locator('#play').click();
      await page.evaluate(() => {document.querySelector('video').currentTime = 1;});
      await poll(async () => {const data = await report(); return data.recovery?.active && data.inputPeak > 0.00001;}, 10000);
      checks.push(type + ': pause and seeking release the original track and resume synchronized recovery.');
      await page.evaluate(() => __message({type: 'youtube-fx:set', patch: {enabled: false}}));
      await page.waitForFunction(() => document.querySelector('video').audioTracks[0].enabled);
      data = await report(); assert.equal(data.recovery.active, false);
      assert.deepEqual(errors, []); checks.push(type + ': turning effects off restores the original audio track with no page errors.');
      console.log(JSON.stringify({type, checks: checks.slice(-6), tap: data.streamTap}, null, 2));
      await context.close();
    }
    console.log(JSON.stringify({checks, passed: checks.length}, null, 2));
  } finally {await browser.close();}
}
run().catch(error => {console.error(error); process.exitCode = 1;});
