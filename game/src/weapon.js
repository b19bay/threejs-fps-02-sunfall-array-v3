// weapon.js — weapons, utilities, shooting, reload, tracers, grenade effects.
// All stats are the spec's exact numbers; the buy menu reads them from here
// so the cards can never disagree with the code.
import * as THREE from 'three';
import { applyDamage, addSound } from './sim.js';
import { rayHitWall, hasLOS } from './world.js';

// dmg / rpm / mag are the numbers the buy menu prints ("35 dmg · 600 rpm · 30 mag").
export const WEAPONS = {
  'SP-9': { name: 'SP-9', slot: 2, price: 300, dmg: 30, rpm: 380, mag: 12, reserve: 36, reload: 2.0, auto: false, spread: 0.010, range: 60, mode: 'SEMI', cls: 'pistol', note: 'Reliable sidearm, always with you.' },
  'REX .45': { name: 'REX .45', slot: 2, price: 700, dmg: 58, rpm: 150, mag: 7, reserve: 21, reload: 2.0, auto: false, spread: 0.012, range: 55, mode: 'SEMI', cls: 'pistol', note: 'One-tap headshot at close range.' },
  'WASP-9': { name: 'WASP-9', slot: 1, price: 1200, dmg: 26, rpm: 800, mag: 25, reserve: 100, reload: 2.2, auto: true, spread: 0.016, range: 45, mode: 'AUTO', cls: 'smg', note: 'Fast fire, tight spread on the move.' },
  'MAUL-12': { name: 'MAUL-12', slot: 1, price: 1100, dmg: 19, pellets: 8, rpm: 70, mag: 6, reserve: 24, reload: 0.6, auto: false, spread: 0.05, range: 22, mode: 'PUMP', cls: 'shotgun', note: 'Devastating close, useless far.' },
  'TALON AR': { name: 'TALON AR', slot: 1, price: 2700, dmg: 35, rpm: 600, mag: 30, reserve: 90, reload: 2.5, auto: true, spread: 0.011, range: 80, mode: 'AUTO', cls: 'rifle', note: 'The workhorse — learnable spray.' },
  'LONGSHOT': { name: 'LONGSHOT', slot: 1, price: 4500, dmg: 115, rpm: 41, mag: 10, reserve: 30, reload: 3.0, auto: false, spread: 0.002, range: 140, mode: 'SCOPED', cls: 'dmr', scoped: true, note: 'One-tap headshot at any range.' },
  'RASP': { name: 'RASP', slot: 3, price: 0, dmg: 40, rpm: 120, mag: 0, reserve: 0, reload: 0, auto: false, spread: 0, range: 2.4, mode: 'MELEE', cls: 'knife', note: 'Silent knife, always carried.' },
};
export const PRIMARIES = ['WASP-9', 'MAUL-12', 'TALON AR', 'LONGSHOT'];
export const SIDEARMS = ['SP-9', 'REX .45'];

export const UTILITIES = {
  frag: { name: 'Frag', price: 300, slot: 4, note: '1.2s fuse, radius damage, both teams.' },
  smoke: { name: 'Smoke', price: 300, slot: 5, note: '15s cloud that blocks sight.' },
  flash: { name: 'Flash', price: 200, slot: 6, note: 'Blinds anyone looking at it.' },
  flare: { name: 'Flare', price: 250, slot: 7, note: 'Burns 6s, blinds + lights the dark.' },
};
export const GEAR = {
  vest: { name: 'Vest', price: 650, note: 'Absorbs 50% of body damage.' },
  vestHelmet: { name: 'Vest + Helmet', price: 1000, note: 'Vest + blocks pistol/SMG one-taps.' },
  kit: { name: 'Defuse Kit', price: 400, defenceOnly: true, note: 'Defuse in 3.5s, not 7s.' },
};
// The buy menu: five columns, thirteen items, in this exact order.
export const BUY_COLUMNS = [
  { title: 'SIDEARMS', items: [{ kind: 'weapon', id: 'SP-9' }, { kind: 'weapon', id: 'REX .45' }] },
  { title: 'CLOSE RANGE', items: [{ kind: 'weapon', id: 'WASP-9' }, { kind: 'weapon', id: 'MAUL-12' }] },
  { title: 'RIFLES', items: [{ kind: 'weapon', id: 'TALON AR' }, { kind: 'weapon', id: 'LONGSHOT' }] },
  { title: 'GEAR', items: [{ kind: 'gear', id: 'vest' }, { kind: 'gear', id: 'vestHelmet' }, { kind: 'gear', id: 'kit' }] },
  { title: 'UTILITY', items: [{ kind: 'util', id: 'frag' }, { kind: 'util', id: 'smoke' }, { kind: 'util', id: 'flash' }, { kind: 'util', id: 'flare' }] },
];
export const BUY_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Q', 'W', 'E'];

export function statsLine(w) {
  if (w.name === 'MAUL-12') return `8x${w.dmg} dmg · ${w.rpm} rpm · ${w.mag} mag`;
  if (w.name === 'RASP') return `${w.dmg} dmg · melee · silent`;
  return `${w.dmg} dmg · ${w.rpm} rpm · ${w.mag} mag`;
}

export function createWeaponState() {
  const mag = {};
  const reserve = {};
  for (const name of Object.keys(WEAPONS)) {
    mag[name] = WEAPONS[name].mag;
    reserve[name] = WEAPONS[name].reserve;
  }
  return {
    current: 'SP-9',
    mag, reserve,
    reloading: null,   // { weapon, t, total, shells }
    switchT: 0,        // 0.35 s viewmodel dip on switch
    heat: 0,           // spread/recoil growth while firing
    nextShot: 0,       // sim time the next shot is allowed
    triggerHeld: false,
  };
}

export function slotOf(item) {
  if (WEAPONS[item]) return WEAPONS[item].slot;
  if (UTILITIES[item]) return UTILITIES[item].slot;
  return 0;
}

// Buy one item. Returns { ok, msg }. Money, ownership and defence rules here.
export function buyItem(game, actor, kind, id) {
  const rec = actor.rec;
  const m = game.match;
  if (kind === 'weapon') {
    const w = WEAPONS[id];
    const owned = id === rec.primary || id === rec.secondary;
    if (owned) return { ok: false, msg: 'already carried' };
    if (rec.money < w.price) return { ok: false, msg: 'Too expensive' };
    rec.money -= w.price;
    if (w.slot === 1) rec.primary = id;
    else rec.secondary = id;
    actor.weap.mag[id] = w.mag;
    actor.weap.reserve[id] = w.reserve;
    switchTo(game, actor, w.slot);
    return { ok: true, msg: `Bought ${id}` };
  }
  if (kind === 'gear') {
    const g = GEAR[id];
    if (g.defenceOnly && m.attackTeam === rec.team) return { ok: false, msg: 'DEFENCE only' };
    if (id === 'vest' && rec.hasVest) return { ok: false, msg: 'already carried' };
    if (id === 'vestHelmet' && rec.hasVest && rec.helmet) return { ok: false, msg: 'already carried' };
    if (id === 'kit' && rec.hasKit) return { ok: false, msg: 'already carried' };
    if (rec.money < g.price) return { ok: false, msg: 'Too expensive' };
    rec.money -= g.price;
    if (id === 'vest') { rec.hasVest = true; rec.armour = 100; }
    if (id === 'vestHelmet') { rec.hasVest = true; rec.helmet = true; rec.armour = 100; }
    if (id === 'kit') rec.hasKit = true;
    return { ok: true, msg: `Bought ${g.name}` };
  }
  const u = UTILITIES[id];
  if (rec.utils[id] >= 1) return { ok: false, msg: 'already carried' };
  if (rec.money < u.price) return { ok: false, msg: 'Too expensive' };
  rec.money -= u.price;
  rec.utils[id] = 1;
  return { ok: true, msg: `Bought ${u.name}` };
}

export function switchTo(game, actor, slot) {
  const rec = actor.rec;
  const w = actor.weap;
  let next = null;
  if (slot === 1 && rec.primary) next = rec.primary;
  if (slot === 2) next = rec.secondary;
  if (slot === 3) next = 'RASP';
  if (slot === 4 && rec.utils.frag > 0) next = 'frag';
  if (slot === 5 && rec.utils.smoke > 0) next = 'smoke';
  if (slot === 6 && rec.utils.flash > 0) next = 'flash';
  if (slot === 7 && rec.utils.flare > 0) next = 'flare';
  if (!next || next === w.current) return false;
  w.current = next;
  w.switchT = 0.35;
  w.reloading = null; // switching cancels a reload
  return true;
}

export function startReload(game, actor) {
  const w = actor.weap;
  const name = w.current;
  const def = WEAPONS[name];
  if (!def || name === 'RASP' || w.reloading) return false;
  if (w.mag[name] >= def.mag || w.reserve[name] <= 0) return false;
  const shells = name === 'MAUL-12' ? Math.min(def.mag - w.mag[name], w.reserve[name]) : 0;
  w.reloading = { weapon: name, t: 0, total: name === 'MAUL-12' ? 0.6 * shells : def.reload, shells };
  game.audio.reload();
  return true;
}

function updateReload(game, actor, dt) {
  const w = actor.weap;
  if (!w.reloading) return;
  const r = w.reloading;
  r.t += dt;
  const def = WEAPONS[r.weapon];
  if (r.weapon === 'MAUL-12') {
    // Shell-by-shell: one shell every 0.6 s.
    const done = Math.floor(r.t / 0.6);
    const want = Math.min(r.shells, done);
    const have = w.mag['MAUL-12'] - (def.mag - r.shells);
    if (want > have) {
      const add = want - have;
      w.mag['MAUL-12'] += add;
      w.reserve['MAUL-12'] -= add;
    }
  }
  if (r.t >= r.total) {
    if (r.weapon !== 'MAUL-12') {
      const need = def.mag - w.mag[r.weapon];
      const take = Math.min(need, w.reserve[r.weapon]);
      w.mag[r.weapon] += take;
      w.reserve[r.weapon] -= take;
    }
    w.reloading = null;
  }
}

// Ray vs one actor: head sphere (r 0.22 at +1.55) or body box (+0..1.45).
// Returns { dist, head } or null.
function rayHitActor(actor, ox, oy, oz, dx, dy, dz, maxDist) {
  const px = actor.pos.x;
  const pz = actor.pos.z;
  const py = actor.pos.y;
  // Head sphere.
  const hx = px - ox;
  const hy = py + 1.55 - oy;
  const hz = pz - oz;
  const tca = hx * dx + hy * dy + hz * dz;
  if (tca > 0 && tca < maxDist) {
    const d2 = hx * hx + hy * hy + hz * hz - tca * tca;
    if (d2 < 0.22 * 0.22) {
      const t = tca - Math.sqrt(0.22 * 0.22 - d2);
      if (t > 0) return { dist: t, head: true };
    }
  }
  // Body box, slab test.
  let tmin = 0;
  let tmax = maxDist;
  const slabs = [
    [px - 0.34, px + 0.34, ox, dx],
    [py, py + 1.45, oy, dy],
    [pz - 0.34, pz + 0.34, oz, dz],
  ];
  for (const [lo, hi, o, d] of slabs) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; }
    else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmin > 0.01) return { dist: tmin, head: false };
  return null;
}

// One hitscan shot. baseDir is the shooter's aim; spread and recoil are
// applied here. opts.spreadMul lets bots scale their own error separately.
export function fireWeapon(game, shooter, baseDir, opts) {
  const m = game.match;
  const w = shooter.weap;
  const name = w.current;
  const def = WEAPONS[name];
  if (!def || name === 'RASP') return false;
  if (w.reloading || w.switchT > 0) return false;
  if (m.time < w.nextShot) return false;
  if (w.mag[name] <= 0) {
    game.audio.dry();
    startReload(game, shooter);
    return false;
  }
  w.nextShot = m.time + 60 / def.rpm;
  w.mag[name] -= 1;
  shooter.rec.shots += 1;
  w.heat = Math.min(1, w.heat + (def.cls === 'rifle' || def.cls === 'smg' ? 0.09 : 0.16));
  const rng = m.rng;
  const spreadMul = (opts && opts.spreadMul) || 1;
  // Spread: standing still and crouching tighten it; moving, jumping and
  // sustained fire widen it. Scoped LONGSHOT is near-pinpoint.
  let spread = def.spread * spreadMul * (1 + w.heat * 1.6);
  const speed = shooter.vel ? Math.hypot(shooter.vel.x, shooter.vel.z) : 0;
  if (speed > 0.5) spread *= 1 + speed * 0.16;
  if (shooter.crouch) spread *= 0.6;
  if (!shooter.onGround) spread *= 2.2;
  if (def.scoped && shooter.scoped) spread *= 0.3;

  const eyeY = shooter.pos.y + (shooter.crouch ? 1.15 : 1.62);
  const ox = shooter.pos.x;
  const oz = shooter.pos.z;
  const pellets = def.pellets || 1;
  let anyHit = false;
  for (let p = 0; p < pellets; p++) {
    // Deterministic jitter: two uniform draws per pellet, box-ish.
    const jx = (rng() + rng() - 1) * spread;
    const jy = (rng() + rng() - 1) * spread;
    const right = new THREE.Vector3(-baseDir.z, 0, baseDir.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, baseDir).normalize();
    const dir = baseDir.clone()
      .addScaledVector(right, jx)
      .addScaledVector(up, jy)
      .normalize();
    const wallDist = rayHitWall(game.colliders, ox, eyeY, oz, dir.x, dir.y, dir.z, def.range);
    let best = null;
    let bestActor = null;
    for (const a of game.actors) {
      if (a === shooter || !a.alive) continue;
      const hit = rayHitActor(a, ox, eyeY, oz, dir.x, dir.y, dir.z, Math.min(def.range, wallDist));
      if (hit && (!best || hit.dist < best.dist)) { best = hit; bestActor = a; }
    }
    const endDist = best ? best.dist : Math.min(def.range, wallDist);
    const ex = ox + dir.x * endDist;
    const ey = eyeY + dir.y * endDist;
    const ez = oz + dir.z * endDist;
    spawnTracer(game, ox + baseDir.x * 0.5, eyeY - 0.12, oz + baseDir.z * 0.5, ex, ey, ez);
    if (best && bestActor) {
      anyHit = true;
      let dmg = def.dmg;
      // Range falloff: full damage to 40% of range, half at max range.
      const fall = Math.max(0.5, 1 - 0.5 * Math.max(0, (best.dist - def.range * 0.4) / (def.range * 0.6)));
      dmg *= fall;
      let head = best.head;
      if (head) {
        // Helmet blocks the one-tap headshot bonus from pistols and SMGs.
        if (bestActor.rec.helmet && (def.cls === 'pistol' || def.cls === 'smg')) head = false;
        else dmg *= name === 'LONGSHOT' ? 3 : 2;
      }
      const dmgInt = Math.max(1, Math.round(dmg));
      const died = applyDamage(m, bestActor.rec, dmgInt, shooter.rec, head, name);
      const prevHitter = bestActor.rec.lastHitBy;
      bestActor.rec.lastHitBy = shooter.rec;
      if (died && prevHitter && prevHitter !== shooter.rec) prevHitter.assists += 1;
      if (shooter.human) {
        game.onHitmarker(head);
        game.audio[head ? 'headshot' : 'hit']();
      }
      game.onDamageNumber(ex, ey + 0.3, ez, `${head ? 'HEAD' : 'CHEST'} ${dmgInt}`);
      if (died) {
        bestActor.alive = false; // the actor flag gates AI, minimap and LOS
        if (bestActor.mesh) bestActor.fallDead();
      }
    } else if (wallDist < def.range) {
      spawnImpact(game, ex, ey, ez);
    }
  }
  spawnMuzzle(game, shooter, baseDir);
  game.audio.shot(def.cls === 'rifle' || def.cls === 'dmr' || def.cls === 'shotgun');
  addSound(m, shooter.pos.x, shooter.pos.z, 'shot');
  // Recoil: view kick (player) + crosshair bloom, resetting when the trigger lifts.
  if (shooter.human) {
    shooter.pitch += 0.006 + w.heat * 0.004;
    shooter.yaw += (rng() - 0.5) * 0.004;
  }
  return anyHit;
}

// Knife: a short melee arc in front of the holder.
export function meleeAttack(game, attacker) {
  const m = game.match;
  const w = attacker.weap;
  if (m.time < w.nextShot || w.switchT > 0) return false;
  w.nextShot = m.time + 60 / 120;
  const dir = new THREE.Vector3(Math.sin(attacker.yaw), 0, Math.cos(attacker.yaw));
  const eyeY = attacker.pos.y + 1.4;
  for (const a of game.actors) {
    if (a === attacker || !a.alive) continue;
    const hit = rayHitActor(a, attacker.pos.x, eyeY, attacker.pos.z, dir.x, dir.y, dir.z, 2.4);
    if (hit) {
      const died = applyDamage(m, a.rec, 40, attacker.rec, false, 'RASP');
      game.onDamageNumber(a.pos.x, a.pos.y + 1.6, a.pos.z, 'KNIFE 40');
      if (died) {
        a.alive = false;
        if (a.mesh) a.fallDead();
      }
      return true;
    }
  }
  return false;
}

// ---- Effects: pooled meshes, no per-frame allocation in the hot loop ----
export function createEffects(scene) {
  const fx = {
    tracers: [], muzzle: [], impacts: [], smokes: [], flares: [], booms: [],
    projectiles: [], arcLine: null,
  };
  const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 32; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    fx.tracers.push({ mesh, t: 0, life: 0 });
  }
  const flashTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,180,1)');
    grad.addColorStop(0.4, 'rgba(255,180,80,0.8)');
    grad.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  for (let i = 0; i < 6; i++) {
    const light = new THREE.PointLight(0xffc27a, 0, 12, 1.8);
    scene.add(light);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.visible = false;
    sprite.scale.set(1.4, 1.4, 1);
    scene.add(sprite);
    fx.muzzle.push({ light, sprite, t: 0, life: 0 });
  }
  for (let i = 0; i < 10; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.visible = false;
    sprite.scale.set(0.5, 0.5, 1);
    scene.add(sprite);
    fx.impacts.push({ sprite, t: 0, life: 0 });
  }
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(25 * 3), 3));
  fx.arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8 }));
  fx.arcLine.visible = false;
  fx.arcLine.frustumCulled = false;
  scene.add(fx.arcLine);
  fx.smokeMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 1, transparent: true, opacity: 0.93, depthWrite: true });
  fx.smokeGeo = new THREE.SphereGeometry(1, 10, 8);
  fx.flareMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
  return fx;
}

const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();

function spawnTracer(game, x0, y0, z0, x1, y1, z1) {
  const fx = game.fx;
  const t = fx.tracers.find((e) => e.t <= 0) || fx.tracers[0];
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (len < 0.5) return;
  _mid.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  t.mesh.position.copy(_mid);
  _dir.set(x1 - x0, y1 - y0, z1 - z0).normalize();
  t.mesh.lookAt(x1, y1, z1);
  t.mesh.scale.set(1, 1, len);
  t.mesh.visible = true;
  t.t = 0.09;
  t.life = 0.09;
}

function spawnMuzzle(game, shooter, baseDir) {
  const fx = game.fx;
  const f = fx.muzzle.find((e) => e.t <= 0) || fx.muzzle[0];
  const eyeY = shooter.pos.y + (shooter.crouch ? 1.15 : 1.5);
  const mx = shooter.pos.x + baseDir.x * 0.7;
  const mz = shooter.pos.z + baseDir.z * 0.7;
  f.light.position.set(mx, eyeY, mz);
  f.light.intensity = 14;
  f.sprite.position.set(mx, eyeY, mz);
  f.sprite.visible = true;
  f.t = 0.06;
  f.life = 0.06;
}

function spawnImpact(game, x, y, z) {
  const fx = game.fx;
  const s = fx.impacts.find((e) => e.t <= 0) || fx.impacts[0];
  s.sprite.position.set(x, y, z);
  s.sprite.visible = true;
  s.t = 0.14;
  s.life = 0.14;
}

// ---- Utilities: thrown projectiles with gravity, bounce, and effects ----
const GRAV = 16;

export function throwUtility(game, actor, key) {
  const rec = actor.rec;
  if (rec.utils[key] <= 0) return false;
  rec.utils[key] -= 1;
  const dir = new THREE.Vector3(Math.sin(actor.yaw), 0, Math.cos(actor.yaw));
  const pitch = actor.pitch || 0;
  const fwd = new THREE.Vector3(dir.x * Math.cos(pitch), Math.sin(pitch), dir.z * Math.cos(pitch));
  const eyeY = actor.pos.y + 1.5;
  game.fx.projectiles.push({
    kind: key,
    owner: actor,
    pos: new THREE.Vector3(actor.pos.x + fwd.x * 0.5, eyeY, actor.pos.z + fwd.z * 0.5),
    vel: new THREE.Vector3(fwd.x * 15, fwd.y * 15 + 3.5, fwd.z * 15),
    fuse: key === 'frag' ? 1.2 : key === 'flash' ? 0.9 : Infinity,
    landed: false,
    t: 0,
  });
  addSound(game.match, actor.pos.x, actor.pos.z, 'throw');
  return true;
}

// Predicted arc while a utility is held: 25 points of the throw parabola.
export function updateArcPreview(game, actor) {
  const fx = game.fx;
  const cur = actor.weap.current;
  if (!UTILITIES[cur] || actor.rec.utils[cur] <= 0) {
    fx.arcLine.visible = false;
    return;
  }
  const dir = new THREE.Vector3(Math.sin(actor.yaw), 0, Math.cos(actor.yaw));
  const pitch = actor.pitch || 0;
  const p = new THREE.Vector3(actor.pos.x, actor.pos.y + 1.5, actor.pos.z);
  const v = new THREE.Vector3(dir.x * Math.cos(pitch) * 15, Math.sin(pitch) * 15 + 3.5, dir.z * Math.cos(pitch) * 15);
  const pos = fx.arcLine.geometry.attributes.position;
  const step = 1 / 24;
  for (let i = 0; i < 25; i++) {
    pos.setXYZ(i, p.x, Math.max(0.05, p.y), p.z);
    v.y -= GRAV * step;
    p.addScaledVector(v, step);
    if (p.y <= 0.05) { p.y = 0.05; }
  }
  pos.needsUpdate = true;
  fx.arcLine.visible = true;
}

function explodeFrag(game, p) {
  const m = game.match;
  const { x, y, z } = p.pos;
  game.audio.explode();
  addSound(m, x, z, 'explosion');
  // Expanding flash sphere + light.
  const boom = {
    light: new THREE.PointLight(0xffa040, 40, 20, 1.5),
    mesh: new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.9 }),
    ),
    t: 0.35, life: 0.35,
  };
  boom.light.position.set(x, y + 0.5, z);
  boom.mesh.position.set(x, y + 0.5, z);
  game.scene.add(boom.light);
  game.scene.add(boom.mesh);
  game.fx.booms.push(boom);
  for (const a of game.actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.pos.x - x, a.pos.z - z);
    if (d > 6) continue;
    if (!hasLOS(game.colliders, [], x, y + 0.5, z, a.pos.x, a.pos.y + 1, a.pos.z)) continue;
    const dmg = Math.round(120 - (100 * d) / 6);
    const died = applyDamage(m, a.rec, Math.max(20, dmg), p.owner.rec, false, 'Frag');
    if (died) {
      a.alive = false;
      if (a.mesh) a.fallDead();
    }
  }
}

export function bloomSmoke(game, p) {
  const group = new THREE.Group();
  const offsets = [[0, 1.3, 0], [1.4, 1.0, 0.6], [-1.3, 1.1, 0.8], [0.6, 1.6, -1.2], [-0.7, 0.9, -1.1], [0.2, 2.0, 0.4]];
  for (const [ox, oy, oz] of offsets) {
    const s = new THREE.Mesh(game.fx.smokeGeo, game.fx.smokeMat);
    s.position.set(p.pos.x + ox, Math.max(0.8, p.pos.y) + oy - 1, p.pos.z + oz);
    s.scale.setScalar(1.5 + ((ox * 7 + oz * 3) % 5) * 0.1 + 0.4);
    group.add(s);
  }
  game.scene.add(group);
  game.fx.smokes.push({ x: p.pos.x, y: 1.2, z: p.pos.z, r: 3.2, t: 15, group });
  addSound(game.match, p.pos.x, p.pos.z, 'smoke');
}

function popFlash(game, p) {
  const m = game.match;
  game.audio.flash();
  const { x, y, z } = p.pos;
  const flash = new THREE.PointLight(0xffffff, 60, 25, 1.5);
  flash.position.set(x, y + 0.5, z);
  game.scene.add(flash);
  game.fx.booms.push({ light: flash, mesh: null, t: 0.2, life: 0.2 });
  for (const a of game.actors) {
    if (!a.alive) continue;
    const dx = x - a.pos.x;
    const dy = y - (a.pos.y + 1.5);
    const dz = z - a.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 18) continue;
    if (!hasLOS(game.colliders, [], x, y, z, a.pos.x, a.pos.y + 1.5, a.pos.z)) continue;
    // Facing factor: fully blind when looking at the pop, none when facing away.
    const fwd = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    const facing = (fwd.x * dx + fwd.z * dz) / Math.max(0.001, dist);
    const blind = Math.max(0, 2 * (1 - dist / 18) * Math.max(0, facing + 0.3));
    if (blind <= 0.05) continue;
    if (a.human) game.flashBlind = Math.max(game.flashBlind, blind);
    else if (a.bot) a.bot.blindT = Math.max(a.bot.blindT, blind);
  }
}

export function igniteFlare(game, p) {
  const { x, y, z } = p.pos;
  const light = new THREE.PointLight(0xff7a1a, 30, 16, 1.6);
  light.position.set(x, y + 0.4, z);
  game.scene.add(light);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), game.fx.flareMat);
  core.position.set(x, y + 0.2, z);
  game.scene.add(core);
  game.fx.flares.push({ x, y: y + 0.3, z, t: 6, light, core });
  addSound(game.match, x, z, 'flare');
  // Ignition blinds anyone facing it within 12 m for up to 1.5 s.
  for (const a of game.actors) {
    if (!a.alive) continue;
    const dx = x - a.pos.x;
    const dz = z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 12) continue;
    if (!hasLOS(game.colliders, [], x, y + 0.3, z, a.pos.x, a.pos.y + 1.5, a.pos.z)) continue;
    const fwd = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    const facing = (fwd.x * dx + fwd.z * dz) / Math.max(0.001, dist);
    const blind = Math.max(0, 1.5 * (1 - dist / 12) * Math.max(0, facing));
    if (blind <= 0.05) continue;
    if (a.human) game.flareBlind = Math.max(game.flareBlind, blind);
    else if (a.bot) a.bot.blindT = Math.max(a.bot.blindT, blind);
  }
}

function updateProjectiles(game, dt) {
  const fx = game.fx;
  for (let i = fx.projectiles.length - 1; i >= 0; i--) {
    const p = fx.projectiles[i];
    p.t += dt;
    p.vel.y -= GRAV * dt;
    p.pos.addScaledVector(p.vel, dt);
    // Ground bounce.
    if (p.pos.y < 0.15) {
      p.pos.y = 0.15;
      if (Math.abs(p.vel.y) > 1.5) p.vel.y = -p.vel.y * 0.35;
      else p.vel.y = 0;
      p.vel.x *= 0.6;
      p.vel.z *= 0.6;
      p.landed = true;
    }
    // Wall stop (simple: damp on entering a low collider).
    for (const b of game.colliders) {
      if (p.pos.x > b.x0 && p.pos.x < b.x1 && p.pos.z > b.z0 && p.pos.z < b.z1 && p.pos.y < b.top) {
        p.vel.multiplyScalar(0.2);
        p.landed = true;
      }
    }
    if (p.kind === 'frag' && p.t >= p.fuse) {
      explodeFrag(game, p);
      fx.projectiles.splice(i, 1);
    } else if (p.kind === 'flash' && p.t >= p.fuse) {
      popFlash(game, p);
      fx.projectiles.splice(i, 1);
    } else if (p.kind === 'smoke' && p.landed) {
      bloomSmoke(game, p);
      fx.projectiles.splice(i, 1);
    } else if (p.kind === 'flare' && p.landed) {
      igniteFlare(game, p);
      fx.projectiles.splice(i, 1);
    } else if (p.t > 10) {
      fx.projectiles.splice(i, 1);
    }
  }
}

// Per-frame effect updates: tracers fade, smokes age out, flares flicker.
export function updateEffects(game, dt) {
  const fx = game.fx;
  for (const t of fx.tracers) {
    if (t.t > 0) {
      t.t -= dt;
      if (t.t <= 0) t.mesh.visible = false;
    }
  }
  for (const f of fx.muzzle) {
    if (f.t > 0) {
      f.t -= dt;
      f.light.intensity = Math.max(0, 14 * (f.t / f.life));
      if (f.t <= 0) { f.sprite.visible = false; f.light.intensity = 0; }
    }
  }
  for (const s of fx.impacts) {
    if (s.t > 0) {
      s.t -= dt;
      if (s.t <= 0) s.sprite.visible = false;
    }
  }
  for (let i = fx.smokes.length - 1; i >= 0; i--) {
    const s = fx.smokes[i];
    s.t -= dt;
    if (s.t <= 0) {
      game.scene.remove(s.group);
      fx.smokes.splice(i, 1);
    }
  }
  for (let i = fx.flares.length - 1; i >= 0; i--) {
    const f = fx.flares[i];
    f.t -= dt;
    // Deterministic flicker from sim time, never wall time.
    f.light.intensity = 26 + 8 * Math.sin(game.match.time * 31 + f.x);
    if (f.t <= 0) {
      game.scene.remove(f.light);
      game.scene.remove(f.core);
      fx.flares.splice(i, 1);
    }
  }
  for (let i = fx.booms.length - 1; i >= 0; i--) {
    const b = fx.booms[i];
    b.t -= dt;
    if (b.mesh) {
      const k = 1 - b.t / b.life;
      b.mesh.scale.setScalar(1 + k * 4);
      b.mesh.material.opacity = 0.9 * (b.t / b.life);
    }
    b.light.intensity = Math.max(0, b.light.intensity * (b.t / b.life));
    if (b.t <= 0) {
      game.scene.remove(b.light);
      if (b.mesh) {
        game.scene.remove(b.mesh);
        b.mesh.material.dispose();
        b.mesh.geometry.dispose();
      }
      fx.booms.splice(i, 1);
    }
  }
  updateProjectiles(game, dt);
}

export function updateWeaponActor(game, actor, dt) {
  const w = actor.weap;
  if (w.switchT > 0) w.switchT -= dt;
  if (!w.triggerHeld) w.heat = Math.max(0, w.heat - dt * 1.4);
  updateReload(game, actor, dt);
}
