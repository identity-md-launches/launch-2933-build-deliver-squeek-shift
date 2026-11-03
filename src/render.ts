// Canvas renderer: original hamster, parallax day lab-garden and lavender dream world.
import { GROUND_Y, PLAYER, WORLD_H, WORLD_W, type EngineState, type Hazard } from './engine';

export interface SceneView {
  /** 0 day .. 1 dream */
  blend: number;
  distance: number;
  time: number;
  /** Desaturate when the scene is showing a historical or unknown state. */
  muted: boolean;
}

const C = {
  ink: '#253c30',
  ivory: '#f5f7ed',
  lime: '#d0e87b',
  daySky: '#e6f0d2',
  daySky2: '#f5f7ed',
  dreamSky: '#c9c0ea',
  dreamSky2: '#ece6fb',
  fur: '#e9a65b',
  furLight: '#fbe3c0',
  cheek: '#f4a3a0',
  spike: '#e2552b',
  spikeTip: '#f39a3a',
  coin: '#f2c230',
  coinEdge: '#b7860f',
};

export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

export function resizeCanvas(canvas: HTMLCanvasElement): number {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return w / WORLD_W;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function drawDay(ctx: CanvasRenderingContext2D, d: number, t: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, C.daySky);
  g.addColorStop(1, C.daySky2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  // sun
  ctx.fillStyle = 'rgba(208,232,123,0.55)';
  ctx.beginPath();
  ctx.arc(400, 56, 30, 0, Math.PI * 2);
  ctx.fill();
  // far: greenhouse lab panels
  const far = mod(d * 0.15, 160);
  for (let i = -1; i < 5; i++) {
    const x = i * 160 - far;
    ctx.fillStyle = '#d5e4bf';
    ctx.beginPath();
    ctx.moveTo(x + 10, 190);
    ctx.lineTo(x + 10, 120);
    ctx.quadraticCurveTo(x + 70, 78, x + 130, 120);
    ctx.lineTo(x + 130, 190);
    ctx.fill();
    ctx.strokeStyle = 'rgba(37,60,48,0.18)';
    ctx.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(x + 10 + k * 30, 190);
      ctx.lineTo(x + 10 + k * 30, 104);
      ctx.stroke();
    }
    // flask on the window sill
    ctx.fillStyle = 'rgba(208,232,123,0.9)';
    ctx.beginPath();
    ctx.moveTo(x + 60, 168);
    ctx.lineTo(x + 52, 186);
    ctx.lineTo(x + 76, 186);
    ctx.lineTo(x + 68, 168);
    ctx.fill();
  }
  // mid: hedges and sunflowers
  const mid = mod(d * 0.45, 120);
  for (let i = -1; i < 6; i++) {
    const x = i * 120 - mid;
    ctx.fillStyle = '#9cc47a';
    ctx.beginPath();
    ctx.ellipse(x + 40, GROUND_Y - 6, 52, 30, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#5f8a4c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 92, GROUND_Y);
    ctx.lineTo(x + 92, GROUND_Y - 58);
    ctx.stroke();
    ctx.fillStyle = '#f2c230';
    for (let p = 0; p < 8; p++) {
      const a = (p / 8) * Math.PI * 2 + t * 0.4;
      ctx.beginPath();
      ctx.ellipse(x + 92 + Math.cos(a) * 9, GROUND_Y - 62 + Math.sin(a) * 9, 6, 3.5, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#7a5530';
    ctx.beginPath();
    ctx.arc(x + 92, GROUND_Y - 62, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDream(ctx: CanvasRenderingContext2D, d: number, t: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, C.dreamSky);
  g.addColorStop(1, C.dreamSky2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  // stars
  for (let i = 0; i < 28; i++) {
    const x = mod(i * 97 - d * 0.05, WORLD_W);
    const y = 14 + ((i * 53) % 130);
    const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
    ctx.fillStyle = `rgba(255,255,255,${0.35 + tw * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (i % 3) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // moon
  ctx.fillStyle = '#fbf8e6';
  ctx.beginPath();
  ctx.arc(392, 60, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ddd5f5';
  ctx.beginPath();
  ctx.arc(404, 52, 24, 0, Math.PI * 2);
  ctx.fill();
  // far clouds
  const far = mod(d * 0.12, 200);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  for (let i = -1; i < 4; i++) {
    const x = i * 200 - far;
    ctx.beginPath();
    ctx.ellipse(x + 60, 150, 70, 18, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 100, 140, 40, 16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // mid: dream hills with glowing mushrooms
  const mid = mod(d * 0.4, 140);
  for (let i = -1; i < 6; i++) {
    const x = i * 140 - mid;
    ctx.fillStyle = '#a99bd8';
    ctx.beginPath();
    ctx.ellipse(x + 60, GROUND_Y, 80, 42, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#f3eefc';
    ctx.fillRect(x + 108, GROUND_Y - 22, 5, 22);
    ctx.fillStyle = '#d0e87b';
    ctx.beginPath();
    ctx.ellipse(x + 110, GROUND_Y - 22, 13, 8, 0, Math.PI, 0);
    ctx.fill();
  }
}

function drawGround(ctx: CanvasRenderingContext2D, d: number, blend: number): void {
  const off = mod(d, 32);
  ctx.fillStyle = blend > 0.5 ? '#6f5fa8' : '#5f8a4c';
  ctx.fillRect(0, GROUND_Y, WORLD_W, 8);
  ctx.fillStyle = blend > 0.5 ? '#4d4380' : C.ink;
  ctx.fillRect(0, GROUND_Y + 8, WORLD_W, WORLD_H - GROUND_Y - 8);
  ctx.fillStyle = 'rgba(245,247,237,0.12)';
  for (let x = -off; x < WORLD_W; x += 32) ctx.fillRect(x, GROUND_Y + 18, 16, 4);
}

export function drawBackground(ctx: CanvasRenderingContext2D, v: SceneView): void {
  ctx.save();
  if (v.blend < 0.999) {
    drawDay(ctx, v.distance, v.time);
  }
  if (v.blend > 0.001) {
    ctx.globalAlpha = v.blend;
    drawDream(ctx, v.distance, v.time);
    ctx.globalAlpha = 1;
  }
  drawGround(ctx, v.distance, v.blend);
  ctx.restore();
}

function drawHazard(ctx: CanvasRenderingContext2D, h: Hazard, t: number): void {
  if (h.kind === 'spikes') {
    for (let i = 0; i < h.n; i++) {
      const x = h.x + i * 18;
      ctx.fillStyle = C.spike;
      ctx.beginPath();
      ctx.moveTo(x, h.y + h.h);
      ctx.lineTo(x + 9, h.y);
      ctx.lineTo(x + 18, h.y + h.h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = C.spikeTip;
      ctx.beginPath();
      ctx.moveTo(x + 5, h.y + h.h);
      ctx.lineTo(x + 9, h.y + 5);
      ctx.lineTo(x + 11, h.y + h.h);
      ctx.fill();
    }
    ctx.fillStyle = '#9c2f17';
    ctx.fillRect(h.x - 1, h.y + h.h - 3, h.w + 2, 3);
    return;
  }
  if (h.kind === 'crate' || h.kind === 'tallcrate') {
    ctx.fillStyle = '#c98a4a';
    roundRect(ctx, h.x, h.y, h.w, h.h, 4);
    ctx.fill();
    ctx.strokeStyle = '#7a4f24';
    ctx.lineWidth = 2;
    roundRect(ctx, h.x + 1, h.y + 1, h.w - 2, h.h - 2, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(h.x + 4, h.y + 4);
    ctx.lineTo(h.x + h.w - 4, h.y + h.h - 4);
    ctx.stroke();
    // orange warning band so it reads as a hazard
    ctx.fillStyle = C.spike;
    ctx.fillRect(h.x + 2, h.y + 2, h.w - 4, 5);
    return;
  }
  if (h.kind === 'mushroom') {
    ctx.fillStyle = '#f3eefc';
    roundRect(ctx, h.x + 9, h.y + 12, 14, h.h - 12, 4);
    ctx.fill();
    ctx.fillStyle = C.spike;
    ctx.beginPath();
    ctx.ellipse(h.x + h.w / 2, h.y + 14, h.w / 2, 14, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#fff2e0';
    ctx.beginPath();
    ctx.arc(h.x + 9, h.y + 7, 3, 0, Math.PI * 2);
    ctx.arc(h.x + 21, h.y + 5, 2.5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // floater: thorny moon-bramble orb
  const cx = h.x + h.w / 2;
  const cy = h.y + h.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 1.5 + h.phase);
  ctx.fillStyle = C.spike;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - 0.25) * 8, Math.sin(a - 0.25) * 8);
    ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
    ctx.lineTo(Math.cos(a + 0.25) * 8, Math.sin(a + 0.25) * 8);
    ctx.fill();
  }
  ctx.fillStyle = '#c23d1d';
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.spikeTip;
  ctx.beginPath();
  ctx.arc(-2, -2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const sx = Math.abs(Math.cos(t * 3 + x * 0.05)) * 0.6 + 0.4;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  ctx.fillStyle = C.coinEdge;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.coin;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff3b8';
  ctx.fillRect(-1.5, -4, 3, 8);
  ctx.restore();
}

export interface HamsterPose {
  x: number;
  y: number; // feet line
  run: number; // running phase
  airborne: boolean;
  vy: number;
  squash: number; // 0..1 landing squash
  sleepy: boolean;
  blink: boolean;
}

export function drawHamster(ctx: CanvasRenderingContext2D, p: HamsterPose): void {
  if (p.blink) return;
  const w = PLAYER.w + 8;
  const h = PLAYER.h + 6;
  const sq = p.squash * 0.22;
  const stretch = p.airborne ? Math.max(-0.12, Math.min(0.12, -p.vy / 5000)) : 0;
  ctx.save();
  ctx.translate(p.x + PLAYER.w / 2, p.y);
  ctx.scale(1 + sq - stretch * 0.5, 1 - sq + stretch);
  const bob = p.airborne ? 0 : Math.abs(Math.sin(p.run * 2)) * 1.6;
  ctx.translate(0, -bob);
  // feet
  ctx.fillStyle = '#f0b3a0';
  const f = p.airborne ? 0.6 : Math.sin(p.run * 2);
  ctx.beginPath();
  ctx.ellipse(-8 + f * 4, -2, 5, 3, 0, 0, Math.PI * 2);
  ctx.ellipse(8 - f * 4, -2, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.fillStyle = C.fur;
  ctx.beginPath();
  ctx.ellipse(0, -h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // belly
  ctx.fillStyle = C.furLight;
  ctx.beginPath();
  ctx.ellipse(5, -h / 2 + 5, w / 3, h / 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // ears
  ctx.fillStyle = C.fur;
  ctx.beginPath();
  ctx.arc(-6, -h + 3, 6, 0, Math.PI * 2);
  ctx.arc(8, -h + 2, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.cheek;
  ctx.beginPath();
  ctx.arc(-6, -h + 3, 3, 0, Math.PI * 2);
  ctx.arc(8, -h + 2, 3, 0, Math.PI * 2);
  ctx.fill();
  // tail
  ctx.fillStyle = C.furLight;
  ctx.beginPath();
  ctx.arc(-w / 2 + 1, -h / 2 + 2, 3, 0, Math.PI * 2);
  ctx.fill();
  // eye
  ctx.fillStyle = C.ink;
  if (p.sleepy) {
    ctx.fillRect(9, -h / 2 - 6, 6, 2);
  } else {
    ctx.beginPath();
    ctx.arc(12, -h / 2 - 5, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(13, -h / 2 - 6, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  // nose + cheek
  ctx.fillStyle = '#d4706b';
  ctx.beginPath();
  ctx.arc(w / 2 - 1, -h / 2 - 1, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(244,163,160,0.8)';
  ctx.beginPath();
  ctx.arc(10, -h / 2 + 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawScene(ctx: CanvasRenderingContext2D, scale: number, v: SceneView, s: EngineState | null, shake: number): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawBackground(ctx, v);
  if (s) {
    for (const h of s.hazards) drawHazard(ctx, h, v.time);
    for (const c of s.coinsList) if (!c.taken && !c.missed) drawCoin(ctx, c.x, c.y, v.time);
    if (s.magnet > 0) {
      ctx.strokeStyle = 'rgba(208,232,123,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(PLAYER.x + PLAYER.w / 2, s.py - PLAYER.h / 2, 26 + Math.sin(v.time * 8) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    const blink = s.invuln > 0 && Math.floor(s.invuln * 12) % 2 === 0;
    drawHamster(ctx, {
      x: PLAYER.x,
      y: s.py,
      run: s.distance / 18,
      airborne: !s.grounded,
      vy: s.vy,
      squash: s.landTimer / 0.14,
      sleepy: false,
      blink,
    });
    if (s.hitFlash > 0) {
      ctx.fillStyle = `rgba(226,85,43,${s.hitFlash * 0.9})`;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }
  } else {
    drawHamster(ctx, { x: PLAYER.x, y: GROUND_Y, run: v.time * 4, airborne: false, vy: 0, squash: 0, sleepy: v.blend > 0.5, blink: false });
  }
  if (v.muted) {
    ctx.fillStyle = 'rgba(245,247,237,0.55)';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }
}
