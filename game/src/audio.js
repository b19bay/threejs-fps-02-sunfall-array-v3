// audio.js — tiny synthesized WebAudio blips. No audio files, no network.
// All sounds are short oscillator/noise envelopes; M toggles mute.
export function createAudio() {
  const a = { ctx: null, muted: false, master: null };

  a.ensure = () => {
    if (a.ctx) {
      if (a.ctx.state === 'suspended') a.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      a.ctx = new AC();
      a.master = a.ctx.createGain();
      a.master.gain.value = 0.22;
      a.master.connect(a.ctx.destination);
    } catch (e) { /* audio unavailable: the game plays silent */ }
  };

  a.toggleMute = () => {
    a.muted = !a.muted;
    if (a.master) a.master.gain.value = a.muted ? 0 : 0.22;
    return a.muted;
  };

  // One envelope: oscillator with a pitch slide and an exponential decay.
  a.tone = (freq, dur, type, slideTo, vol) => {
    if (!a.ctx || a.muted) return;
    const t0 = a.ctx.currentTime;
    const o = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol || 0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(a.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  };

  // Short filtered noise burst (gunshots, explosions).
  a.noise = (dur, vol, low) => {
    if (!a.ctx || a.muted) return;
    const t0 = a.ctx.currentTime;
    const len = Math.max(1, Math.floor(a.ctx.sampleRate * dur));
    const buf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Deterministic fill (a tiny LCG): no unseeded randomness anywhere in the game.
    let s = 1234567;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1103515245) + 12345) | 0;
      d[i] = ((s >>> 8) / 8388608 - 1) * (1 - i / len);
    }
    const src = a.ctx.createBufferSource();
    src.buffer = buf;
    const f = a.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = low || 1200;
    const g = a.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.6, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(a.master);
    src.start(t0);
  };

  a.shot = (heavy) => { a.noise(heavy ? 0.22 : 0.11, heavy ? 0.8 : 0.45, heavy ? 700 : 1600); };
  a.hit = () => a.tone(1400, 0.06, 'sine', 900, 0.4);
  a.headshot = () => { a.tone(1800, 0.09, 'sine', 2400, 0.5); };
  a.reload = () => { a.tone(500, 0.07, 'square', 300, 0.25); };
  a.dry = () => a.tone(220, 0.05, 'square', 180, 0.3);
  a.buy = () => { a.tone(880, 0.08, 'sine', 1320, 0.4); };
  a.plant = () => { a.tone(660, 0.12, 'square', 660, 0.4); };
  a.beep = (fast) => a.tone(fast ? 1200 : 950, 0.09, 'square', null, 0.35);
  a.defuse = () => { a.tone(520, 0.1, 'sine', 780, 0.4); };
  a.explode = () => { a.noise(0.8, 1.0, 300); a.tone(60, 0.7, 'sine', 30, 0.8); };
  a.win = () => { a.tone(523, 0.12, 'sine', null, 0.4); setTimeout(() => a.tone(784, 0.2, 'sine', null, 0.4), 120); };
  a.lose = () => { a.tone(392, 0.15, 'sine', 300, 0.4); };
  a.flash = () => a.noise(0.15, 0.5, 3000);
  a.step = () => a.noise(0.04, 0.08, 500);
  return a;
}
