(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const S = globalThis.YouTubeFXSettings;
  if (!api?.runtime || !S.isYouTube(location.href) || globalThis.__youtubeFXLoaded) return;
  globalThis.__youtubeFXLoaded = true;
  let settings = {...S.DEFAULTS}, loading = true, busy = false, saveTimer, scanTimer;
  let panelOpen = false, currentMedia = null, ui;
  const engine = new globalThis.YouTubeFXAudioEngine(file => api.runtime.getURL(file), render);
  const host = document.createElement('div'); host.id = 'youtube-fx-controls';
  for (const [key, value] of Object.entries({position: 'fixed', right: '22px', bottom: '24px', 'z-index': '2147483647', 'font-size': '14px', 'line-height': 'normal', display: 'none'})) host.style.setProperty(key, value, 'important');
  const shadow = host.attachShadow({mode: 'open'});
  const style = document.createElement('style');
  style.textContent = `:host{all:initial}.fx-holder{display:flex;flex-direction:column;align-items:flex-end;gap:10px}.fx-panel{max-height:calc(100vh - 125px);overflow-y:auto;border-radius:20px;scrollbar-width:thin}.fx-panel[hidden]{display:none!important}.fx-chip{border:1px solid #77719f;padding:9px 14px;border-radius:25px;background:#1d1b2fef;color:#dfd7ff;box-shadow:0 3px 18px #0005;font:700 13px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;letter-spacing:.4px}.fx-chip[data-on="true"]{border-color:#afa0fa;background:#37304eee}.fx-chip:focus-visible{outline:2px solid #c8bcff;outline-offset:3px}@media(max-width:450px){.fx-holder{max-width:calc(100vw - 20px)}.fx-panel .fx-card{max-width:calc(100vw - 20px)}}`;
  shadow.append(style);
  const holder = document.createElement('div'); holder.className = 'fx-holder';
  const panel = document.createElement('div'); panel.className = 'fx-panel'; panel.hidden = true;
  const chip = document.createElement('button'); chip.className = 'fx-chip'; chip.type = 'button'; chip.textContent = 'ƒx';
  chip.setAttribute('aria-label', 'YouTube FX audio controls'); chip.setAttribute('aria-expanded', 'false');
  holder.append(panel, chip); shadow.append(holder); document.documentElement.append(host);

  function allowedPage() {
    return location.hostname === 'music.youtube.com' || /^\/(watch|shorts\/|live\/)/.test(location.pathname);
  }
  function state() { return {...engine.status(), allowed: allowedPage(), busy}; }
  function render() {
    const status = state();
    ui?.update(settings, status);
    chip.dataset.on = String(settings.enabled && status.ready && status.state === 'running' && !status.error);
    chip.textContent = status.noSignal && settings.enabled ? 'ƒx ?' : chip.dataset.on === 'true' ? 'ƒx ON' : 'ƒx';
  }
  function togglePanel(open) {
    panelOpen = open; panel.hidden = !open; chip.setAttribute('aria-expanded', String(open)); render();
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { api.storage.local.set({[S.KEY]: settings}).catch(() => {}); }, 150);
  }
  async function startAudio(gesture = false) {
    if (loading || !allowedPage()) return;
    if (busy) {
      // A real page click must still resume a context whose earlier toolbar
      // startup attempt is waiting for Safari's user-gesture permission.
      if (gesture) void engine.start().catch(() => {});
      return;
    }
    busy = true; render();
    try { await engine.start(); scan(); }
    catch (error) { console.info('[YouTube FX]', error.message); togglePanel(true); }
    finally { busy = false; render(); }
  }
  function patch(raw, gesture = false) {
    settings = S.normalize({...settings, ...raw});
    engine.apply(settings, allowedPage()); save();
    // Toolbar messages are not trusted DOM events. Still attempt startup: when
    // Safari already permits audio this works without a second page button.
    // If Safari requires a page click, start() times out BEFORE claiming media.
    if (settings.enabled && (gesture || !engine.ready || engine.context?.state !== 'running')) void startAudio(gesture);
    render();
  }
  ui = globalThis.YouTubeFXUI.mount(panel, {
    onPatch: (value, event) => patch({...value, enabled: true}, event.isTrusted),
    onPower: event => {
      const running = settings.enabled && engine.ready && engine.context?.state === 'running' && !engine.error;
      if (!running && !engine.fatal) engine.error = '';
      patch({enabled: !running}, event.isTrusted);
    },
    onReset: () => patch({...S.DEFAULTS, reverb: 0}),
    onClose: () => togglePanel(false),
    onDiagnostics: () => engine.diagnostics()
  });
  chip.addEventListener('click', () => togglePanel(!panelOpen));
  shadow.addEventListener('keydown', event => { if (event.key === 'Escape') { togglePanel(false); chip.focus(); } });

  function findMedia() {
    const all = [...document.querySelectorAll('video, audio')].filter(video => !video.closest('ytd-video-preview, ytd-moving-thumbnail-renderer'));
    const main = all.filter(video => video.matches('.html5-main-video') || video.closest('#movie_player, #shorts-player, ytmusic-player, ytm-player'));
    const choices = main.length ? main : all;
    return choices.find(video => !video.paused && !video.muted && video.volume > 0)
      || choices.find(video => !video.paused && video.getBoundingClientRect().width > 0)
      || choices.find(video => video.getBoundingClientRect().width > 0) || choices[0] || null;
  }
  function scan() {
    clearTimeout(scanTimer); scanTimer = null;
    const allowed = allowedPage();
    host.style.setProperty('display', allowed ? 'block' : 'none', 'important');
    currentMedia = allowed ? findMedia() : null;
    engine.apply(settings, allowed); engine.prune();
    if (engine.ready && settings.enabled && currentMedia) engine.attach(currentMedia);
    render();
  }
  function scheduleScan() { if (!scanTimer) scanTimer = setTimeout(scan, 400); }
  new MutationObserver(scheduleScan).observe(document.documentElement, {childList: true, subtree: true});
  for (const event of ['yt-navigate-finish', 'yt-page-data-updated', 'pageshow']) window.addEventListener(event, scheduleScan);
  for (const event of ['playing', 'loadedmetadata', 'emptied']) document.addEventListener(event, scheduleScan, true);
  // Previously saved effects start on the next real YouTube click or key press.
  for (const event of ['pointerdown', 'click', 'keydown']) document.addEventListener(event, ev => {
    if (ev.isTrusted && settings.enabled && (!engine.ready || engine.context?.state !== 'running')) void startAudio(true);
  }, true);
  document.addEventListener('fullscreenchange', () => {
    const full = document.fullscreenElement;
    const parent = full && full.tagName !== 'VIDEO' ? full : document.documentElement;
    host.style.setProperty('bottom', full ? '76px' : '24px', 'important');
    if (host.parentNode !== parent) parent.append(host);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(saveTimer); api.storage.local.set({[S.KEY]: settings}).catch(() => {}); }
  });
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message || typeof message !== 'object' || sender.id && sender.id !== api.runtime.id) return false;
    if (message.type === 'youtube-fx:get') respond({settings, status: state()});
    else if (message.type === 'youtube-fx:diagnostics') {
      Promise.resolve(engine.diagnostics()).then(respond, error => respond({error: error.message}));
      return true;
    }
    else if (message.type === 'youtube-fx:set') {
      patch(message.patch); if (settings.enabled && !engine.ready) togglePanel(true);
      respond({settings, status: state()});
    } else if (message.type === 'youtube-fx:show') {
      togglePanel(true); respond({settings, status: state()});
    } else return false;
    return false;
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[S.KEY]) return;
    settings = S.normalize(changes[S.KEY].newValue); engine.apply(settings, allowedPage()); render();
  });
  api.storage.local.get(S.KEY).then(stored => {
    settings = S.normalize(stored[S.KEY]);
  }).catch(() => {}).finally(() => { loading = false; scan(); });
  setInterval(() => {if (engine.ready) {engine.sampleSignal(); render();}}, 400);
})();
