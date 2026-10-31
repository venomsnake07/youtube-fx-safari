(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome, S = globalThis.YouTubeFXSettings;
  let settings = {...S.DEFAULTS}, status = {allowed: false}, tabID = null, sending = false, pendingPatch = null;
  const ui = globalThis.YouTubeFXUI.mount(document.getElementById('app'), {
    onPatch: patch => queue({...patch, enabled: true}),
    onPower: () => {
      const running = settings.enabled && status.ready && status.state === 'running' && !status.error;
      queue({enabled: !running});
    },
    onReset: () => queue({...S.DEFAULTS, reverb: 0}),
    onDiagnostics: () => api.tabs.sendMessage(tabID, {type: 'youtube-fx:diagnostics'})
  });
  function render() { ui.update(settings, status); }
  async function queue(patch) {
    settings = S.normalize({...settings, ...patch}); render();
    pendingPatch = {...pendingPatch, ...patch};
    if (sending) return;
    sending = true;
    try {
      while (pendingPatch) {
        const next = pendingPatch; pendingPatch = null;
        const response = await api.tabs.sendMessage(tabID, {type: 'youtube-fx:set', patch: next});
        if (!response) throw new Error('No response from YouTube.');
        status = response.status;
        if (!pendingPatch) settings = S.normalize(response.settings);
        render();
      }
    } catch {
      status = {...status, error: 'Reload the YouTube tab, then open these controls again.'}; render();
    } finally { sending = false; }
  }
  async function refresh() {
    try {
      const [tab] = await api.tabs.query({active: true, currentWindow: true});
      if (!tab || !S.isYouTube(tab.url)) { status = {allowed: false}; render(); return; }
      tabID = tab.id;
      const response = await api.tabs.sendMessage(tabID, {type: 'youtube-fx:get'});
      if (!response) throw new Error('Content script unavailable.');
      if (!sending) settings = S.normalize(response.settings);
      status = response.status; render();
    } catch {
      status = {allowed: true, error: 'Allow this extension on youtube.com in Safari, then reload the YouTube tab.'}; render();
    }
  }
  render(); void refresh();
  setInterval(() => { if (!sending) void refresh(); }, 1200);
})();
