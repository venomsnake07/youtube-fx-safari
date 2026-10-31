/* Measured pitch-only quality through the production audio graph in WebKit.
 * Offline context startup is shimmed; all processors, routing, filtering, and
 * peak protection are real Web Audio nodes. No native macOS Safari claim.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {webkit} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fs.existsSync(path.resolve(__dirname, '../manifest.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../extension');
const output = path.resolve(process.env.TEST_OUTPUT || path.join(__dirname, '../../test-output-1.3.0'));
async function run() {
  const browser = await webkit.launch({headless: true, ...(process.env.WEBKIT_EXECUTABLE ? {executablePath: process.env.WEBKIT_EXECUTABLE} : {})});
  const context = await browser.newContext(); const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://www.youtube.com/**', route => {
    const filename = path.basename(new URL(route.request().url()).pathname), file = path.join(root, filename);
    if (fs.existsSync(file) && filename.endsWith('.js')) return route.fulfill({contentType: 'text/javascript', body: fs.readFileSync(file)});
    return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Pitch quality</title>'});
  });
  try {
    await page.goto('https://www.youtube.com/watch?v=quality');
    for (const file of ['settings.js', 'pitch-kernel.js', 'dsp.js', 'audio-engine.js']) await page.addScriptTag({url: 'https://www.youtube.com/__fx/' + file});
    const results = [];
    for (const type of ['quadrature', 'treble', 'chord', 'impulse', 'hot']) {
      const result = await page.evaluate(async type => {
        const sr = 48000, length = sr * 4, ctx = new OfflineAudioContext(2, length, sr);
        Object.defineProperty(ctx, 'state', {get: () => 'running'});
        Object.defineProperty(ctx, 'resume', {value: () => Promise.resolve()});
        const engine = new YouTubeFXAudioEngine(file => 'https://www.youtube.com/__fx/' + file);
        engine.context = ctx;
        engine.apply({...YouTubeFXSettings.DEFAULTS, enabled: true, semitones: -1, reverb: 0});
        await engine.start();
        const buffer = ctx.createBuffer(2, length, sr), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
        const sine = (t, f, level = .25) => level * Math.sin(2 * Math.PI * t * f);
        for (let i = 0; i < length; i++) {
          const t = i / sr;
          if (type === 'quadrature') {left[i] = sine(t, 440); right[i] = .25 * Math.cos(2 * Math.PI * t * 440);}
          if (type === 'treble') {left[i] = sine(t, 14000); right[i] = sine(t, 17000);}
          if (type === 'chord') {
            let mid = 0; for (const f of [110, 138.591315, 164.813778]) for (let h = 1; h <= 16; h++) mid += sine(t, f * h, .035 / h);
            const side = sine(t, 2100, .05); left[i] = mid + side; right[i] = mid - side;
          }
          if (type === 'hot') {left[i] = sine(t, 440, 1.2); right[i] = -left[i] * .5;}
        }
        if (type === 'impulse') left[sr] = right[sr] = .8;
        const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(engine.input); source.start();
        const rendered = await ctx.startRendering(), l = rendered.getChannelData(0), r = rendered.getChannelData(1);
        let ll = 0, rr = 0, cross = 0, peak = 0, peakIndex = 0;
        for (let i = sr; i < sr * 3; i++) {
          ll += l[i] ** 2; rr += r[i] ** 2; cross += l[i] * r[i];
          if (Math.abs(l[i]) > peak) {peak = Math.abs(l[i]); peakIndex = i;}
        }
        const amplitude = (data, frequency) => {
          let real = 0, imag = 0, weight = 0;
          for (let i = 0; i < sr; i++) {
            const window = .5 - .5 * Math.cos(2 * Math.PI * i / sr), value = data[sr + i] * window;
            real += value * Math.cos(2 * Math.PI * frequency * i / sr); imag += value * Math.sin(2 * Math.PI * frequency * i / sr); weight += window;
          }
          return 2 * Math.hypot(real, imag) / weight;
        };
        const ratio = 2 ** (-1 / 12), measurements = {};
        if (type === 'quadrature') {
          const magnitude = new Float32Array(3), phase = new Float32Array(3);
          engine.wetLowCut.getFrequencyResponse(new Float32Array([40, 120, 1000]), magnitude, phase);
          measurements.reverbLowCut = [...magnitude];
        }
        if (type === 'treble') Object.assign(measurements, {left: amplitude(l, 14000 * ratio), right: amplitude(r, 17000 * ratio), leftCrosstalk: amplitude(l, 17000 * ratio), rightCrosstalk: amplitude(r, 14000 * ratio)});
        if (type === 'chord') {
          const mid = l.map((v, i) => (v + r[i]) / 2), side = l.map((v, i) => (v - r[i]) / 2);
          Object.assign(measurements, {bass: [110, 138.591315, 164.813778].map(f => amplitude(mid, f * ratio)), side: amplitude(side, 2100 * ratio), sideInCenter: amplitude(mid, 2100 * ratio), bassInSides: amplitude(side, 110 * ratio)});
        }
        if (type === 'impulse') Object.assign(measurements, {measuredLatencyMs: (peakIndex - sr) / sr * 1000, expectedLatencyMs: engine.processingLatencySeconds() * 1000});
        return {type, backend: engine.backend, info: engine.pitchInfo, correlation: cross / Math.sqrt(ll * rr), levels: [Math.sqrt(ll / (sr * 2)), Math.sqrt(rr / (sr * 2))], peak, reductionDb: engine.compressor.reduction, measurements};
      }, type);
      console.log('Quality measurement:', JSON.stringify(result));
      assert.equal(result.backend, 'AudioWorklet'); assert.equal(result.info.stereo, 'phase-linked');
      const m = result.measurements;
      if (type === 'quadrature') {assert.ok(Math.abs(result.correlation) < .003); assert.ok(result.levels.every(v => v > .17 && v < .18)); assert.ok(m.reverbLowCut[0] < .12 && m.reverbLowCut[1] > .69 && m.reverbLowCut[1] < .72 && m.reverbLowCut[2] > .99);}
      if (type === 'treble') {assert.ok(m.left > .24 && m.right > .24); assert.ok(m.leftCrosstalk < .00001 && m.rightCrosstalk < .00001);}
      if (type === 'chord') {assert.ok(m.bass.every(v => v > .032)); assert.ok(m.side > .048); assert.ok(m.sideInCenter < .0001 && m.bassInSides < .0001);}
      if (type === 'impulse') assert.ok(Math.abs(m.measuredLatencyMs - m.expectedLatencyMs) < 10);
      if (type === 'hot') {assert.ok(result.peak < 1.02); assert.ok(result.correlation < -.99999); assert.ok(Math.abs(result.levels[1] / result.levels[0] - .5) < .001);}
      results.push(result);
    }
    assert.deepEqual(errors, []); fs.mkdirSync(output, {recursive: true});
    fs.writeFileSync(path.join(output, 'quality-results.json'), JSON.stringify({browser: 'Playwright WebKit (Linux)', results, pageErrors: errors}, null, 2));
    console.log(JSON.stringify({passed: results.length, results}, null, 2));
  } finally {await context.close(); await browser.close();}
}
run().catch(error => {console.error(error); process.exitCode = 1;});
