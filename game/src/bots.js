// bots.js — the nine bots: roles, waypoint routes, holds, peeks, hearing,
// radio callouts, human-like aim error, and plant/defuse behaviour.
// Bots never know an enemy's position through walls: they react only to what
// they see and what they hear. Smoke blocks their sight (see world.hasLOS).
import * as THREE from 'three';
import { ROUTES, HOLDS, SITES, SPAWNS, zoneAt, hasLOS, groundHeight } from './world.js';
import { addRadio, addSound, defendTeam, playerById } from './sim.js';
import { fireWeapon, switchTo, buyItem, startReload, WEAPONS } from './weapon.js';
import { collideMove, EYE_STAND } from './player.js';

const TEAM_COLORS = {
  SUNSPIRE: { torso: 0xf07d1a, limb: 0x4a3826, head: 0xe8d3ae, helmet: 0xffa726 },
  BEDROCK: { torso: 0x1f9db8, limb: 0x2e3a4a, head: 0xe8d3ae, helmet: 0x29b6d8 },
};
const BOT_SPEED = 4.3;
const SEE_DIST = 55;

function nameTagTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(15,12,8,0.72)';
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = color;
  g.fillRect(0, 0, 8, 48);
  g.font = 'bold 26px Arial';
  g.fillStyle = '#f5ead6';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(name, 18, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Blocky humanoid in team colours, with a visible held weapon. Name tags
// show for teammates only; enemies never show one.
export function createBotMesh(scene, team, name, showTag) {
  const c = TEAM_COLORS[team];
  const g = new THREE.Group();
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.34), mat(c.torso));
  torso.position.y = 1.08;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), mat(c.head));
  head.position.y = 1.62;
  head.castShadow = true;
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.36), mat(c.helmet));
  helmet.position.y = 1.8;
  g.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), mat(0x1a1a1a));
  visor.position.set(0, 1.64, 0.17);
  g.add(visor);
  const legGeo = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  const legL = new THREE.Mesh(legGeo, mat(c.limb));
  legL.position.set(-0.15, 0.36, 0);
  legL.castShadow = true;
  g.add(legL);
  const legR = new THREE.Mesh(legGeo, mat(c.limb));
  legR.position.set(0.15, 0.36, 0);
  legR.castShadow = true;
  g.add(legR);
  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.18);
  const armL = new THREE.Mesh(armGeo, mat(c.limb));
  armL.position.set(-0.37, 1.15, 0.08);
  armL.rotation.x = -0.7;
  g.add(armL);
  const armR = new THREE.Mesh(armGeo, mat(c.limb));
  armR.position.set(0.37, 1.15, 0.08);
  armR.rotation.x = -0.7;
  g.add(armR);
  // Held weapon: dark, long, visible against the sand.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.78), mat(0x222222));
  gun.position.set(0.12, 1.32, 0.35);
  gun.castShadow = true;
  g.add(gun);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), mat(0x3a3a3a));
  grip.position.set(0.12, 1.18, 0.18);
  g.add(grip);
  let tag = null;
  if (showTag) {
    tag = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nameTagTexture(name, team === 'SUNSPIRE' ? '#ffa726' : '#29b6d8'),
      transparent: true, depthWrite: false,
    }));
    tag.scale.set(1.7, 0.32, 1);
    tag.position.y = 2.2;
    g.add(tag);
  }
  scene.add(g);
  return { group: g, legL, legR, tag };
}

export function createBot(game, rec, mesh) {
  const spawn = SPAWNS[game.match.attackTeam === rec.team ? 'SUNSPIRE' : 'BEDROCK'];
  const actor = {
    rec,
    human: false,
    alive: true,
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(),
    yaw: spawn.yaw,
    pitch: 0,
    crouch: false,
    onGround: true,
    scoped: false,
    weap: null,
    mesh,
    bot: null,
    fallDead() {
      mesh.group.rotation.x = -Math.PI / 2;
      mesh.group.position.y = 0.18;
      if (mesh.tag) mesh.tag.visible = false;
    },
  };
  const bot = {
    actor,
    state: 'route',
    route: [],
    wp: 0,
    offsets: [],
    holdT: 0,
    holdYaw: 0,
    targetId: null,
    reactT: 0,
    burstLeft: 0,
    burstPause: 0,
    blindT: 0,
    lastKills: 0,
    radioT: 0, // sim time before this bot may call again
    walkT: 0,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
    strafeT: 0,
    strafeDir: 1,
    hearX: 0,
    hearZ: 0,
    planTarget: 'A',
  };
  actor.bot = bot;
  return actor;
}

export function respawnBot(game, actor) {
  const side = game.match.attackTeam === actor.rec.team ? 'SUNSPIRE' : 'BEDROCK';
  const s = SPAWNS[side];
  actor.pos.set(s.x + (game.match.rng() - 0.5) * 4, 0, s.z + (game.match.rng() - 0.5) * 6);
  actor.vel.set(0, 0, 0);
  actor.yaw = s.yaw;
  actor.alive = true;
  actor.crouch = false;
  actor.mesh.group.rotation.x = 0;
  actor.mesh.group.position.y = 0;
  if (actor.mesh.tag) actor.mesh.tag.visible = true;
  const bot = actor.bot;
  bot.state = 'route';
  bot.wp = 0;
  bot.targetId = null;
  bot.blindT = 0;
  bot.stuckT = 0;
  assignRoute(game, actor);
  botBuy(game, actor);
}

// Route assignment follows the round plan and the bot's role.
function assignRoute(game, actor) {
  const m = game.match;
  const bot = actor.bot;
  const isAttack = m.attackTeam === actor.rec.team;
  const rng = m.rng;
  const plan = m.plan;
  const target = plan.includes('B') ? 'B' : 'A';
  bot.planTarget = target;
  let key;
  if (isAttack) {
    const carrier = m.device.carrierId === actor.rec.id;
    if (plan === 'RUSH B' || plan === 'B EXECUTE') key = actor.rec.role === 'LURK' ? 'atkMidB' : 'atkB';
    else if (plan === 'A EXECUTE') key = actor.rec.role === 'LURK' ? 'atkMidA' : 'atkA';
    else if (plan === 'SPLIT A') key = actor.rec.role === 'LURK' ? 'atkB' : (actor.rec.role === 'ENTRY' ? 'atkA' : 'atkMidA');
    else if (plan === 'MID CONTROL') key = actor.rec.role === 'ANCHOR' ? 'atkA' : 'atkMidA';
    else key = actor.rec.role === 'LURK' ? 'atkB' : actor.rec.role === 'ENTRY' ? 'atkA' : 'atkMidA';
    if (carrier) key = target === 'B' ? 'atkMidB' : 'atkMidA';
  } else {
    if (actor.rec.role === 'ANCHOR') key = target === 'B' ? 'defB' : 'defA';
    else if (actor.rec.role === 'ENTRY') key = 'defMid';
    else if (actor.rec.role === 'LURK') key = 'defMid';
    else key = target === 'B' ? 'defA' : 'defB';
    // Defenders spread: one anchor always covers the other site.
    if (actor.rec.name === 'Marek') key = 'defA';
    if (actor.rec.name === 'Lena') key = 'defB';
  }
  bot.route = ROUTES[key].map(([x, z]) => [x, z]);
  bot.offsets = bot.route.map(() => [(rng() - 0.5) * 3, (rng() - 0.5) * 3]);
  bot.wp = 0;
}

// Bots buy too: best affordable primary for the role, then armour, then a utility.
function botBuy(game, actor) {
  const rec = actor.rec;
  const m = game.match;
  const isDef = m.attackTeam !== rec.team;
  const want = rec.role === 'LURK' ? ['LONGSHOT', 'TALON AR', 'WASP-9']
    : rec.role === 'ANCHOR' ? ['TALON AR', 'MAUL-12', 'WASP-9']
    : ['TALON AR', 'WASP-9', 'MAUL-12'];
  if (!rec.primary) {
    for (const name of want) {
      if (rec.money >= WEAPONS[name].price) { buyItem(game, actor, 'weapon', name); break; }
    }
  }
  if (!rec.hasVest && rec.money >= 1000) buyItem(game, actor, 'gear', 'vestHelmet');
  else if (!rec.hasVest && rec.money >= 650) buyItem(game, actor, 'gear', 'vest');
  if (isDef && !rec.hasKit && rec.money >= 400) buyItem(game, actor, 'gear', 'kit');
  const util = rec.role === 'SUPPORT' ? 'smoke' : rec.role === 'ENTRY' ? 'flash' : rec.role === 'LURK' ? 'flare' : 'frag';
  if (rec.money >= 200) buyItem(game, actor, 'util', util);
  if (rec.primary) switchTo(game, actor, 1);
}

function say(game, bot, text) {
  const m = game.match;
  if (m.time < bot.radioT) return;
  bot.radioT = m.time + 6 + m.rng() * 4;
  addRadio(m, bot.actor.rec.name, bot.actor.rec.role, text);
}

function visibleEnemies(game, actor) {
  const out = [];
  const eyeY = actor.pos.y + 1.5;
  for (const a of game.actors) {
    if (a === actor || !a.alive || a.rec.team === actor.rec.team) continue;
    const dx = a.pos.x - actor.pos.x;
    const dz = a.pos.z - actor.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SEE_DIST) continue;
    // Roughly in front (bots do not see behind them without a sound cue).
    const fwdX = Math.sin(actor.yaw);
    const fwdZ = Math.cos(actor.yaw);
    if ((fwdX * dx + fwdZ * dz) / Math.max(0.001, dist) < -0.25) continue;
    if (!hasLOS(game.colliders, game.fx.smokes, actor.pos.x, eyeY, actor.pos.z, a.pos.x, a.pos.y + 1.2, a.pos.z)) continue;
    out.push({ actor: a, dist });
  }
  out.sort((p, q) => p.dist - q.dist);
  return out;
}

function moveToward(game, actor, tx, tz, dt, speed) {
  const dx = tx - actor.pos.x;
  const dz = tz - actor.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.2) { actor.vel.set(0, 0, 0); return true; }
  const vx = (dx / dist) * speed;
  const vz = (dz / dist) * speed;
  actor.vel.set(vx, 0, vz);
  actor.yaw = Math.atan2(dx, dz);
  collideMove(game.colliders, actor.pos, vx * dt, vz * dt, actor.pos.y, 0.34);
  actor.pos.y = groundHeight(actor.pos.x, actor.pos.z);
  return dist < 0.6;
}

function aimAt(actor, tx, ty, tz) {
  const dx = tx - actor.pos.x;
  const dz = tz - actor.pos.z;
  actor.yaw = Math.atan2(dx, dz);
}

export function updateBot(game, actor, dt) {
  const m = game.match;
  const bot = actor.bot;
  if (!actor.alive) return;
  const rng = m.rng;

  // A kill of ours gets a radio call.
  if (actor.rec.kills > bot.lastKills) {
    bot.lastKills = actor.rec.kills;
    say(game, bot, `Got one at ${zoneAt(actor.pos.x, actor.pos.z)}.`);
  }
  if (bot.blindT > 0) {
    bot.blindT -= dt;
    actor.vel.set(0, 0, 0);
    return; // blinded: stop and wait it out
  }

  // ---- Hearing: gunfire, footsteps, the plant beep ----
  for (const s of m.sounds) {
    if (m.time - s.t > 1.2) continue;
    const d = Math.hypot(s.x - actor.pos.x, s.z - actor.pos.z);
    if (s.kind === 'shot' && d < 32 && !bot.targetId) {
      bot.hearX = s.x; bot.hearZ = s.z;
      aimAt(actor, s.x, 0, s.z);
      say(game, bot, `Contact, ${zoneAt(s.x, s.z)} — shots fired!`);
    } else if (s.kind === 'steps' && d < 12) {
      say(game, bot, `Footsteps ${zoneAt(s.x, s.z)} — flanking`);
    } else if (s.kind === 'plant' && m.attackTeam !== actor.rec.team
      && bot.state !== 'defuse' && bot.state !== 'plant') {
      bot.state = 'rotate';
      bot.route = m.device.site === 'A' ? ROUTES.rotBtoA : ROUTES.rotAtoB;
      bot.offsets = bot.route.map(() => [(rng() - 0.5) * 2, (rng() - 0.5) * 2]);
      bot.wp = 0;
      say(game, bot, `Device planted — rotating to Site ${m.device.site}`);
    }
  }

  // ---- Seeing: pick the nearest visible enemy ----
  // A bot committed to planting or defusing does not break off to fight:
  // without this, a visible defender interrupts the plant forever.
  const seen = visibleEnemies(game, actor);
  if (seen.length > 0 && bot.state !== 'defuse' && bot.state !== 'plant') {
    const target = seen[0].actor;
    if (bot.targetId !== target.rec.id) {
      bot.targetId = target.rec.id;
      bot.reactT = 0.25 + rng() * 0.35; // human reaction delay
      bot.burstLeft = 0;
      bot.burstPause = 0;
      say(game, bot, `Contact, ${zoneAt(target.pos.x, target.pos.z)} — ${seen.length} spotted!`);
    }
    bot.state = 'engage';
  } else if (bot.state === 'engage') {
    bot.targetId = null;
    bot.state = bot.route.length > 0 && bot.wp < bot.route.length ? 'route' : 'hold';
  }

  if (bot.state === 'engage') {
    const target = game.actors.find((a) => a.rec.id === bot.targetId);
    if (!target || !target.alive) { bot.targetId = null; return; }
    aimAt(actor, target.pos.x, 0, target.pos.z);
    // Strafe while fighting: sideways steps, changing direction on a schedule.
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) {
      bot.strafeT = 0.7 + rng() * 0.7;
      bot.strafeDir = rng() < 0.5 ? -1 : 1;
      actor.crouch = rng() < 0.3; // sometimes crouch for the accuracy bonus
    }
    const strafeX = Math.cos(actor.yaw) * bot.strafeDir;
    const strafeZ = -Math.sin(actor.yaw) * bot.strafeDir;
    collideMove(game.colliders, actor.pos, strafeX * 1.8 * dt, strafeZ * 1.8 * dt, actor.pos.y, 0.34);
    actor.vel.set(strafeX * 1.8, 0, strafeZ * 1.8);
    // Fire in bursts with pauses, after the reaction delay.
    if (bot.reactT > 0) { bot.reactT -= dt; return; }
    if (bot.burstPause > 0) { bot.burstPause -= dt; return; }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(rng() * 3);
      bot.burstPause = 0;
    }
    // Aim error: worse at long range and against moving targets.
    const dist = Math.hypot(target.pos.x - actor.pos.x, target.pos.z - actor.pos.z);
    const tSpeed = Math.hypot(target.vel.x, target.vel.z);
    const err = 0.02 + dist * 0.0011 + tSpeed * 0.004 + (actor.crouch ? -0.008 : 0);
    const tx = target.pos.x + (rng() - 0.5) * 2 * err * dist;
    const tz = target.pos.z + (rng() - 0.5) * 2 * err * dist;
    const ty = target.pos.y + 1.15 + (rng() - 0.5) * 0.5;
    const eyeY = actor.pos.y + 1.5;
    const dir = new THREE.Vector3(tx - actor.pos.x, ty - eyeY, tz - actor.pos.z).normalize();
    const cur = actor.weap.current;
    if (WEAPONS[cur] && actor.weap.mag[cur] <= 0) {
      // Out of ammo: reload, or fall back to the sidearm.
      if (actor.weap.reserve[cur] > 0) { startReload(game, actor); }
      else switchTo(game, actor, 2);
      return;
    }
    if (fireWeapon(game, actor, dir, { spreadMul: 0.8 })) {
      // A hit on a moving fight: keep the burst going.
    }
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) bot.burstPause = 0.35 + rng() * 0.45;
    return;
  }

  if (bot.state === 'plant') return; // standing still, planting (main.js advances the timer)
  if (bot.state === 'defuse') return; // standing still, defusing

  if (bot.state === 'hold') {
    bot.holdT -= dt;
    actor.vel.set(0, 0, 0);
    // Peek: strafe out and back while holding an angle.
    const peek = Math.sin(m.time * 0.7 + actor.rec.id.length) * 0.9;
    actor.yaw = bot.holdYaw + peek * 0.25;
    if (bot.holdT <= 0) {
      // Rotate to another hold, or push up if the plan calls for it.
      bot.holdT = 4 + rng() * 4;
      bot.holdYaw = bot.holdYaw + (rng() - 0.5) * 0.8;
    }
    return;
  }

  // ---- Route following (route / rotate states) ----
  if (bot.wp >= bot.route.length) {
    bot.state = 'hold';
    bot.holdT = 5 + rng() * 5;
    const h = HOLDS[Math.floor(rng() * HOLDS.length)];
    bot.holdYaw = h.yaw;
    // The carrier plants on reaching its site.
    if (m.device.state === 'carried' && m.device.carrierId === actor.rec.id) {
      const site = SITES[bot.planTarget];
      if (Math.hypot(actor.pos.x - site.x, actor.pos.z - site.z) < SITE_RADIUS) {
        bot.state = 'plant';
        m.device.plantBy = actor.rec.id;
        say(game, bot, `Planting at Site ${bot.planTarget} — cover me`);
      }
    }
    // A defender who rotated to a planted site defuses.
    if (m.device.state === 'planted' && m.attackTeam !== actor.rec.team) {
      const d = Math.hypot(actor.pos.x - m.device.x, actor.pos.z - m.device.z);
      if (d < 3) {
        bot.state = 'defuse';
        m.device.defuseBy = actor.rec.id;
        say(game, bot, 'Defusing — cover me');
      }
    }
    return;
  }
  const [wx, wz] = bot.route[bot.wp];
  const [ox, oz] = bot.offsets[bot.wp];
  const arrived = moveToward(game, actor, wx + ox, wz + oz, dt, BOT_SPEED);
  // Stuck detection: no progress for 1.5 s means the next waypoint is unreachable.
  if (Math.hypot(actor.pos.x - bot.lastX, actor.pos.z - bot.lastZ) < 0.05) {
    bot.stuckT += dt;
    if (bot.stuckT > 1.5) { bot.wp += 1; bot.stuckT = 0; }
  } else {
    bot.stuckT = 0;
  }
  bot.lastX = actor.pos.x;
  bot.lastZ = actor.pos.z;
  if (arrived) bot.wp += 1;

  // Walk animation: legs swing, body bobs.
  bot.walkT += dt * 9;
  const swing = Math.sin(bot.walkT) * 0.55;
  actor.mesh.legL.rotation.x = swing;
  actor.mesh.legR.rotation.x = -swing;
  actor.mesh.group.position.y = Math.abs(Math.sin(bot.walkT)) * 0.04;
  actor.mesh.group.rotation.y = actor.yaw;
  actor.mesh.group.position.x = actor.pos.x;
  actor.mesh.group.position.z = actor.pos.z;
}

// Sync a bot's mesh to its actor after any state change (also used when idle).
export function syncBotMesh(actor) {
  const g = actor.mesh.group;
  g.position.x = actor.pos.x;
  g.position.z = actor.pos.z;
  if (actor.alive) {
    g.position.y = actor.pos.y + Math.abs(Math.sin(actor.bot.walkT)) * 0.04;
    g.rotation.y = actor.yaw;
  }
}
