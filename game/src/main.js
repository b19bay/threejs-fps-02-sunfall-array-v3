// main.js — SUNFALL ARRAY: a golden-hour 5v5 tactical FPS on three.js.
//
// GAME OVERVIEW
//   A Counter-Strike-STYLE round-based shooter on one original map: a desert
//   solar farm with three lanes (A-LONG, MID, B-LINK) and two device sites.
//   You + 4 bot teammates vs 5 bot enemies, 12 rounds max, first to 7, sides
//   swap after round 6. Round timer 100 s, buy phase 12 s.
//   Systems: hitscan gunplay with spread / recoil / headshots (2x, 3x DMR),
//   6 weapons + knife + 4 utilities (frag, smoke that blocks sight, flash,
//   flare that blinds and lights) + gear, CS-style economy ($800 start, $300
//   per kill, $3,250 round win, $1,400 loss, $16,000 cap), plant (3 s) and
//   defuse (7 s, 3.5 s with kit) of a 40 s device, bots with roles, waypoint
//   routes, holds, peeks, hearing and radio callouts, and a full HUD with a
//   live minimap, kill feed, segmented alive pips and a scoreboard.
//   Controls: WASD move, mouse look (click to lock), Shift walk, Space jump,
//   C/Ctrl crouch, R reload, 1-7 weapons/utilities, B buy, E plant/defuse,
//   Tab scoreboard, M mute, right mouse to scope the LONGSHOT.
//   Determinism: fixed 1/60 s steps, a seeded RNG from ?seed=, no wall clock
//   in game state. ?shot=combat|buy|objective|score stages a deterministic
//   scene with the game's own systems and sets window.__shotReady.
import * as THREE from 'three';
import { createMatch, startRound, stepMatch, endRound, addKillfeed, addRadio, addSound, playerById, aliveOf, SUN, BED, PLANT_TIME, DEFUSE_TIME, DEFUSE_KIT_TIME, DEVICE_TIME } from './sim.js';
import { buildWorld, SITES, SITE_RADIUS, SPAWNS, groundHeight, zoneAt, hasLOS } from './world.js';
import { createPlayer, respawnPlayer, updatePlayer, eyePosition } from './player.js';
import { WEAPONS, UTILITIES, createWeaponState, fireWeapon, meleeAttack, startReload, switchTo, throwUtility, updateEffects, updateWeaponActor, updateArcPreview, createEffects, bloomSmoke, buyItem, BUY_COLUMNS, BUY_HOTKEYS } from './weapon.js';
import { createBot, createBotMesh, respawnBot, updateBot, syncBotMesh } from './bots.js';
import { createHUD } from './hud.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(window.location.search);
const SEED = parseInt(params.get('seed') || '1', 10) || 1;
const SHOT = params.get('shot'); // combat | buy | objective | score | null
const FIXED_DT = 1 / 60;

// ---- Renderer / scene / camera ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.domElement.className = 'webgl';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene);

// ---- Game context: the one place state lives ----
const game = {
  scene, camera, renderer,
  match: createMatch(SEED),
  colliders: world.colliders,
  audio: createAudio(),
  fx: null, // created below (needs the scene)
  actors: [],
  player: null,
  hud: null,
  shotMode: !!SHOT,
  paused: false,
  flashBlind: 0,
  flareBlind: 0,
  framesAfterStage: 0,
  shotReady: false,
  deviceMesh: null,
  viewmodel: null,
  lastStepSound: 0,
  lastBeep: 0,
  prevPhase: 'buy',
  prevDeviceState: 'carried',
  restarts: 0,
};
game.fx = createEffects(scene);
window.__game = game; // debug / play-test handle

// ---- Device prop: a box + cylinders with a blinking light ----
{
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.4), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 }));
  body.position.y = 0.15;
  body.castShadow = true;
  g.add(body);
  const cylMat = new THREE.MeshStandardMaterial({ color: 0xc96a2e, roughness: 0.5, metalness: 0.4 });
  for (const dx of [-0.16, 0.16]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), cylMat);
    c.position.set(dx, 0.42, 0);
    c.castShadow = true;
    g.add(c);
  }
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3020 }),
  );
  lamp.position.set(0, 0.36, 0);
  lamp.name = 'lamp';
  g.add(lamp);
  g.visible = false;
  scene.add(g);
  game.deviceMesh = g;
}

// ---- Viewmodel: a rifle with distinct parts + two tan hands ----
function buildViewmodel() {
  const vm = new THREE.Group();
  // Distinct tones per part so the gun reads as a rifle, not a black blob:
  // dark barrel, mid-tone receiver, light magazine, tan stock, tan hands.
  const dark = new THREE.MeshStandardMaterial({ color: 0x3d3d3d, roughness: 0.5, metalness: 0.5 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x6e6e6e, roughness: 0.55, metalness: 0.4 });
  const light = new THREE.MeshStandardMaterial({ color: 0xb5b5b5, roughness: 0.5, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a077, roughness: 0.8 });
  const gun = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.4), mid);
  gun.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.33);
  gun.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), light);
  mag.position.set(0, -0.12, -0.05);
  mag.rotation.x = 0.25;
  gun.add(mag);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.18), wood);
  stock.position.set(0, -0.01, 0.28);
  gun.add(stock);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.07), dark);
  grip.position.set(0, -0.11, 0.12);
  grip.rotation.x = 0.35;
  gun.add(grip);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), dark);
  sight.position.set(0, 0.08, -0.08);
  gun.add(sight);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10), dark);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.1, -0.05);
  scope.visible = false;
  scope.name = 'scope';
  gun.add(scope);
  // Hands: right on the grip, left on the forend — big enough to see.
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.11), skin);
  handR.position.set(0.01, -0.11, 0.12);
  gun.add(handR);
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.13), skin);
  handL.position.set(-0.01, -0.07, -0.28);
  gun.add(handL);
  gun.scale.setScalar(1.15);
  vm.add(gun);
  // Knife: blade + handle, shown when RASP is out.
  const knife = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.3), light);
  blade.position.set(0, 0, -0.2);
  knife.add(blade);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.12), dark);
  knife.add(handle);
  const handK = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.1), skin);
  handK.position.set(0, -0.02, 0.02);
  knife.add(handK);
  knife.visible = false;
  vm.add(knife);
  // Utility: a small canister in hand.
  const util = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0x4a6b2a, roughness: 0.6 }));
  util.add(can);
  const handU = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.1), skin);
  handU.position.set(0, -0.02, 0.03);
  util.add(handU);
  util.visible = false;
  vm.add(util);
  vm.position.set(0.24, -0.24, -0.45);
  vm.rotation.y = 0.06;
  camera.add(vm);
  // A small warm fill light riding with the camera: the viewmodel and hands
  // stay readable against sand and sky alike, whatever the sun does.
  const fill = new THREE.PointLight(0xfff2dd, 2.2, 2.5, 1.2);
  fill.position.set(0.1, 0.25, 0.3);
  camera.add(fill);
  return { group: vm, gun, knife, util, scope, baseY: -0.24 };
}
game.viewmodel = buildViewmodel();

function updateViewmodelShape() {
  const vm = game.viewmodel;
  const cur = game.player.weap.current;
  const isGun = !!WEAPONS[cur];
  vm.gun.visible = isGun;
  vm.knife.visible = cur === 'RASP';
  vm.util.visible = !!UTILITIES[cur];
  vm.scope.visible = cur === 'LONGSHOT';
  const s = cur === 'SP-9' || cur === 'REX .45' ? 0.72 : cur === 'LONGSHOT' ? 1.18 : cur === 'MAUL-12' ? 1.05 : 1;
  vm.gun.scale.setScalar(s);
}

// ---- Actors: the player + nine bots ----
function buildActors() {
  const m = game.match;
  game.actors = [];
  const you = playerById(m, 'you');
  const player = createPlayer(game, you);
  player.weap = createWeaponState();
  game.player = player;
  game.actors.push(player);
  for (const rec of m.players) {
    if (rec.human) continue;
    const showTag = rec.team === you.team; // name tags for teammates only
    const mesh = createBotMesh(scene, rec.team, rec.name, showTag);
    const bot = createBot(game, rec, mesh);
    bot.weap = createWeaponState();
    game.actors.push(bot);
  }
}
buildActors();

game.hud = createHUD(game);

// HUD callbacks from the weapon module.
game.onHitmarker = (head) => game.hud.hitmarker(head);
game.onDamageNumber = (x, y, z, text) => game.hud.damageNumber(x, y, z, text);

function respawnAll() {
  const m = game.match;
  for (const a of game.actors) {
    if (a.human) {
      respawnPlayer(game, a, a.rec.team);
      a.weap.switchT = 0;
      a.weap.reloading = null;
      a.weap.heat = 0;
    } else {
      respawnBot(game, a);
      a.weap.switchT = 0;
      a.weap.reloading = null;
      a.weap.heat = 0;
    }
    a.alive = true;
  }
  game.deviceMesh.visible = false;
  game.flashBlind = 0;
  game.flareBlind = 0;
}

function restartMatch() {
  const seed = SEED + (++game.restarts);
  const oldMeshes = new Map(game.actors.filter((a) => !a.human).map((a) => [a.rec.id, a.mesh]));
  game.match = createMatch(seed);
  game.hud = createHUD(game);
  buildActors();
  for (const a of game.actors) {
    if (!a.human) {
      // Reuse the existing bot meshes (no new geometry per restart).
      scene.remove(a.mesh.group);
      a.mesh = oldMeshes.get(a.rec.id);
      a.bot.actor = a;
      a.mesh.group.rotation.x = 0;
      a.mesh.group.position.y = 0;
      if (a.mesh.tag) a.mesh.tag.visible = true;
    }
  }
  game.prevPhase = 'buy';
  game.prevDeviceState = 'carried';
  respawnAll();
  startRoundFlow();
}

function startRoundFlow() {
  const m = game.match;
  game.hud.showBanner(`ROUND ${m.round} — BUY PHASE`, `PLAN: ${m.plan} — YOU: ${m.playerRole}`, 3);
  const caller = m.players.find((p) => p.team === m.attackTeam && !p.human) || m.players[1];
  addRadio(m, caller.name, caller.role, `Plan: ${m.plan} — go ${m.plan.includes('B') ? 'B' : 'A'}`);
  if (!game.shotMode) game.hud.openBuy();
}

// ---- Input ----
const input = { keys: {}, jumpPressed: false, clickEdge: false, rightEdge: false };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  input.keys[e.code] = true;
  game.audio.ensure();
  if (e.code === 'Space') { input.jumpPressed = true; e.preventDefault(); }
  if (e.code === 'KeyM') game.audio.toggleMute();
  if (e.code === 'KeyR') {
    if (game.match.phase === 'matchend') { restartMatch(); return; }
    startReload(game, game.player);
  }
  if (e.code === 'Tab') game.hud.setScoreboard(true);
  if (e.code === 'KeyB' || e.code === 'Escape') {
    if (game.hud.buyOpen) game.hud.closeBuy();
    else if (game.match.phase === 'buy' && canBuy()) game.hud.openBuy();
  }
  if (game.hud.buyOpen) {
    const idx = BUY_HOTKEYS.indexOf(e.key.toUpperCase());
    if (idx >= 0) {
      let i = 0;
      for (const col of BUY_COLUMNS) {
        for (const item of col.items) {
          if (i === idx) {
            const r = buyItem(game, game.player, item.kind, item.id);
            if (r.ok) game.audio.buy();
            game.hud.update(0);
            return;
          }
          i += 1;
        }
      }
    }
  }
  const slotKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'];
  const si = slotKeys.indexOf(e.code);
  if (si >= 0 && !game.hud.buyOpen) {
    if (switchTo(game, game.player, si + 1)) updateViewmodelShape();
  }
});
window.addEventListener('keyup', (e) => {
  input.keys[e.code] = false;
  if (e.code === 'Tab' && game.match.phase !== 'matchend') game.hud.setScoreboard(false);
});
document.addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  const sens = game.player.scoped ? 0.0009 : 0.0021;
  game.player.yaw -= e.movementX * sens;
  game.player.pitch -= e.movementY * sens;
  game.player.pitch = Math.max(-1.45, Math.min(1.45, game.player.pitch));
});
document.addEventListener('mousedown', (e) => {
  game.audio.ensure();
  if (game.match.phase === 'matchend') { restartMatch(); return; }
  if (game.hud.buyOpen || game.hud.scoreOpen) return;
  if (!document.pointerLockElement) {
    renderer.domElement.requestPointerLock();
    return;
  }
  if (e.button === 0) { input.clickEdge = true; game.player.weap.triggerHeld = true; }
  if (e.button === 2) {
    input.rightEdge = true;
    if (game.player.weap.current === 'LONGSHOT') game.player.scoped = !game.player.scoped;
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) game.player.weap.triggerHeld = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Buy menu only during the buy phase and only while in spawn.
function canBuy() {
  const m = game.match;
  const side = m.attackTeam === game.player.rec.team ? 'SUNSPIRE' : 'BEDROCK';
  const s = SPAWNS[side];
  return Math.hypot(game.player.pos.x - s.x, game.player.pos.z - s.z) < 14;
}

function cameraDir(out) {
  const p = game.player;
  out.set(
    Math.sin(p.yaw) * Math.cos(p.pitch),
    Math.sin(p.pitch),
    Math.cos(p.yaw) * Math.cos(p.pitch),
  );
  return out;
}
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

// ---- Device: plant / defuse progress, pickup, beeps ----
function updateDevice(dt) {
  const m = game.match;
  const d = m.device;
  if (m.phase !== 'live') return;
  // A fresh drop lands where its carrier died.
  if (d.state === 'dropped' && game.prevDeviceState === 'carried' && d.lastCarrierId) {
    const carrier = game.actors.find((a) => a.rec.id === d.lastCarrierId);
    if (carrier) { d.x = carrier.pos.x; d.z = carrier.pos.z; }
    game.deviceMesh.position.set(d.x, 0, d.z);
    game.deviceMesh.visible = true;
  }
  if (d.state === 'dropped') {
    // Any alive attacker picks it up by walking over it.
    for (const a of game.actors) {
      if (!a.alive || a.rec.team !== m.attackTeam) continue;
      if (Math.hypot(a.pos.x - d.x, a.pos.z - d.z) < 1.4) {
        d.state = 'carried';
        d.carrierId = a.rec.id;
        game.deviceMesh.visible = false;
        addRadio(m, a.rec.name, a.rec.role, 'I have the device');
        break;
      }
    }
    return;
  }
  if (d.state === 'carried') {
    const carrier = game.actors.find((a) => a.rec.id === d.carrierId);
    if (!carrier || !carrier.alive) return;
    const siteKey = siteUnder(carrier.pos.x, carrier.pos.z);
    const planting = siteKey && (
      (carrier.human && input.keys['KeyE']) ||
      (!carrier.human && carrier.bot.state === 'plant')
    );
    if (planting) {
      d.plantT += dt;
      d.plantBy = carrier.rec.id;
      game.hud.setAction(`${carrier.rec.name.toUpperCase()} IS PLANTING THE DEVICE…`, d.plantT / PLANT_TIME);
      if (d.plantT >= PLANT_TIME) {
        d.state = 'planted';
        d.site = siteKey;
        d.timer = DEVICE_TIME;
        d.x = carrier.pos.x;
        d.z = carrier.pos.z;
        d.plantT = 0;
        m.plantedThisRound = true;
        carrier.rec.rPlanted = true;
        game.deviceMesh.position.set(d.x, 0, d.z);
        game.deviceMesh.visible = true;
        game.audio.plant();
        addSound(m, d.x, d.z, 'plant');
        addRadio(m, carrier.rec.name, carrier.rec.role, `Device planted at Site ${siteKey}!`);
        game.hud.showBanner(`DEVICE ARMED · SITE ${siteKey}`, 'DEFENDERS: DEFUSE IT — 40 SECONDS', 3);
        game.hud.setAction(null, 0);
      }
    } else {
      d.plantT = 0;
      if (d.plantBy === carrier.rec.id) game.hud.setAction(null, 0);
    }
    return;
  }
  if (d.state === 'planted') {
    // Accelerating beep as the timer runs down.
    const interval = 0.25 + 0.75 * (d.timer / DEVICE_TIME);
    if (m.time - game.lastBeep > interval) {
      game.lastBeep = m.time;
      game.audio.beep(d.timer < 10);
    }
    // Defuse: the player (E, with kit = 3.5 s) or the nearest defender bot.
    let defuser = null;
    const player = game.player;
    if (player.alive && player.rec.team !== m.attackTeam && input.keys['KeyE']
      && Math.hypot(player.pos.x - d.x, player.pos.z - d.z) < 2.5) defuser = player;
    if (!defuser) {
      for (const a of game.actors) {
        if (!a.human && a.alive && a.rec.team !== m.attackTeam && a.bot.state === 'defuse'
          && Math.hypot(a.pos.x - d.x, a.pos.z - d.z) < 3) { defuser = a; break; }
      }
    }
    if (defuser) {
      const total = defuser.rec.hasKit ? DEFUSE_KIT_TIME : DEFUSE_TIME;
      d.defuseT += dt;
      d.defuseBy = defuser.rec.id;
      game.hud.setAction(`${defuser.rec.name.toUpperCase()} IS DEFUSING…`, d.defuseT / total);
      if (d.defuseT >= total) {
        d.state = 'defused';
        d.defuseT = 0;
        defuser.rec.rDefused = true;
        game.audio.defuse();
        game.deviceMesh.visible = false;
        game.hud.setAction(null, 0);
        endRound(m, m.attackTeam === SUN ? BED : SUN, 'DEVICE DEFUSED');
      }
    } else {
      d.defuseT = 0;
      game.hud.setAction(null, 0);
    }
  }
}

function siteUnder(x, z) {
  for (const key of ['A', 'B']) {
    if (Math.hypot(x - SITES[key].x, z - SITES[key].z) < SITE_RADIUS) return key;
  }
  return null;
}

// ---- One fixed simulation step ----
function step(dt) {
  const m = game.match;
  const prevRound = m.round;
  const event = stepMatch(m, dt);

  // Phase transitions: banners, respawns, sounds.
  if (m.phase !== game.prevPhase) {
    if (game.prevPhase === 'buy' && m.phase === 'live') {
      game.hud.closeBuy();
      game.hud.showBanner(`ROUND ${m.round} — GO`, '', 1.5);
    }
    if (m.phase === 'end') {
      const won = m.roundWinner === game.player.rec.team;
      game.audio[won ? 'win' : 'lose']();
      game.hud.showBanner(
        won ? `ROUND WON — ${m.roundWinner}` : `ROUND LOST — ${m.roundWinner} TAKES IT`,
        `${m.roundReason}${m.roundMvp ? ` · MVP: ${m.roundMvp.name}` : ''}`,
        3,
      );
      game.hud.setScoreboard(true);
    }
    if (m.phase === 'buy' && m.round !== prevRound) {
      respawnAll();
      startRoundFlow();
    }
    if (m.phase === 'matchend') {
      game.hud.setScoreboard(true);
      const won = m.matchWinner === game.player.rec.team;
      game.audio[won ? 'win' : 'lose']();
    }
    game.prevPhase = m.phase;
  }
  if (event === 'explode') {
    game.audio.explode();
    game.deviceMesh.visible = false;
    game.hud.showBanner('DEVICE DETONATED', '', 2);
  }
  if (m.phase === 'matchend') return;

  // Player.
  const player = game.player;
  if (player.alive && m.phase === 'live') {
    updatePlayer(game, player, dt, input);
    // Sprinting footsteps are audible to bots nearby.
    if (player.sprinting && m.time - game.lastStepSound > 0.45) {
      game.lastStepSound = m.time;
      addSound(m, player.pos.x, player.pos.z, 'steps');
    }
    // Fire / throw on click; hold for automatics.
    const cur = player.weap.current;
    if (UTILITIES[cur]) {
      if (input.clickEdge) {
        if (throwUtility(game, player, cur)) {
          if (player.rec.utils[cur] <= 0) { switchTo(game, player, player.rec.primary ? 1 : 2); updateViewmodelShape(); }
        }
      }
    } else if (cur === 'RASP') {
      if (input.clickEdge) meleeAttack(game, player);
    } else if (WEAPONS[cur]) {
      const def = WEAPONS[cur];
      if (def.auto ? player.weap.triggerHeld : input.clickEdge) {
        fireWeapon(game, player, cameraDir(_dir), {});
      }
    }
  }
  updateWeaponActor(game, player, dt);
  updateArcPreview(game, player);

  // Bots (frozen in shot mode: the staged poses must not drift).
  if (!game.shotMode) {
    for (const a of game.actors) {
      if (a.human || !a.alive) continue;
      if (m.phase === 'live') updateBot(game, a, dt);
      else syncBotMesh(a);
      updateWeaponActor(game, a, dt);
    }
  }
  // In shot mode the staged device state is frozen; only live play advances it.
  if (!game.shotMode) updateDevice(dt);
  updateEffects(game, dt);

  // Blindness decays in real render time (it is a screen effect, not sim state).
  input.jumpPressed = false;
  input.clickEdge = false;
  input.rightEdge = false;
}

// ---- Render: camera, viewmodel bob/dip, device lamp blink ----
function render(dt) {
  const player = game.player;
  const m = game.match;
  eyePosition(player, _eye);
  if (!player.alive) _eye.y = player.pos.y + 0.5; // fallen camera
  camera.position.copy(_eye);
  camera.rotation.y = player.yaw + Math.PI;
  camera.rotation.x = player.pitch;
  camera.rotation.z = player.alive ? 0 : 0.5;
  const targetFov = player.scoped ? 32 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
  // Viewmodel: walk bob + switch dip + reload dip.
  const vm = game.viewmodel.group;
  const w = player.weap;
  const bobY = Math.sin(player.bobT * 2) * 0.006;
  const bobX = Math.cos(player.bobT) * 0.005;
  let dip = 0;
  if (w.switchT > 0) dip = (w.switchT / 0.35) * 0.22;
  if (w.reloading) dip = Math.max(dip, 0.12 + 0.06 * Math.sin(m.time * 9));
  vm.position.set(0.24 + bobX, game.viewmodel.baseY + bobY - dip, -0.45);
  vm.rotation.x = dip * 1.2;
  vm.rotation.z = w.reloading ? 0.25 : 0;
  // Device lamp blinks faster as the timer runs down.
  if (game.deviceMesh.visible) {
    const lamp = game.deviceMesh.getObjectByName('lamp');
    const rate = m.device.state === 'planted' ? 12 - 8 * (m.device.timer / DEVICE_TIME) : 4;
    lamp.visible = Math.sin(m.time * rate) > 0;
  }
  // Blind overlays decay with render time.
  game.flashBlind = Math.max(0, game.flashBlind - dt * 0.9);
  game.flareBlind = Math.max(0, game.flareBlind - dt * 1.1);
  game.hud.update(dt);
  renderer.render(scene, camera);
}

// ---- Main loop: fixed-step accumulator, render every frame ----
let last = performance.now();
let acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  // Clamp both ways: a negative frameDt (rAF timestamp predating module
  // eval — seen in headless Chromium) would otherwise ADD to the blind
  // overlays through the decay lines and white/flare the whole frame.
  const frameDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!game.paused) {
    acc += frameDt;
    let guard = 0;
    while (acc >= FIXED_DT && guard < 8) {
      step(FIXED_DT);
      acc -= FIXED_DT;
      guard += 1;
    }
    if (guard >= 8) acc = 0; // never spiral after a hitch
  }
  render(frameDt);
  if (game.shotMode && game.paused && !game.shotReady) {
    game.framesAfterStage += 1;
    if (game.framesAfterStage >= 3) {
      game.shotReady = true;
      window.__shotReady = true;
    }
  }
}

// Debug hook for play-testing: advance the fixed-step sim by N seconds
// without waiting on the render loop (software rendering runs far below
// real time). The sim itself is unchanged — same steps, same order.
window.__advance = (seconds) => {
  const n = Math.max(0, Math.round(seconds * 60));
  for (let i = 0; i < n; i++) step(FIXED_DT);
};

// ---- ?shot= staging: the game's own systems, fixed state, then paused ----
function actorById(id) { return game.actors.find((a) => a.rec.id === id); }
function placeActor(id, x, z, yaw, pitch) {
  const a = actorById(id);
  a.pos.set(x, groundHeight(x, z), z);
  a.yaw = yaw;
  if (a.human) a.pitch = pitch || 0;
  a.vel.set(0, 0, 0);
  if (a.mesh) {
    a.mesh.group.position.set(x, a.pos.y, z);
    a.mesh.group.rotation.y = yaw;
  }
  return a;
}
function killActor(id, x, z, yaw) {
  const a = placeActor(id, x, z, yaw || 0);
  a.alive = false;
  a.rec.alive = false;
  a.rec.hp = 0;
  a.rec.deaths += 1;
  if (a.mesh) a.fallDead();
  return a;
}
function giveLoadout(id, primary, secondary, utils) {
  const a = actorById(id);
  if (primary) { a.rec.primary = primary; a.weap.mag[primary] = WEAPONS[primary].mag; a.weap.reserve[primary] = WEAPONS[primary].reserve; }
  if (secondary) { a.rec.secondary = secondary; }
  if (utils) Object.assign(a.rec.utils, utils);
  if (primary) a.weap.current = primary;
  else a.weap.current = a.rec.secondary;
  return a;
}

function stageCombat() {
  const m = game.match;
  m.round = 3;
  m.scores[SUN] = 1;
  m.scores[BED] = 1;
  m.phase = 'live';
  m.roundTime = 55;
  m.plan = 'SPLIT A';
  m.playerRole = 'ENTRY';
  const you = actorById('you');
  you.rec.hp = 78; you.rec.armour = 50; you.rec.money = 2150;
  giveLoadout('you', 'TALON AR', 'SP-9', { smoke: 1, flash: 1 });
  you.weap.mag['TALON AR'] = 27; // partially spent
  you.weap.reserve['TALON AR'] = 90;
  placeActor('you', -10, 0, Math.PI / 2, -0.22); // MID, pitched down: horizon at ~58%
  placeActor('nadia', -3, -2.5, Math.PI / 2);
  giveLoadout('nadia', 'TALON AR', 'SP-9');
  placeActor('oren', -2, 3, Math.PI / 2);
  giveLoadout('oren', 'WASP-9', 'SP-9');
  m.device.carrierId = 'oren';
  placeActor('lena', 10, -3, -Math.PI / 2);
  giveLoadout('lena', 'TALON AR', 'SP-9');
  placeActor('marek', 13, 0.5, -Math.PI / 2);
  giveLoadout('marek', 'TALON AR', 'SP-9');
  placeActor('ines', 9, -5.5, -Math.PI / 2);
  giveLoadout('ines', 'WASP-9', 'SP-9');
  killActor('suki', 7, -3.5, 0.6);
  killActor('tomas', 5, 4.5, -0.4);
  killActor('priya', -6, 1.5, 2.2);
  killActor('dario', -14, 8, 1.1);
  actorById('you').rec.kills = 1; actorById('you').rec.headshots = 1; actorById('you').rec.damage = 142;
  actorById('oren').rec.kills = 1;
  actorById('lena').rec.kills = 1;
  actorById('marek').rec.kills = 1;
  addKillfeed(m, 'You', 'TALON AR', 'Suki', true);
  addKillfeed(m, 'Oren', 'WASP-9', 'Tomas', false);
  addKillfeed(m, 'Marek', 'TALON AR', 'Priya', false);
  addKillfeed(m, 'Lena', 'TALON AR', 'Dario', false);
  addRadio(m, 'Oren', 'ENTRY', 'Contact, Panel Rows — 2 spotted!');
  addRadio(m, 'Nadia', 'SUPPORT', 'Rotating to A');
  addRadio(m, 'Marek', 'ANCHOR', 'Holding Control Block — smoke up, I see them');
  // Smoke in the mid-ground (off the sightline to the enemies) + two live
  // tracers crossing the frame (enemies firing at our teammates ahead).
  bloomSmoke(game, { pos: new THREE.Vector3(7, 0.2, 3.5) });
  const lena = actorById('lena');
  const marek = actorById('marek');
  fireWeapon(game, lena, new THREE.Vector3(-1, 0.01, 0.03).normalize(), { spreadMul: 0.5 });
  fireWeapon(game, marek, new THREE.Vector3(-1, 0.01, 0.17).normalize(), { spreadMul: 0.5 });
}

function stageBuy() {
  const m = game.match;
  m.round = 4;
  m.scores[SUN] = 2;
  m.scores[BED] = 1;
  m.phase = 'buy';
  m.phaseT = 8;
  m.plan = 'A EXECUTE';
  m.playerRole = 'ENTRY';
  const you = actorById('you');
  you.rec.money = 3500;
  you.rec.hasVest = true;
  you.rec.armour = 100;
  giveLoadout('you', 'TALON AR', 'SP-9', { smoke: 1 });
  placeActor('you', -42, 0, Math.PI / 2, 0);
  placeActor('nadia', -40, -3, Math.PI / 2);
  placeActor('oren', -40, 3, Math.PI / 2);
  placeActor('priya', -44, -2, Math.PI / 2);
  placeActor('dario', -44, 2, Math.PI / 2);
  addKillfeed(m, 'You', 'TALON AR', 'Marek', false);
  addKillfeed(m, 'Oren', 'WASP-9', 'Suki', true);
  addRadio(m, 'Nadia', 'SUPPORT', 'Plan: A Execute — go A');
  document.getElementById('buy-round').textContent = '4';
  game.hud.openBuy();
}

function stageObjective() {
  const m = game.match;
  m.round = 7;
  m.scores[SUN] = 3;
  m.scores[BED] = 3;
  m.attackTeam = BED; // sides swapped after round 6: SUNSPIRE defends now
  m.phase = 'live';
  m.plan = 'B EXECUTE';
  m.playerRole = 'SUPPORT';
  // Device planted at SITE B; the player defuses with a kit, ~60% done.
  m.device.state = 'planted';
  m.device.site = 'B';
  m.device.x = SITES.B.x;
  m.device.z = SITES.B.z;
  m.device.timer = 32;
  m.device.defuseBy = 'you';
  m.device.defuseT = 2.1; // 60% of the 3.5 s kit defuse
  m.plantedThisRound = true;
  game.deviceMesh.position.set(SITES.B.x, 0, SITES.B.z);
  game.deviceMesh.visible = true;
  const you = actorById('you');
  you.rec.hp = 20; // low health for drama
  you.rec.armour = 0;
  you.rec.money = 1200;
  you.rec.hasKit = true;
  giveLoadout('you', 'TALON AR', 'REX .45', { flash: 1 });
  you.weap.mag['TALON AR'] = 14;
  placeActor('you', 22.2, 16.6, Math.atan2(1.8, 1.4), -0.28); // close, looking down at the device
  placeActor('nadia', 17, 21, 1.2);
  giveLoadout('nadia', 'TALON AR', 'SP-9');
  placeActor('oren', 19, 12, 0.9);
  giveLoadout('oren', 'WASP-9', 'SP-9');
  placeActor('suki', 28, 23, -2.4);
  giveLoadout('suki', 'LONGSHOT', 'SP-9');
  killActor('ines', 21, 20, 0.4);
  killActor('priya', 18, 16, 2.6);
  killActor('tomas', 26, 14, -1.2);
  killActor('dario', 15, 18, 1.4);
  actorById('you').rec.kills = 2; actorById('you').rec.headshots = 1; actorById('you').rec.damage = 218;
  addKillfeed(m, 'You', 'REX .45', 'Ines', true);
  addKillfeed(m, 'Lena', 'TALON AR', 'Priya', false);
  addKillfeed(m, 'Oren', 'WASP-9', 'Tomas', false);
  addKillfeed(m, 'Marek', 'MAUL-12', 'Dario', false);
  addRadio(m, 'Nadia', 'SUPPORT', 'Covering you — defuse!');
  addRadio(m, 'Lena', 'ANCHOR', 'They are on the device!');
  bloomSmoke(game, { pos: new THREE.Vector3(26, 0.2, 26) });
  game.hud.showBanner('DEVICE ARMED · SITE B', 'DEFUSE IT — 32 SECONDS LEFT', 60);
  game.hud.setAction('YOU ARE DEFUSING…', 0.6);
}

function stageScore() {
  const m = game.match;
  m.round = 11;
  m.scores[SUN] = 7;
  m.scores[BED] = 4;
  m.phase = 'matchend';
  m.matchWinner = SUN;
  const stats = {
    you: [18, 4, 9, 6, 2450, 3, 5200],
    nadia: [12, 6, 10, 3, 1680, 1, 3400],
    oren: [15, 3, 11, 5, 1980, 2, 4100],
    priya: [9, 8, 8, 2, 1240, 0, 2750],
    dario: [11, 2, 12, 4, 1510, 1, 1900],
    lena: [14, 5, 12, 4, 1870, 2, 3600],
    marek: [10, 4, 13, 2, 1420, 0, 2200],
    ines: [8, 3, 14, 3, 1150, 1, 1500],
    tomas: [7, 6, 11, 1, 980, 0, 3100],
    suki: [9, 2, 15, 5, 1290, 1, 800],
  };
  for (const p of m.players) {
    const [k, a, d, hs, dmg, mvp, money] = stats[p.id];
    p.kills = k; p.assists = a; p.deaths = d; p.headshots = hs;
    p.damage = dmg; p.mvps = mvp; p.money = money;
    p.hp = 100; p.alive = true;
  }
  m.roundMvp = playerById(m, 'you');
  giveLoadout('you', 'TALON AR', 'SP-9');
  placeActor('you', -4, 0, Math.PI / 2, -0.06);
  placeActor('nadia', 2, -3, Math.PI / 2);
  placeActor('oren', 2, 3, Math.PI / 2);
  addKillfeed(m, 'You', 'TALON AR', 'Suki', true);
  addKillfeed(m, 'Oren', 'WASP-9', 'Tomas', false);
  addKillfeed(m, 'Nadia', 'TALON AR', 'Ines', false);
  game.hud.setScoreboard(true);
}

function stageShot(mode) {
  respawnAll();
  if (mode === 'combat') stageCombat();
  else if (mode === 'buy') stageBuy();
  else if (mode === 'objective') stageObjective();
  else if (mode === 'score') stageScore();
  else return;
  updateViewmodelShape();
  // Sync the transition trackers so the settle steps cannot fire a
  // phase-change banner over the staged one.
  game.prevPhase = game.match.phase;
  game.prevDeviceState = game.match.device.state;
  // Two settle steps (bots frozen; the tracer and muzzle flash stay live),
  // then the sim pauses and the frame holds for capture.
  step(FIXED_DT);
  step(FIXED_DT);
  game.paused = true;
  game.flashBlind = 0; // staged scenes never blind the player
  game.flareBlind = 0;
  game.hud.update(0);
}

// ---- Boot ----
respawnAll();
if (SHOT) {
  stageShot(SHOT);
} else {
  startRoundFlow();
}
updateViewmodelShape();
requestAnimationFrame(loop);
