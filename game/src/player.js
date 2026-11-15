// player.js — the human player: WASD movement with acceleration, jump, crouch,
// walk-quiet, pointer-lock mouse look, and axis-aligned collision against the
// map. The player is a 0.34 m half-width capsule; the floor is groundHeight().
import * as THREE from 'three';
import { BOUNDS, groundHeight, SPAWNS } from './world.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.15;
const WALK_SPEED = 4.4;
const SPRINT_SPEED = 6.2; // Shift walks QUIET and slow in this game (see below)
const CROUCH_SPEED = 2.2;
const ACCEL = 42;
const FRICTION = 10;
const JUMP_VEL = 5.4;
const GRAVITY = 14;
const HALF = 0.34;

export function createPlayer(game, rec) {
  const spawn = SPAWNS.SUNSPIRE;
  return {
    rec,
    human: true,
    alive: true,
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(),
    yaw: spawn.yaw,
    pitch: 0,
    crouch: false,
    onGround: true,
    scoped: false,
    weap: null, // set by main.js (weapon state lives in weapon.js)
    mesh: null, // the player has no third-person body; the viewmodel is separate
    keys: {},
    bobT: 0,
    fallDead() { /* the player falls in first person: the camera drops, handled in main.js */ },
  };
}

export function respawnPlayer(game, player, team) {
  // Attackers always leave from the west spawn, defenders from the east;
  // the spawn follows the SIDE, so a swapped team spawns on the other side.
  const side = game.match.attackTeam === team ? 'SUNSPIRE' : 'BEDROCK';
  const s = SPAWNS[side];
  player.pos.set(s.x, 0, s.z);
  player.vel.set(0, 0, 0);
  player.yaw = s.yaw;
  player.pitch = 0;
  player.crouch = false;
  player.scoped = false;
  player.alive = true;
}

// Resolve an XZ move against the map's colliders. A box blocks only when the
// actor's feet are below its top (so the platform ramp lets you walk up).
export function collideMove(colliders, pos, dx, dz, feetY, half) {
  // X axis first, then Z: axis-separated resolution never sticks in corners.
  let nx = pos.x + dx;
  for (const b of colliders) {
    if (feetY >= b.top - 0.35) continue; // high enough to step over it
    if (feetY + 1.7 <= (b.bottom || 0)) continue;
    if (nx + half > b.x0 && nx - half < b.x1 && pos.z + half > b.z0 && pos.z - half < b.z1) {
      nx = dx > 0 ? b.x0 - half : b.x1 + half;
    }
  }
  let nz = pos.z + dz;
  for (const b of colliders) {
    if (feetY >= b.top - 0.35) continue;
    if (feetY + 1.7 <= (b.bottom || 0)) continue;
    if (nx + half > b.x0 && nx - half < b.x1 && nz + half > b.z0 && nz - half < b.z1) {
      nz = dz > 0 ? b.z0 - half : b.z1 + half;
    }
  }
  nx = Math.max(BOUNDS.x0 + half, Math.min(BOUNDS.x1 - half, nx));
  nz = Math.max(BOUNDS.z0 + half, Math.min(BOUNDS.z1 - half, nz));
  pos.x = nx;
  pos.z = nz;
}

export function updatePlayer(game, player, dt, input) {
  if (!player.alive) return;
  const k = input.keys;
  player.crouch = !!(k['KeyC'] || k['ControlLeft']);
  // Shift = walk: quieter footsteps, tighter spread, slower.
  const walking = !!k['ShiftLeft'] || !!k['ShiftRight'];
  let speed = player.crouch ? CROUCH_SPEED : walking ? WALK_SPEED * 0.55 : WALK_SPEED;
  if (player.scoped) speed *= 0.5;

  // Wish direction in world space from the yaw.
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let wx = 0;
  let wz = 0;
  if (k['KeyW']) { wx += sin; wz += cos; }
  if (k['KeyS']) { wx -= sin; wz -= cos; }
  if (k['KeyD']) { wx += cos; wz -= sin; }
  if (k['KeyA']) { wx -= cos; wz += sin; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  // Accelerate toward the wish velocity; friction when no key is held.
  player.vel.x += wx * ACCEL * dt;
  player.vel.z += wz * ACCEL * dt;
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  const max = speed;
  if (hSpeed > max) {
    const f = max / hSpeed;
    player.vel.x *= f;
    player.vel.z *= f;
  }
  if (wl === 0 && player.onGround) {
    const f = Math.max(0, 1 - FRICTION * dt);
    player.vel.x *= f;
    player.vel.z *= f;
  }
  // Sprint is the default pace; Shift walks. (SPRINT_SPEED caps downhill runs.)
  if (hSpeed > SPRINT_SPEED) {
    const f = SPRINT_SPEED / hSpeed;
    player.vel.x *= f;
    player.vel.z *= f;
  }

  collideMove(game.colliders, player.pos, player.vel.x * dt, player.vel.z * dt, player.pos.y, HALF);

  // Vertical: jump + gravity, floor at groundHeight().
  const floor = groundHeight(player.pos.x, player.pos.z);
  if (input.jumpPressed && player.onGround) {
    player.vel.y = JUMP_VEL;
    player.onGround = false;
  }
  player.vel.y -= GRAVITY * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= floor) {
    player.pos.y = floor;
    player.vel.y = 0;
    player.onGround = true;
  }
  // Walk bob for the viewmodel; sprinting footsteps are audible to bots.
  if (hSpeed > 1 && player.onGround) {
    player.bobT += dt * hSpeed * 1.6;
    if (!walking && Math.sin(player.bobT) > 0.98) {
      // One step sound per stride (seeded cadence, not a timer).
      game.audio.step();
    }
  }
  player.sprinting = !walking && hSpeed > 4;
}

export function eyePosition(player, out) {
  out.set(player.pos.x, player.pos.y + (player.crouch ? EYE_CROUCH : EYE_STAND), player.pos.z);
  return out;
}
