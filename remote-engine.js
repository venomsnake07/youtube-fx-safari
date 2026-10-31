/* Isolated extension-world adapter. No page code gets browser extension APIs. */
(() => {
  'use strict';
  let serial = 0;
  class RemoteEngine {
    constructor(resourceURL, onState) {
      this.resourceURL = resourceURL; this.onState = onState;
      this.cache = {ready: false, state: 'idle', backend: '', attached: false, error: '', signal: false, noSignal: false};
      this.requests = new Map();
      document.addEventListener('youtube-fx:page-response', event => {
        let data; try {data = JSON.parse(event.detail);} catch {return;}
        if (data.status) {this.cache = data.status; queueMicrotask(() => this.onState());}
        if (data.id && this.requests.has(data.id)) {
          const request = this.requests.get(data.id); this.requests.delete(data.id); clearTimeout(request.timer);
          if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
        }
      });
      void this.request('hello', {base: resourceURL('')}).catch(error => {this.cache.error = error.message; this.onState();});
    }
    request(op, args = {}) {
      return new Promise((resolve, reject) => {
        const id = 'fx-' + Date.now() + '-' + (++serial);
        const timer = setTimeout(() => {this.requests.delete(id); reject(new Error('Audio engine did not respond. Remove the old extension, add this version, then reload YouTube.'));}, 6000);
        this.requests.set(id, {resolve, reject, timer});
        document.dispatchEvent(new CustomEvent('youtube-fx:page-command', {detail: JSON.stringify({id, op, ...args})}));
      });
    }
    get ready() {return this.cache.ready;}
    get context() {return {state: this.cache.state};}
    get fatal() {return this.cache.fatal;}
    get error() {return this.cache.error;}
    set error(value) {this.cache.error = value;}
    start() {return this.request('start');}
    apply(settings, allowed = true) {void this.request('apply', {settings, allowed}).catch(error => {this.cache.error = error.message; this.onState();});}
    attach(media) {
      if (!media.getAttribute('data-youtube-fx-target')) media.setAttribute('data-youtube-fx-target', 'fx-media-' + (++serial));
      void this.request('attach', {target: media.getAttribute('data-youtube-fx-target')}).catch(error => {this.cache.error = error.message; this.onState();});
    }
    prune() {void this.request('prune').catch(() => {});}
    resetPitch() {void this.request('reset').catch(() => {});}
    sampleSignal() {}
    status() {return {...this.cache};}
    diagnostics() {return this.request('diagnostics');}
  }
  globalThis.YouTubeFXAudioEngine = RemoteEngine;
})();
