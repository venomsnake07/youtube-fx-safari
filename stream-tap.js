/* Observe real page-world MediaSource buffers without changing native calls. */
(() => {
  'use strict';
  if (globalThis.__youtubeFXTap) return;
  const {PacketCache, sameConfig} = globalThis.YouTubeFXStreamCache;
  const sources = new WeakMap(), buffers = new WeakMap(), urls = new Map(), records = new Set();
  let serial = 0;
  const stats = {sourceBuffers: 0, packets: 0, bytes: 0, errors: 0, lastError: ''};
  const mediaFor = record => [...document.querySelectorAll('video, audio')].find(media => record.urls.has(media.currentSrc || media.src));
  function sourceRecord(source) {
    let record = sources.get(source);
    if (!record) {
      record = {id: ++serial, tracks: [], urls: new Set()}; sources.set(source, record); records.add(record);
      if (records.size > 4) for (const old of records) {
        if (old === record || mediaFor(old)) continue;
        for (const url of old.urls) urls.delete(url);
        for (const track of old.tracks) {track.discarded = true; track.cache.clear(); track.packets = []; track.parser.pending = new Uint8Array(); track.listeners.clear();}
        records.delete(old); if (records.size <= 4) break;
      }
    }
    return record;
  }
  function parserFor(track) {
    const configure = config => {
      if (sameConfig(track.config, config)) {track.configRepeats++; return;}
      if (track.config) track.cache.clear();
      track.config = config; track.generation++; track.configChanges++;
    };
    const packet = value => {
      value.timestamp += Math.round(track.offset * 1e6);
      stats.packets++; stats.bytes += value.data.length;
      if (track.cache.add(value)) track.lastAppend = ++serial;
    };
    return /webm/i.test(track.mime) ? new globalThis.YouTubeFXDemux.WebMAudio(configure, packet)
      : new globalThis.YouTubeFXDemux.MP4Audio(configure, packet);
  }
  function makeTrack(source, buffer, mime) {
    if (buffers.has(buffer) || (!/^audio\//i.test(mime) && !/codecs\s*=.*(?:mp4a|opus)/i.test(mime))) return;
    const record = sourceRecord(source), track = {mime, packets: [], cache: new PacketCache(), config: null, generation: 0,
      revision: 0, error: '', offset: 0, lastAppend: 0, configRepeats: 0, configChanges: 0, listeners: new Set(), orderedPackets: true};
    track.subscribe = callback => {track.listeners.add(callback); return () => track.listeners.delete(callback);};
    track.parser = parserFor(track); record.tracks.push(track); stats.sourceBuffers++; buffers.set(buffer, {track, record});
  }
  const createURL = URL.createObjectURL;
  URL.createObjectURL = function(object) {
    const url = Reflect.apply(createURL, this, arguments);
    if (object && typeof object.addSourceBuffer === 'function') {const record = sourceRecord(object); urls.set(url, record); record.urls.add(url);}
    return url;
  };
  const revokeURL = URL.revokeObjectURL;
  URL.revokeObjectURL = function(url) {
    const result = Reflect.apply(revokeURL, this, arguments);
    if (urls.size > 12) for (const [key, record] of urls) {
      if (key !== url && !mediaFor(record)) {urls.delete(key); record.urls.delete(key);}
      if (urls.size <= 8) break;
    }
    return result;
  };
  const patched = new Set();
  for (const Constructor of [globalThis.MediaSource, globalThis.ManagedMediaSource]) {
    if (!Constructor?.prototype || patched.has(Constructor.prototype.addSourceBuffer)) continue;
    const original = Constructor.prototype.addSourceBuffer; patched.add(original);
    Constructor.prototype.addSourceBuffer = function(mime) {
      const buffer = Reflect.apply(original, this, arguments);
      try {makeTrack(this, buffer, String(mime));} catch (error) {stats.errors++; stats.lastError = error.message;}
      return buffer;
    };
  }
  if (globalThis.SourceBuffer?.prototype) {
    const append = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function(value) {
      const result = Reflect.apply(append, this, arguments), entry = buffers.get(this);
      if (entry && !entry.track.discarded) try {
        const {track, record} = entry;
        const input = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
        track.offset = Number(this.timestampOffset) || 0; track.parser.append(input.slice());
        track.packets = track.cache.commit(mediaFor(record)?.currentTime || 0); track.revision = track.cache.revision;
        for (const callback of track.listeners) callback();
      } catch (error) {entry.track.error = error.message; stats.errors++; stats.lastError = error.message;}
      return result;
    };
    if (SourceBuffer.prototype.abort) {
      const abort = SourceBuffer.prototype.abort;
      SourceBuffer.prototype.abort = function() {
        const result = Reflect.apply(abort, this, arguments), track = buffers.get(this)?.track;
        if (track) {track.parser.pending = new Uint8Array(); if ('moof' in track.parser) track.parser.moof = null;}
        return result;
      };
    }
    if (SourceBuffer.prototype.changeType) {
      const changeType = SourceBuffer.prototype.changeType;
      SourceBuffer.prototype.changeType = function(mime) {
        const result = Reflect.apply(changeType, this, arguments), track = buffers.get(this)?.track;
        if (track) {track.mime = String(mime); track.parser = parserFor(track);}
        return result;
      };
    }
  }
  globalThis.__youtubeFXTap = Object.freeze({
    find(media, preferred = null) {
      const record = urls.get(media.currentSrc || media.src);
      if (!record) return null;
      const time = media.currentTime || 0, available = record.tracks.filter(track => !track.discarded && track.config && track.packets.length);
      // Never switch a healthy track just because another format was prefetched.
      if (preferred && available.includes(preferred) && preferred.cache.covers(time + 0.5)) return preferred;
      return available.filter(track => track.cache.covers(time)).sort((a, b) => b.lastAppend - a.lastAppend)[0]
        || (available.includes(preferred) ? preferred : available.sort((a, b) => b.lastAppend - a.lastAppend)[0]) || null;
    },
    diagnostics() {
      const tracks = [...records].slice(-4).flatMap(record => record.tracks.filter(track => !track.discarded));
      return {...stats, counters: 'received over the page lifetime', audioDecoder: typeof globalThis.AudioDecoder === 'function',
        cachedBytes: tracks.reduce((sum, track) => sum + track.cache.bytes, 0),
        tracks: tracks.map(track => ({mime: track.mime, codec: track.config?.codec || null, packets: track.packets.length,
          cachedBytes: track.cache.bytes, duplicatePackets: track.cache.duplicates, replacedPackets: track.cache.replaced,
          configRepeats: track.configRepeats, configChanges: track.configChanges, generation: track.generation, error: track.error}))};
    }
  });
})();
