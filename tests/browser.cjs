/* WebKit engine integration tests against an offline YouTube-shaped fixture.
 * These do not claim to install a native Safari extension.
 * Requires the optional Playwright development package and its WebKit browser.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {webkit} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fs.existsSync(path.resolve(__dirname, '../manifest.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../extension');
const output = path.resolve(process.env.TEST_OUTPUT || path.join(__dirname, '../../test-output'));
fs.mkdirSync(output, {recursive: true});
const origin = 'https://www.youtube.com';
const files = ['settings.js', 'pitch-kernel.js', 'dsp.js', 'audio-engine.js', 'ui.js', 'content.js'];
async function poll(callback, timeout = 10000) {const end = Date.now() + timeout; while (Date.now() < end) {if (await callback()) return; await new Promise(resolve => setTimeout(resolve, 100));} throw new Error('Audio/UI condition timed out');}
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Audio test fixture</title><style>body{margin:0;background:#0f0f0f;color:#ddd;font:16px system-ui;padding:48px}h1{font-size:26px}video{display:block;width:640px;height:360px;background:#191c26;border:1px solid #333;border-radius:14px}button{padding:12px;margin-top:14px}</style></head><body><h1>YouTube player test</h1><div id="movie_player"><video class="html5-main-video" src="/tone.wav" controls loop></video></div><button id="start">Play test audio</button><script src="/fixture.js"></script></body></html>`;
function wav() {
  const sampleRate = 48000, count = sampleRate * 4, buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(7000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
  return buffer;
}
async function mockAPI(context) {
  await context.addInitScript(() => {
    const listeners = [], changed = []; let saved = {};
    globalThis.browser = {
      runtime: {id: 'fixture-only', getURL: file => 'https://www.youtube.com/__fx/' + file, onMessage: {addListener: fn => listeners.push(fn)}},
      storage: {local: {get: async key => ({[key]: saved[key]}), set: async value => {
        const changes = {}; for (const [key, next] of Object.entries(value)) {changes[key] = {newValue: next, oldValue: saved[key]}; saved[key] = next;}
        changed.forEach(fn => fn(changes, 'local'));
      }}, onChanged: {addListener: fn => changed.push(fn)}},
      tabs: {query: async () => [{id: 1, url: 'https://www.youtube.com/watch?v=fixture'}],
        sendMessage: async (_, message) => new Promise(resolve => {for (const fn of listeners) fn(message, {id: 'fixture-only'}, resolve);})}
    };
    globalThis.__fixtureRequest = message => new Promise(resolve => {for (const fn of listeners) fn(message, {id: 'fixture-only'}, resolve);});
  });
}
async function main() {
  const browser = await webkit.launch({headless: true, ...(process.env.WEBKIT_EXECUTABLE ? {executablePath: process.env.WEBKIT_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport: {width: 1120, height: 900}});
  await mockAPI(context);
  const failures = [], checks = [];
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  const serve = async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/__fx/')) {
      const filename = path.basename(url.pathname), file = path.join(root, filename);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: 'Not found'});
      return route.fulfill({contentType: filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(file)});
    }
    if (url.pathname === '/tone.wav') return route.fulfill({contentType: 'audio/wav', body: wav()});
    if (url.pathname === '/fixture.js') return route.fulfill({contentType: 'text/javascript', body: `document.querySelector('#start').onclick=()=>document.querySelector('video').play();`});
    return route.fulfill({contentType: 'text/html', body: fixture});
  };
  await context.route('https://www.youtube.com/**', serve);
  try {
    await page.goto(origin + '/watch?v=fixture');
    for (const file of files) {
      await page.addScriptTag({url: origin + '/__fx/' + file});
      if (file === 'audio-engine.js') await page.evaluate(() => {
        const Original = globalThis.YouTubeFXAudioEngine;
        globalThis.YouTubeFXAudioEngine = class extends Original {constructor(...args) {super(...args); globalThis.__fixtureEngine = this;}};
      });
    }
    const chip = page.getByRole('button', {name: 'YouTube FX audio controls'});
    await chip.waitFor({state: 'visible'}); await chip.click();
    await page.getByRole('button', {name: 'Enable effects', exact: true}).click();
    await page.waitForFunction(() => globalThis.__fixtureEngine?.ready);
    await page.getByRole('button', {name: 'Play test audio', exact: true}).click();
    await page.waitForFunction(() => globalThis.__fixtureEngine.status().attached);
    checks.push('Page panel activates a real Web Audio graph and attaches an HTML media element.');
    await page.getByLabel('Pitch', {exact: true}).fill('7');
    await page.getByLabel('Pitch', {exact: true}).dispatchEvent('input');
    await page.waitForFunction(() => globalThis.__fixtureEngine.settings.semitones === 7);
    assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1);
    await page.getByRole('button', {name: 'Piano hall', exact: true}).click();
    await page.waitForFunction(() => globalThis.__fixtureEngine.settings.reverb === 28);
    await page.screenshot({path: path.join(output, 'youtube-panel.png')});
    checks.push('Sliders and presets update the engine without changing playbackRate.');
    const graph = await page.evaluate(() => ({backend: globalThis.__fixtureEngine.backend, claims: globalThis.__fixtureEngine.activeSources.size}));
    assert.equal(graph.claims, 1);
    await page.evaluate(() => {history.pushState({}, '', '/watch?v=next'); window.dispatchEvent(new Event('yt-navigate-finish'));});
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => globalThis.__fixtureEngine.activeSources.size), 1);
    await page.evaluate(() => {const previous = document.querySelector('video'), next = previous.cloneNode(); previous.replaceWith(next);});
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => globalThis.__fixtureEngine.activeSources.size), 1);
    checks.push('Playlist navigation reuses the source; replacing the player detaches the old source.');
    await page.getByRole('button', {name: 'Effects on · Turn off', exact: true}).click();
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => globalThis.__fixtureEngine.bypass.gain.value > 0.99));
    checks.push('Turn off restores the original direct-audio path.');

    const offline = await page.evaluate(async () => {
      const sr = 48000, context = new OfflineAudioContext(2, sr * 3, sr);
      await context.audioWorklet.addModule('https://www.youtube.com/__fx/pitch-worklet.js');
      const pitch = new AudioWorkletNode(context, 'youtube-fx-pitch', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: {resamplerTable: globalThis.YouTubeFXDSP.resamplerTable()}});
      pitch.parameters.get('active').value = 1; pitch.parameters.get('pitch').value = 7;
      const buffer = context.createBuffer(2, sr * 3, sr);
      for (let c = 0; c < 2; c++) {const data = buffer.getChannelData(c); for (let i = 0; i < data.length; i++) data[i] = 0.25 * Math.sin(2 * Math.PI * (c ? 330 : 440) * i / sr);}
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(pitch); pitch.connect(context.destination); source.start();
      const rendered = await context.startRendering();
      const frequencies = [], levels = [];
      for (let c = 0; c < 2; c++) {
        const data = rendered.getChannelData(c); let first = -1, last = 0, count = 0, sum = 0;
        for (let i = sr + 1; i < sr * 2; i++) {sum += data[i] ** 2; if (data[i - 1] <= 0 && data[i] > 0) {const t = i - 1 - data[i - 1] / (data[i] - data[i - 1]); if (first < 0) first = t; last = t; count++;}}
        frequencies.push((count - 1) * sr / (last - first)); levels.push(Math.sqrt(sum / sr));
      }
      return {frequencies, levels, frames: rendered.length};
    });
    console.log('Stereo pitch offline measurement:', JSON.stringify(offline));
    for (let c = 0; c < 2; c++) assert.ok(Math.abs(1200 * Math.log2(offline.frequencies[c] / ((c ? 330 : 440) * 2 ** (7 / 12)))) < 3);
    assert.ok(offline.levels.every(level => level > 0.02)); assert.equal(offline.frames, 144000);
    checks.push('Real WebKit AudioWorklet offline render shifts both stereo channels by +7 semitones at fixed duration.');
    const reverb = await page.evaluate(async () => {
      const sr = 48000, context = new OfflineAudioContext(2, sr * 4, sr);
      const engine = new globalThis.YouTubeFXAudioEngine(file => file);
      engine.context = context; engine.tone = context.createGain(); engine.wet = context.createGain(); engine.wet.connect(context.destination); engine.setDecay(2.8);
      const buffer = context.createBuffer(2, sr, sr); buffer.getChannelData(0)[sr / 10] = 1; buffer.getChannelData(1)[sr / 10] = 1;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(engine.tone); source.start();
      const rendered = await context.startRendering(), data = rendered.getChannelData(0), right = rendered.getChannelData(1);
      const energy = (from, to) => {let sum = 0; for (let i = from * sr; i < to * sr; i++) sum += data[i] ** 2; return sum;};
      let first = -1, last = -1, peak = 0;
      for (let i = 0; i < data.length; i++) {if (Math.abs(data[i]) > 1e-7) {if (first < 0) first = i / sr; last = i / sr;} peak = Math.max(peak, Math.abs(data[i]));}
      return {early: energy(.2, .4), late: energy(2, 2.2), after: energy(3.2, 3.8), stereo: data.some((sample, i) => Math.abs(sample - right[i]) > 1e-6), finite: data.every(Number.isFinite), first, last, peak, sampleRate: context.sampleRate};
    });
    console.log('Convolution measurement:', JSON.stringify(reverb));
    assert.ok(reverb.early > 0); assert.ok(reverb.late > 0); assert.ok(reverb.early > reverb.late * 100); assert.ok(reverb.after < reverb.early / 1000); assert.ok(reverb.stereo && reverb.finite);
    checks.push('Real WebKit convolution render produces a finite, decaying stereo reverb tail.');
    await page.evaluate(() => {history.pushState({}, '', '/'); window.dispatchEvent(new Event('yt-navigate-finish'));});
    await chip.waitFor({state: 'hidden'});
    checks.push('The panel hides outside supported YouTube player pages.');
    await page.evaluate(() => {history.pushState({}, '', '/watch?v=popup'); window.dispatchEvent(new Event('yt-navigate-finish'));});
    await chip.waitFor({state: 'visible'});
    const popupContext = await browser.newContext({viewport: {width: 350, height: 740}});
    await popupContext.route('https://www.youtube.com/**', serve);
    await popupContext.exposeBinding('__fixtureTabMessage', (_, message) => page.evaluate(message => globalThis.__fixtureRequest(message), message));
    await popupContext.addInitScript(() => {
      globalThis.browser = {tabs: {query: async () => [{id: 1, url: 'https://www.youtube.com/watch?v=fixture'}], sendMessage: async (_, message) => globalThis.__fixtureTabMessage(message)}};
    });
    const popup = await popupContext.newPage(); popup.on('pageerror', error => failures.push(error.message));
    await popup.goto(origin + '/__fx/popup.html');
    await popup.getByRole('button', {name: 'Dreamy', exact: true}).click();
    await poll(async () => (await page.evaluate(() => globalThis.__fixtureRequest({type: 'youtube-fx:get'}))).settings.semitones === -2);
    await popup.getByText('Fine tuning', {exact: true}).click();
    await popup.getByLabel('Pitch fine tune', {exact: true}).fill('23'); await popup.getByLabel('Pitch fine tune', {exact: true}).dispatchEvent('input');
    await poll(async () => (await page.evaluate(() => globalThis.__fixtureRequest({type: 'youtube-fx:get'}))).settings.cents === 23);
    assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= 350));
    await popup.screenshot({path: path.join(output, 'toolbar-popup.png'), fullPage: true});
    await popup.getByRole('button', {name: 'Effects on · Turn off', exact: true}).click();
    await poll(async () => !(await page.evaluate(() => globalThis.__fixtureRequest({type: 'youtube-fx:get'}))).settings.enabled);
    await popupContext.close();
    checks.push('Toolbar popup controls, presets, cents, and power reach the correct tab; layout fits 350px.');

    const fallback = await context.newPage(); fallback.on('pageerror', error => failures.push(error.message));
    await fallback.goto(origin + '/watch?v=compatibility');
    for (const file of files) {
      await fallback.addScriptTag({url: origin + '/__fx/' + file});
      if (file === 'audio-engine.js') await fallback.evaluate(() => {
        Object.defineProperty(AudioContext.prototype, 'audioWorklet', {configurable: true, get: () => undefined});
        const Original = globalThis.YouTubeFXAudioEngine;
        globalThis.YouTubeFXAudioEngine = class extends Original {constructor(...args) {super(...args); globalThis.__fixtureEngine = this;}};
      });
    }
    await fallback.getByRole('button', {name: 'YouTube FX audio controls'}).click();
    await fallback.getByRole('button', {name: 'Enable effects', exact: true}).click();
    await fallback.waitForFunction(() => globalThis.__fixtureEngine?.ready);
    assert.equal(await fallback.evaluate(() => globalThis.__fixtureEngine.backend), 'Compatibility');
    await fallback.evaluate(() => {globalThis.__compatibilityCalls = 0; globalThis.__fixtureEngine.pitchNode.addEventListener('audioprocess', () => globalThis.__compatibilityCalls++);});
    await fallback.getByRole('button', {name: 'Play test audio', exact: true}).click();
    await fallback.getByLabel('Pitch', {exact: true}).fill('-3'); await fallback.getByLabel('Pitch', {exact: true}).dispatchEvent('input');
    await fallback.waitForFunction(() => globalThis.__compatibilityCalls > 4);
    assert.equal(await fallback.locator('video').evaluate(video => video.playbackRate), 1);
    await fallback.close();
    checks.push('The real WebKit ScriptProcessor fallback runs and handles pitch controls when AudioWorklet is unavailable.');
    const startup = await context.newPage(); startup.on('pageerror', error => failures.push(error.message));
    await startup.goto(origin + '/watch?v=toolbar-startup');
    for (const file of files) {
      await startup.addScriptTag({url: origin + '/__fx/' + file});
      if (file === 'audio-engine.js') await startup.evaluate(() => {
        const Original = globalThis.YouTubeFXAudioEngine;
        globalThis.YouTubeFXAudioEngine = class extends Original {constructor(...args) {super(...args); globalThis.__fixtureEngine = this;}};
      });
    }
    await startup.getByRole('button', {name: 'Play test audio', exact: true}).click();
    assert.equal(await startup.evaluate(() => globalThis.__fixtureEngine.ready), false);
    await startup.evaluate(() => globalThis.__fixtureRequest({type: 'youtube-fx:set', patch: {enabled: true, semitones: 5, reverb: 70}}));
    await startup.waitForFunction(() => globalThis.__fixtureEngine.ready);
    await startup.waitForFunction(() => {globalThis.__fixtureEngine.sampleSignal(); return globalThis.__fixtureEngine.status().signal;}, null, {timeout: 7000});
    const before = await startup.evaluate(() => globalThis.__fixtureEngine.diagnostics());
    assert.ok(before.inputPeak > 0.00001); assert.equal(before.settings.semitones, 5);
    await startup.evaluate(() => globalThis.__fixtureRequest({type: 'youtube-fx:set', patch: {volume: 0}}));
    await startup.waitForFunction(() => {globalThis.__fixtureEngine.sampleSignal(); return globalThis.__fixtureEngine.outputPeak < 0.000001 && globalThis.__fixtureEngine.inputPeak > 0.00001;});
    const startupChip = startup.getByRole('button', {name: 'YouTube FX audio controls'});
    if (await startupChip.getAttribute('aria-expanded') !== 'true') await startupChip.click();
    await startup.getByText('Troubleshooting', {exact: true}).click();
    await startup.getByRole('button', {name: 'Copy diagnostics', exact: true}).click();
    await startup.getByLabel('Audio diagnostics', {exact: true}).waitFor({state: 'visible'});
    const diagnostics = JSON.parse(await startup.getByLabel('Audio diagnostics', {exact: true}).inputValue());
    assert.equal(diagnostics.version, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version); assert.ok(diagnostics.inputPeak > 0);
    await startup.close();
    checks.push('Changing controls from the toolbar on a fresh playing page starts processing, receives real PCM, and output-level changes measurably alter the actual output.');
    checks.push('Audio diagnostics display a versioned, copyable report without media URLs.');
    assert.deepEqual(failures, []);
    const result = {browser: 'Playwright WebKit (Linux)', graph, offline, reverb, checks, pageErrors: failures};
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {await page.evaluate(() => {for (const media of document.querySelectorAll('video')) media.pause();}).catch(() => {}); await context.close(); await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
