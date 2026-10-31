/* The audio engine lives with YouTube's media objects in the page world.
 * Commands contain only settings, element tokens, and extension resource paths. */
(() => {
  'use strict';
  if (globalThis.__youtubeFXPageReady) return;
  globalThis.__youtubeFXPageReady = true;
  const NativeEngine = globalThis.YouTubeFXAudioEngine;
  let engine = null;
  const send = payload => document.dispatchEvent(new CustomEvent('youtube-fx:page-response', {detail: JSON.stringify(payload)}));
  const report = () => {if (engine) send({event: 'state', status: engine.status()});};
  document.addEventListener('youtube-fx:page-command', event => {
    let data; try {data = JSON.parse(event.detail);} catch {return;}
    if (!data || typeof data.id !== 'string') return;
    const reply = (result, error = '') => send({id: data.id, result, error, status: engine?.status()});
    try {
      if (!engine) {
        if (data.op !== 'hello' || typeof data.base !== 'string') {reply(null, 'Reload YouTube to load the audio engine.'); return;}
        const base = data.base;
        engine = new NativeEngine(file => base + file, report);
        engine.recovery = new globalThis.YouTubeFXStreamRecovery(engine);
      }
      switch (data.op) {
        case 'hello': reply({version: globalThis.YouTubeFXSettings.VERSION}); break;
        // Calling start() BEFORE awaiting preserves a real page gesture.
        case 'start': {const promise = engine.start(); promise.then(() => reply(true), error => reply(null, error.message)); break;}
        case 'apply': engine.apply(data.settings, Boolean(data.allowed)); reply(true); break;
        case 'attach': {
          const media = [...document.querySelectorAll('video, audio')].find(node => node.getAttribute('data-youtube-fx-target') === data.target);
          if (media) engine.attach(media); reply(Boolean(media)); break;
        }
        case 'prune': engine.prune(); reply(true); break;
        case 'reset': engine.resetPitch(); reply(true); break;
        case 'diagnostics': reply(engine.diagnostics()); break;
        default: reply(null, 'Unsupported audio operation');
      }
    } catch (error) {reply(null, error.message);}
  });
  setInterval(() => {if (engine?.ready) {engine.sampleSignal(); engine.recovery.consider(); engine.recovery.tick(); report();}}, 150);
  let resumePending = false;
  const wake = () => {
    if (!engine?.ready) return;
    engine.recovery.requestTick();
    if (!engine.settings.enabled || document.visibilityState === 'hidden' || engine.context.state === 'running' || resumePending) return;
    resumePending = true;
    // A previously unlocked context can be suspended by Safari during a page
    // lifecycle transition. Try resuming once, without repeated promise loops.
    let timeout = setTimeout(() => {resumePending = false;}, 2000);
    Promise.resolve(engine.context.resume()).catch(() => {}).finally(() => {clearTimeout(timeout); resumePending = false; engine.recovery.requestTick();});
  };
  document.addEventListener('visibilitychange', wake);
  globalThis.addEventListener('pageshow', wake);
  globalThis.addEventListener('focus', wake);
})();
