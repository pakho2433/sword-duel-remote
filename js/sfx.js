let ctx = null;
export function unlockAudio() { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return; ctx = new C(); } if (ctx.state === 'suspended') ctx.resume(); }
function env(g, t, a, d, v = 0.5) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(f, d, type = 'sine', v = 0.3, at = 0, slide = 0) { if (!ctx) return; const t = ctx.currentTime + at; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d); env(g, t, 0.005, d, v); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + 0.05); }
function noise(d, f0, f1, v = 0.4, q = 1) { if (!ctx) return; const t = ctx.currentTime; const n = ctx.createBuffer(1, ctx.sampleRate * d, ctx.sampleRate); const a = n.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; const s = ctx.createBufferSource(); s.buffer = n; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + d); const g = ctx.createGain(); env(g, t, d * 0.3, d * 0.7, v); s.connect(bp).connect(g).connect(ctx.destination); s.start(t); }
export const sfx = {
  whoosh: () => noise(0.35, 400, 3000, 0.6, 2),
  clang: () => { [880, 1320, 1975, 2637].forEach((f, i) => tone(f, 0.6 - i * 0.1, 'triangle', 0.18)); noise(0.12, 3000, 6000, 0.4); },
  bonk: () => { tone(300, 0.25, 'sine', 0.5, 0, 90); tone(1200, 0.4, 'sine', 0.12, 0.08, 1800); },
  tick: () => tone(660, 0.1, 'square', 0.12),
  ding: () => { tone(988, 0.2, 'sine', 0.3); tone(1319, 0.3, 'sine', 0.3, 0.1); },
  gong: () => { tone(110, 1.5, 'sine', 0.5); tone(220, 1.2, 'triangle', 0.15); },
  fanfare: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i === 5 ? 0.6 : 0.18, 'square', 0.12, i * 0.15)),
};
