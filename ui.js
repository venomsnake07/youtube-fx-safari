(() => {
  'use strict';
  const {DEFAULTS, PRESETS, VERSION, naturalPitch} = globalThis.YouTubeFXSettings;
  const CSS = `
    :host{all:initial;color-scheme:dark} *{box-sizing:border-box}
    .fx-card{width:350px;padding:22px;background:#171a22;color:#f1f3f8;border:1px solid #343947;border-radius:20px;box-shadow:0 18px 65px #0008;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0;text-align:left;color-scheme:dark}
    .fx-top{display:flex;align-items:center;gap:11px;margin-bottom:17px}
    .fx-logo{width:39px;height:39px;display:grid;place-items:center;border-radius:13px;background:linear-gradient(145deg,#ae9dff,#6f67e7);color:#171329;font-size:22px;font-style:italic;font-weight:800}
    .fx-title{font-size:19px;font-weight:700;line-height:1.2;letter-spacing:-.5px}.fx-subtitle{font-size:11px;color:#9ba4b9;margin-top:3px}
    button,a,input{font:inherit} button{cursor:pointer} button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #b7acff;outline-offset:4px}
    .fx-close{margin-left:auto;border:0;background:transparent;color:#afb8cd;font-size:24px;line-height:1;padding:4px 6px;border-radius:6px}
    .fx-power{width:100%;padding:11px 12px;border:1px solid #8377d0;border-radius:11px;background:#a99aef;color:#1c1731;font-weight:700;font-size:13px;transition:background .15s}
    .fx-power[data-on="true"]{background:#282c39;border-color:#495064;color:#e4e7f4}
    .fx-status{font-size:11px;color:#aeb7ca;min-height:32px;padding-top:9px;line-height:1.45;overflow-wrap:anywhere}
    .fx-status[data-error="true"]{color:#ffb9a8}
    .fx-meter{display:block;width:100%;height:5px;margin:2px 0 0;accent-color:#b6a6ff;border:0;border-radius:3px;overflow:hidden}
    .fx-meter::-webkit-meter-bar{background:#303646;border:0}.fx-meter::-webkit-meter-optimum-value{background:#b6a6ff}
    .fx-diagnostics{display:block;width:100%;margin-top:10px;min-height:135px;background:#10131c;border:1px solid #414a60;border-radius:8px;padding:9px;color:#d2d9e9;font:10px/1.4 ui-monospace,monospace;resize:vertical}
    .fx-diagnostics[hidden]{display:none}.fx-diagnostic-button{margin-top:10px;padding:7px 10px;border:1px solid #505970;border-radius:7px;background:#232733;color:#d3daec;font-size:11px}
    .fx-section{padding-top:15px}.fx-label{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:7px;gap:8px}
    .fx-value{font-variant-numeric:tabular-nums;color:#c5bbff;font-size:13px;font-weight:650;white-space:nowrap}
    [hidden]{display:none!important}
    .fx-adjust{display:flex;align-items:center;gap:10px}.fx-adjust input[type=range]{flex:1;min-width:0}
    .fx-step{flex:0 0 30px;height:30px;padding:0;display:grid;place-items:center;border:1px solid #42495f;border-radius:9px;background:#252a38;color:#e2dcff;font-size:20px;line-height:1;transition:background .15s}
    .fx-step:hover{background:#38334d;border-color:#8675bc}.fx-step:active{background:#514270}.fx-step:disabled{opacity:.3;cursor:default}
    .fx-link{display:flex;align-items:center;gap:9px;width:100%;margin-top:12px;padding:10px 11px;border:1px solid #55476c;border-radius:11px;background:linear-gradient(120deg,#30263f,#242536);color:#e3dcff;text-align:left}
    .fx-link[aria-pressed="false"]{border-color:#3a4354;background:#202531;color:#c5cfdf}
    .fx-link-icon{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:#b7a7ed20;font-size:19px}
    .fx-link-copy{flex:1}.fx-link-title{display:block;font-size:11px;font-weight:650}.fx-link-detail{display:block;margin-top:2px;font-size:10px;color:#a39bb8;font-variant-numeric:tabular-nums}
    .fx-link-action{padding:3px 7px;background:#b7a7ed15;border-radius:5px;font-size:10px;color:#cbbcf3}
    input[type=range]{display:block;width:100%;margin:0;height:25px;accent-color:#b6a6ff;cursor:pointer;background:transparent}
    .fx-scale{display:flex;justify-content:space-between;font-size:10px;color:#7f8aa2;margin-top:2px}
    .fx-presets{display:flex;gap:6px;padding:17px 0 0}.fx-preset{flex:1;padding:8px 4px;background:#232733;border:1px solid #383f50;color:#d0d7e7;border-radius:8px;font-size:10px;white-space:nowrap}
    .fx-preset:hover,.fx-reset:hover{background:#32374a;color:white}
    .fx-preset[aria-pressed="true"]{background:#37304d;border-color:#8a79ce;color:#ded5ff}
    details{border-top:1px solid #313645;margin-top:18px;padding-top:12px}
    summary{cursor:pointer;font-size:11px;color:#aab5ca;list-style:none;user-select:none}summary::after{content:'+';float:right;font-size:15px;line-height:1}details[open] summary::after{content:'−'}
    .fx-note{font-size:10px;color:#8d99b1;line-height:1.5;margin:10px 0 0}
    .fx-footer{display:flex;align-items:center;justify-content:space-between;margin-top:16px;gap:10px}.fx-private{font-size:9px;color:#7e8aa3}
    .fx-reset{padding:5px 9px;border:1px solid #3a4154;background:transparent;color:#b3bdd0;border-radius:7px;font-size:10px}
    .fx-open{display:block;color:#c5bbff;font-size:12px;text-align:center;margin-top:11px;text-decoration:none}.fx-open[hidden]{display:none}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  `;
  function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text) node.textContent = text;
    return node;
  }
  function mount(root, actions = {}) {
    const style = el('style'); style.textContent = CSS; root.append(style);
    const card = el('section', {class: 'fx-card', 'aria-label': 'YouTube audio effects'}); root.append(card);
    const top = el('div', {class: 'fx-top'}), brand = el('div');
    top.append(el('div', {class: 'fx-logo', 'aria-hidden': true}, 'ƒx'));
    brand.append(el('div', {class: 'fx-title'}, 'YouTube FX'), el('div', {class: 'fx-subtitle'}, 'Rate, pitch & reverb · v' + VERSION));
    top.append(brand); card.append(top);
    if (actions.onClose) {
      const close = el('button', {class: 'fx-close', 'aria-label': 'Close audio controls', type: 'button'}, '×');
      close.addEventListener('click', () => actions.onClose()); top.append(close);
    }
    const power = el('button', {class: 'fx-power', type: 'button'}, 'Enable audio');
    power.addEventListener('click', event => actions.onPower?.(event));
    const statusText = el('div', {class: 'fx-status', role: 'status', 'aria-live': 'polite'});
    const meter = el('meter', {class: 'fx-meter', min: 0, max: 1, value: 0, 'aria-label': 'Audio reaching effects', title: 'Audio reaching effects'});
    card.append(power, statusText, meter);
    const controls = {}; let currentSettings = {...DEFAULTS};
    function slider(parent, key, label, min, max, step, ends, format) {
      const section = el('div', {class: 'fx-section'}), line = el('div', {class: 'fx-label'});
      const id = 'youtube-fx-' + key;
      const value = el('output', {class: 'fx-value', for: id});
      const labelNode = el('label', {for: id}, label); line.append(labelNode, value);
      const input = el('input', {id, type: 'range', min, max, step, 'aria-label': label});
      const adjust = el('div', {class: 'fx-adjust'});
      const minus = el('button', {class: 'fx-step', type: 'button', 'aria-label': 'Decrease ' + label.toLowerCase()}, '−');
      const plus = el('button', {class: 'fx-step', type: 'button', 'aria-label': 'Increase ' + label.toLowerCase()}, '+');
      const change = event => {
        value.textContent = format(Number(input.value));
        actions.onPatch?.({[key]: Number(input.value)}, event);
      };
      input.addEventListener('input', change);
      minus.addEventListener('click', event => {input.stepDown(); change(event);});
      plus.addEventListener('click', event => {input.stepUp(); change(event);});
      input.addEventListener('dblclick', event => actions.onPatch?.({[key]: DEFAULTS[key]}, event));
      adjust.append(minus, input, plus); section.append(line, adjust);
      let scale;
      if (ends) { scale = el('div', {class: 'fx-scale', 'aria-hidden': true}); scale.append(el('span', {}, ends[0]), el('span', {}, ends[1])); section.append(scale); }
      parent.append(section); controls[key] = {input, value, format, section, label: labelNode, minus, plus, scale};
    }
    slider(card, 'rate', 'Sample rate', 50, 200, 1, ['Slower · lower', 'Faster · higher'], n => n + '%');
    const link = el('button', {class: 'fx-link', type: 'button', 'aria-pressed': true});
    const linkIcon = el('span', {class: 'fx-link-icon', 'aria-hidden': true});
    const linkCopy = el('span', {class: 'fx-link-copy'}), linkTitle = el('span', {class: 'fx-link-title'}), linkDetail = el('span', {class: 'fx-link-detail'}), linkAction = el('span', {class: 'fx-link-action'});
    linkCopy.append(linkTitle, linkDetail); link.append(linkIcon, linkCopy, linkAction); card.append(link);
    link.addEventListener('click', event => {
      const linked = !currentSettings.linked, patch = {linked};
      // Unlock at the audible pitch so the toggle itself does not change key.
      if (!linked) {
        const pitch = naturalPitch(currentSettings.rate), semitones = Math.round(pitch);
        Object.assign(patch, {semitones, cents: Math.round((pitch - semitones) * 100)});
      }
      actions.onPatch?.(patch, event);
    });
    slider(card, 'semitones', 'Pitch', -12, 12, 1, ['One octave down', 'One octave up'], n => {
      const total = Math.round((n + currentSettings.cents / 100) * 100) / 100;
      return total === 0 ? 'Original key' : (total > 0 ? '+' : '−') + Math.abs(total) + (Math.abs(total) === 1 ? ' semitone' : ' semitones');
    });
    slider(card, 'reverb', 'Reverb', 0, 100, 1, ['Dry', 'Spacious'], n => n + '%');
    const presets = el('div', {class: 'fx-presets', role: 'group', 'aria-label': 'Audio presets'}), presetButtons = [];
    for (const [name, patch] of Object.entries(PRESETS)) {
      const button = el('button', {class: 'fx-preset', type: 'button', 'aria-pressed': false}, name);
      button.addEventListener('click', event => actions.onPatch?.({...patch, enabled: true}, event));
      presets.append(button); presetButtons.push({button, patch});
    }
    card.append(presets);
    const more = el('details'), summary = el('summary', {}, 'Fine tuning'); more.append(summary);
    slider(more, 'cents', 'Pitch fine tune', -50, 50, 1, null, n => (n > 0 ? '+' : '') + n + ' cents');
    slider(more, 'decay', 'Reverb tail', 0.4, 6, 0.1, null, n => n.toFixed(1) + ' seconds');
    slider(more, 'volume', 'Output level', 0, 100, 1, null, n => n + '%');
    more.append(el('p', {class: 'fx-note'}, 'Linked: rate changes speed and pitch together, like a record. Unlink to set speed and musical key separately. Processing preserves stereo and adds no lossy encoding.'));
    card.append(more);
    if (actions.onDiagnostics) {
      const troubleshooting = el('details'); troubleshooting.append(el('summary', {}, 'Troubleshooting'));
      troubleshooting.append(el('p', {class: 'fx-note'}, 'If sound does not change, keep a video playing and copy this report. It includes audio state and settings, without video URLs.'));
      const copy = el('button', {class: 'fx-diagnostic-button', type: 'button'}, 'Copy diagnostics');
      const report = el('textarea', {class: 'fx-diagnostics', readonly: true, hidden: true, 'aria-label': 'Audio diagnostics'});
      const hint = el('p', {class: 'fx-note', role: 'status'});
      copy.addEventListener('click', async () => {
        try {
          const result = actions.onDiagnostics();
          const data = result && typeof result.then === 'function' ? await result : result;
          report.value = JSON.stringify(data, null, 2); report.hidden = false;
          if (globalThis.navigator?.clipboard?.writeText) {
            try {await globalThis.navigator.clipboard.writeText(report.value); hint.textContent = 'Copied. Paste the report into the chat.'; return;}
            catch { /* Safari can require a manual copy after async messages. */ }
          }
          report.focus(); report.select();
          if (document.execCommand?.('copy')) hint.textContent = 'Copied. Paste the report into the chat.';
          else hint.textContent = 'Press ⌘C to copy the selected report, then paste it into the chat.';
        } catch {hint.textContent = 'Reload YouTube, then try copying the report again.';}
      });
      troubleshooting.append(copy, report, hint); card.append(troubleshooting);
    }
    const footer = el('div', {class: 'fx-footer'}), reset = el('button', {class: 'fx-reset', type: 'button'}, 'Reset');
    reset.addEventListener('click', event => actions.onReset?.(event));
    footer.append(el('span', {class: 'fx-private'}, 'YOUTUBE ONLY · PROCESSED ON YOUR MAC'), reset); card.append(footer);
    const open = el('a', {class: 'fx-open', href: 'https://www.youtube.com/', target: '_blank', rel: 'noopener noreferrer', hidden: true}, 'Open YouTube'); card.append(open);
    function update(settings, state = {}) {
      currentSettings = {...settings};
      for (const [key, control] of Object.entries(controls)) {
        control.input.value = settings[key];
        control.value.textContent = control.format(settings[key]);
        control.input.disabled = state.allowed === false;
        control.input.setAttribute('aria-valuetext', control.format(settings[key]));
        control.minus.disabled = state.allowed === false || settings[key] <= Number(control.input.min);
        control.plus.disabled = state.allowed === false || settings[key] >= Number(control.input.max);
      }
      controls.rate.label.textContent = settings.linked ? 'Sample rate' : 'Speed';
      controls.rate.input.setAttribute('aria-label', settings.linked ? 'Sample rate' : 'Speed');
      controls.rate.minus.setAttribute('aria-label', 'Decrease ' + (settings.linked ? 'sample rate' : 'speed'));
      controls.rate.plus.setAttribute('aria-label', 'Increase ' + (settings.linked ? 'sample rate' : 'speed'));
      controls.rate.scale.firstChild.textContent = settings.linked ? 'Slower · lower' : 'Slower';
      controls.rate.scale.lastChild.textContent = settings.linked ? 'Faster · higher' : 'Faster';
      controls.semitones.section.hidden = settings.linked; controls.cents.section.hidden = settings.linked;
      link.setAttribute('aria-pressed', String(settings.linked));
      link.setAttribute('aria-label', settings.linked ? 'Unlink speed and pitch' : 'Link speed and pitch');
      link.disabled = state.allowed === false; linkIcon.textContent = settings.linked ? '∞' : '↔';
      linkTitle.textContent = settings.linked ? 'Speed & pitch linked' : 'Independent speed & pitch';
      const audible = settings.linked ? naturalPitch(settings.rate) : settings.semitones + settings.cents / 100;
      linkDetail.textContent = settings.rate + '% speed · ' + (audible > 0 ? '+' : '') + audible.toFixed(2) + ' semitones';
      linkAction.textContent = settings.linked ? 'Unlink' : 'Link';
      for (const {button, patch} of presetButtons) {
        button.setAttribute('aria-pressed', String(Object.entries(patch).every(([key, value]) => settings[key] === value)));
        button.disabled = state.allowed === false;
      }
      const running = settings.enabled && state.ready && state.state === 'running' && !state.error;
      power.textContent = state.allowed === false ? 'Open a YouTube video' : state.busy ? 'Starting audio…' : !settings.enabled ? 'Enable effects' : running ? 'Effects on · Turn off' : 'Enable audio on YouTube';
      power.dataset.on = String(running); power.setAttribute('aria-pressed', String(running));
      power.disabled = state.busy || state.allowed === false;
      open.hidden = state.allowed !== false;
      meter.value = Math.min(1, Math.sqrt(Math.max(0, state.inputPeak || 0)));
      statusText.dataset.error = String(Boolean(state.error) || Boolean(state.noSignal));
      statusText.textContent = state.error || (state.allowed === false ? 'These controls work only on YouTube and YouTube Music.'
        : state.busy ? 'Preparing your audio…'
        : !settings.enabled ? 'Original sound. Turn on to add your effects.'
        : !state.ready || state.state !== 'running' ? 'Click Enable audio in the panel on the YouTube page.'
        : !state.attached ? 'Ready. Start a YouTube video.'
        : state.recoveryPhase === 'buffering' ? 'Waiting for the YouTube player…'
        : state.recoveryPhase === 'interrupted' ? 'Safari interrupted audio. Resume playback to continue.'
        : state.recoveryPhase === 'decoding' && !state.signal ? 'Preparing buffered audio…'
        : state.noSignal ? state.recoveryMessage || 'No audio reaching effects. Open Troubleshooting below.'
        : !state.signal ? 'Waiting for audio from the YouTube player…'
        : state.route === 'buffered-stream' ? 'Audio detected · Safari stream recovery.'
        : state.backend === 'Compatibility' ? 'Audio detected · compatibility audio mode.'
        : settings.linked ? 'Audio detected · speed & pitch linked.' : 'Audio detected · independent speed & pitch.');
    }
    return {update, power, card, statusText};
  }
  globalThis.YouTubeFXUI = Object.freeze({mount});
})();
