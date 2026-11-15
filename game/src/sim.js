// sim.js — match state, rounds, economy, damage, MVP. Pure logic, no three.js.
// One match: 12 rounds max, first to 7. Sides swap after round 6. All randomness
// comes from the seeded RNG below; nothing here reads unseeded randomness or wall time.

// Deterministic PRNG (mulberry32). One instance per match, seeded from ?seed=.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SUN = 'SUNSPIRE';
export const BED = 'BEDROCK';
export const MAX_ROUNDS = 12;
export const WIN_TARGET = 7;
export const ROUND_TIME = 100;      // seconds of live play per round
export const BUY_TIME = 12;         // seconds of buy phase per round
export const END_TIME = 3;          // seconds the round-end banner shows
export const DEVICE_TIME = 40;      // seconds from plant to explosion
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 7;
export const DEFUSE_KIT_TIME = 3.5;
export const MONEY_CAP = 16000;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1400;
export const PLANT_BONUS = 300;

// Roster. Original names, fixed roles, fixed preferred lanes.
export const ROSTER = [
  { id: 'you',   name: 'You',   team: SUN, role: 'ENTRY',   human: true },
  { id: 'nadia', name: 'Nadia', team: SUN, role: 'SUPPORT', human: false },
  { id: 'oren',  name: 'Oren',  team: SUN, role: 'ENTRY',   human: false },
  { id: 'priya', name: 'Priya', team: SUN, role: 'SUPPORT', human: false },
  { id: 'dario', name: 'Dario', team: SUN, role: 'LURK',    human: false },
  { id: 'lena',  name: 'Lena',  team: BED, role: 'ANCHOR',  human: false },
  { id: 'marek', name: 'Marek', team: BED, role: 'ANCHOR',  human: false },
  { id: 'ines',  name: 'Ines',  team: BED, role: 'ENTRY',   human: false },
  { id: 'tomas', name: 'Tomas', team: BED, role: 'SUPPORT', human: false },
  { id: 'suki',  name: 'Suki',  team: BED, role: 'LURK',    human: false },
];

export const PLANS = ['SPLIT A', 'RUSH B', 'MID CONTROL', 'A EXECUTE', 'B EXECUTE', 'DEFAULT'];
export const PLAYER_ROLES = ['ENTRY', 'SUPPORT', 'LURK', 'ANCHOR'];

export function createMatch(seed) {
  const rng = mulberry32(seed || 1);
  const players = ROSTER.map((r) => ({
    ...r,
    alive: true, hp: 100, armour: 0, helmet: false,
    money: START_MONEY,
    kills: 0, assists: 0, deaths: 0, headshots: 0, shots: 0, hits: 0,
    damage: 0, mvps: 0,
    // per-round impact, reset by startRound
    rKills: 0, rDamage: 0, rPlanted: false, rDefused: false,
    // loadout (weapon.js owns the numbers; sim owns what is carried)
    primary: null, secondary: 'SP-9',
    utils: { frag: 0, smoke: 0, flash: 0, flare: 0 },
    hasKit: false, hasVest: false,
  }));
  return {
    seed: seed || 1, rng,
    round: 1,
    scores: { [SUN]: 0, [BED]: 0 },
    phase: 'buy',       // buy | live | end | matchend
    phaseT: BUY_TIME,   // seconds left in this phase
    roundTime: ROUND_TIME,
    attackTeam: SUN,    // swaps after round 6
    plan: 'DEFAULT',
    playerRole: 'ENTRY',
    players,
    device: {
      state: 'carried', // carried | dropped | planted | exploded | defused
      carrierId: 'oren',
      lastCarrierId: null,
      site: null,       // 'A' | 'B' once planted
      x: 0, z: 0,       // ground position when dropped/planted
      timer: DEVICE_TIME,
      plantT: 0, plantBy: null,
      defuseT: 0, defuseBy: null,
    },
    killfeed: [],       // { killer, weapon, victim, hs, t } newest last
    radio: [],          // { name, role, text, t } newest last
    sounds: [],         // { x, z, kind, t } hearing events for bots
    roundWinner: null, roundReason: '',
    roundMvp: null,
    matchWinner: null, // team name or 'DRAW'
    plantedThisRound: false,
    time: 0,            // sim seconds elapsed (fixed-step only)
  };
}

export function playerById(m, id) { return m.players.find((p) => p.id === id); }
export function teamOf(m, team) { return m.players.filter((p) => p.team === team); }
export function aliveOf(m, team) { return m.players.filter((p) => p.team === team && p.alive); }
export function attackTeam(m) { return m.attackTeam; }
export function defendTeam(m) { return m.attackTeam === SUN ? BED : SUN; }

export function addKillfeed(m, killer, weapon, victim, hs) {
  m.killfeed.push({ killer, weapon, victim, hs: !!hs, t: m.time });
  if (m.killfeed.length > 8) m.killfeed.shift();
}
export function addRadio(m, name, role, text) {
  m.radio.push({ name, role, text, t: m.time });
  if (m.radio.length > 8) m.radio.shift();
}
export function addSound(m, x, z, kind) { m.sounds.push({ x, z, kind, t: m.time }); }

// Headshot share for the scoreboard HS% column.
export function hsPercent(p) { return p.kills > 0 ? Math.round((100 * p.headshots) / p.kills) : 0; }

// Damage application: armour absorbs 50% of body damage; helmet blocks the
// one-tap headshot bonus from pistols/SMG (headshot multiplier already applied
// by the caller for the weapon class). Returns true when the victim died.
export function applyDamage(m, victim, rawDmg, attacker, isHead, weaponName) {
  if (!victim.alive) return false;
  let dmg = rawDmg;
  if (victim.armour > 0) {
    const absorbed = Math.min(victim.armour, Math.floor(dmg / 2));
    victim.armour -= absorbed;
    dmg -= absorbed;
  }
  victim.hp -= dmg;
  if (attacker) {
    attacker.damage += dmg;
    attacker.rDamage += dmg;
    attacker.hits += 1;
    if (isHead) attacker.headshots += 1;
  }
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths += 1;
    if (attacker && attacker !== victim) {
      attacker.kills += 1;
      attacker.rKills += 1;
      attacker.money = Math.min(MONEY_CAP, attacker.money + KILL_REWARD);
    }
    addKillfeed(m, attacker ? attacker.name : '—', weaponName || '—', victim.name, isHead);
    // The device drops where its carrier died.
    if (m.device.state === 'carried' && m.device.carrierId === victim.id) {
      m.device.state = 'dropped';
      m.device.lastCarrierId = victim.id;
      m.device.carrierId = null;
    }
    return true;
  }
  return false;
}

// Pick the round MVP: kills, then damage, then plant/defuse.
export function roundMvp(m) {
  let best = null;
  let bestScore = -1;
  for (const p of m.players) {
    const s = p.rKills * 100 + p.rDamage + (p.rPlanted ? 150 : 0) + (p.rDefused ? 200 : 0);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

function awardRoundMoney(m, winner) {
  for (const p of m.players) {
    let gain = p.team === winner ? WIN_REWARD : LOSS_REWARD;
    if (p.team !== winner && p.team === m.attackTeam && m.plantedThisRound) gain += PLANT_BONUS;
    p.money = Math.min(MONEY_CAP, p.money + gain);
  }
}

export function endRound(m, winner, reason) {
  if (m.phase === 'end' || m.phase === 'matchend') return;
  m.scores[winner] += 1;
  m.roundWinner = winner;
  m.roundReason = reason;
  const mvp = roundMvp(m);
  if (mvp) { mvp.mvps += 1; m.roundMvp = mvp; }
  awardRoundMoney(m, winner);
  m.phase = 'end';
  m.phaseT = END_TIME;
  // Match decided? First to 7, or higher score after 12 rounds, else draw.
  const sA = m.scores[SUN];
  const sB = m.scores[BED];
  if (sA >= WIN_TARGET || sB >= WIN_TARGET || m.round >= MAX_ROUNDS) {
    m.matchWinner = sA === sB ? 'DRAW' : (sA > sB ? SUN : BED);
  }
}

// Called when the end banner has run its course.
export function advanceAfterEnd(m) {
  if (m.matchWinner) { m.phase = 'matchend'; return; }
  m.round += 1;
  if (m.round === 7) m.attackTeam = m.attackTeam === SUN ? BED : SUN;
  startRound(m);
}

export function startRound(m) {
  m.phase = 'buy';
  m.phaseT = BUY_TIME;
  m.roundTime = ROUND_TIME;
  m.roundWinner = null;
  m.roundReason = '';
  m.roundMvp = null;
  m.plantedThisRound = false;
  m.plan = PLANS[Math.floor(m.rng() * PLANS.length)];
  m.playerRole = PLAYER_ROLES[(m.round - 1) % PLAYER_ROLES.length];
  // The carrier is the first alive attacker bot; the player picks it up by walking over it.
  const attackers = teamOf(m, m.attackTeam).filter((p) => !p.human);
  const carrier = attackers[0] || teamOf(m, m.attackTeam)[0];
  m.device = {
    state: 'carried', carrierId: carrier.id, lastCarrierId: null, site: null, x: 0, z: 0,
    timer: DEVICE_TIME, plantT: 0, plantBy: null, defuseT: 0, defuseBy: null,
  };
  for (const p of m.players) {
    p.alive = true; p.hp = 100;
    p.rKills = 0; p.rDamage = 0; p.rPlanted = false; p.rDefused = false;
    // Armour and helmet persist across rounds; utilities are spent per round.
    p.utils = { frag: 0, smoke: 0, flash: 0, flare: 0 };
    p.hasKit = false;
  }
  m.sounds.length = 0;
}

// Round-end conditions, checked every fixed step during live play.
export function checkRoundEnd(m) {
  if (m.phase !== 'live') return;
  const aAlive = aliveOf(m, m.attackTeam).length;
  const dAlive = aliveOf(m, defendTeam(m)).length;
  if (m.device.state === 'planted') {
    if (dAlive === 0) endRound(m, m.attackTeam, 'DEVICE ARMED — DEFENDERS ELIMINATED');
    return; // after a plant, only the device timer or a defuse ends the round
  }
  if (aAlive === 0 && dAlive === 0) { endRound(m, defendTeam(m), 'MUTUAL ELIMINATION'); return; }
  if (aAlive === 0) { endRound(m, defendTeam(m), 'ATTACKERS ELIMINATED'); return; }
  if (dAlive === 0) { endRound(m, m.attackTeam, 'DEFENDERS ELIMINATED'); return; }
  if (m.roundTime <= 0) endRound(m, defendTeam(m), 'TIME EXPIRED — DEVICE NEVER PLANTED');
}

// Advance match timers by one fixed step. Returns 'plant' | 'explode' | null
// so the caller can fire the matching sound and banner.
export function stepMatch(m, dt) {
  m.time += dt;
  if (m.phase === 'buy') {
    m.phaseT -= dt;
    if (m.phaseT <= 0) { m.phase = 'live'; m.phaseT = 0; }
    return null;
  }
  if (m.phase === 'live') {
    if (m.device.state !== 'planted') m.roundTime -= dt;
    if (m.device.state === 'planted') {
      m.device.timer -= dt;
      if (m.device.timer <= 0) {
        m.device.state = 'exploded';
        endRound(m, m.attackTeam, 'DEVICE DETONATED');
        return 'explode';
      }
    }
    checkRoundEnd(m);
    return null;
  }
  if (m.phase === 'end') {
    m.phaseT -= dt;
    if (m.phaseT <= 0) advanceAfterEnd(m);
    return null;
  }
  return null;
}
