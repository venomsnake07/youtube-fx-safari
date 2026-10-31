/* Bounded encoded audio cache. Re-appending a fragment must not multiply its
 * packets, and repeated decoder headers must not reset healthy playback. */
(() => {
  'use strict';
  const bytes = value => value instanceof ArrayBuffer ? new Uint8Array(value)
    : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array();
  function sameBytes(a, b) {
    a = bytes(a); b = bytes(b);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function sameConfig(a, b) {
    return Boolean(a && b && a.codec === b.codec && a.sampleRate === b.sampleRate
      && a.numberOfChannels === b.numberOfChannels && sameBytes(a.description, b.description));
  }
  class PacketCache {
    constructor(limitBytes = 16 * 1024 * 1024, limitPackets = 60000) {
      this.limitBytes = limitBytes; this.limitPackets = limitPackets;
      this.items = []; this.byTime = new Map(); this.bytes = 0;
      this.revision = 0; this.serial = 0; this.duplicates = 0; this.replaced = 0; this.evicted = 0; this.sortNeeded = false;
    }
    clear() {this.items = []; this.byTime.clear(); this.bytes = 0; this.sortNeeded = false; this.revision++;}
    add(packet) {
      if (!Number.isFinite(packet.timestamp) || !Number.isFinite(packet.duration) || packet.duration <= 0 || !packet.data?.length) return false;
      const existing = this.byTime.get(packet.timestamp);
      if (existing) {
        if (existing.duration === packet.duration && sameBytes(existing.data, packet.data)) {this.duplicates++; return false;}
        this.bytes += packet.data.length - existing.data.length;
        existing.data = packet.data; existing.duration = packet.duration; existing.id = ++this.serial; this.replaced++;
      } else {
        packet.id = ++this.serial;
        if (this.items.length && packet.timestamp < this.items.at(-1).timestamp) this.sortNeeded = true;
        this.items.push(packet); this.byTime.set(packet.timestamp, packet); this.bytes += packet.data.length;
      }
      this.revision++; return true;
    }
    commit(playhead = 0) {
      if (this.sortNeeded) {this.items.sort((a, b) => a.timestamp - b.timestamp); this.sortNeeded = false;}
      let first = 0, end = this.items.length;
      // Evict a batch once, without Array.shift() for every Opus packet. Protect
      // the current position even when the player appends a very large range.
      const current = Number.isFinite(playhead) ? playhead * 1e6 : 0;
      while ((this.bytes > this.limitBytes || end - first > this.limitPackets) && end - first > 1) {
        const oldest = this.items[first], newest = this.items[end - 1];
        const removeOld = oldest.timestamp < current - 60e6 || (newest.timestamp <= current + 120e6
          && current - oldest.timestamp > newest.timestamp - current);
        const packet = removeOld ? this.items[first++] : this.items[--end];
        this.byTime.delete(packet.timestamp); this.bytes -= packet.data.length; this.evicted++;
      }
      if (first || end < this.items.length) {this.items = this.items.slice(first, end); this.revision++;}
      return this.items;
    }
    covers(time, margin = 0.06) {
      const target = time * 1e6; let a = 0, b = this.items.length;
      while (a < b) {const mid = (a + b) >>> 1; if (this.items[mid].timestamp <= target) a = mid + 1; else b = mid;}
      const packet = this.items[Math.max(0, a - 1)];
      return Boolean(packet && packet.timestamp <= target + margin * 1e6 && packet.timestamp + packet.duration >= target - margin * 1e6);
    }
  }
  globalThis.YouTubeFXStreamCache = Object.freeze({sameConfig, PacketCache});
})();
