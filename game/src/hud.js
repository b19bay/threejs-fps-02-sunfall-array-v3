// hud.js — the whole DOM HUD: minimap canvas, kill feed, radio feed, health /
// armour / funds, weapon + ammo + slots, crosshair, banners, the five-column
// buy menu with numeric stats, and the scoreboard with the HS% column.
// Banner expiry runs on sim time, so a paused staged scene never loses one.
import * as THREE from 'three';
import { SUN, BED, hsPercent, aliveOf } from './sim.js';
import { WEAPONS, UTILITIES, GEAR, BUY_COLUMNS, BUY_HOTKEYS, statsLine, buyItem } from './weapon.js';
import { SITES, zoneAt, hasLOS, BOUNDS } from './world.js';

const $ = (id) => document.getElementById(id);
const TEAM_CSS = { SUNSPIRE: '#ffa726', BEDROCK: '#29b6d8' };

export function createHUD(game) {
  const hud = {
    buyOpen: false,
    scoreOpen: false,
    bannerUntil: 0,
    lastFeedSig: '',
    lastRadioSig: '',
    lastScoreSig: '',
    dmgPool: [],
    hitT: 0,
  };
  const m = game.match;

  // ---- Minimap ----
  const mm = $('minimap');
  const mg = mm.getContext('2d');
  const MM_W = 180;
  const MM_H = 180;
  const mx = (x) => ((x - BOUNDS.x0) / (BOUNDS.x1 - BOUNDS.x0)) * MM_W;
  const mz = (z) => ((z - BOUNDS.z0) / (BOUNDS.z1 - BOUNDS.z0)) * MM_H;

  function drawMinimap() {
    mg.clearRect(0, 0, MM_W, MM_H);
    mg.fillStyle = 'rgba(18,14,8,0.78)';
    mg.fillRect(0, 0, MM_W, MM_H);
    // Walls and big cover as light blocks.
    mg.fillStyle = 'rgba(245,234,214,0.5)';
    for (const b of game.colliders) {
      if (b.top < 1.5) continue;
      mg.fillRect(mx(b.x0), mz(b.z0), Math.max(1, mx(b.x1) - mx(b.x0)), Math.max(1, mz(b.z1) - mz(b.z0)));
    }
    // Sites.
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      mg.strokeStyle = '#ff9a3c';
      mg.lineWidth = 2;
      mg.beginPath();
      mg.arc(mx(s.x), mz(s.z), 8, 0, Math.PI * 2);
      mg.stroke();
      mg.fillStyle = '#ff9a3c';
      mg.font = 'bold 11px Arial';
      mg.textAlign = 'center';
      mg.fillText(key, mx(s.x), mz(s.z) - 11);
    }
    mg.fillStyle = 'rgba(245,234,214,0.75)';
    mg.font = '9px Arial';
    mg.fillText('ARRAY FIELD', mx(26), mz(-14));
    mg.fillText('CONTROL BLOCK', mx(30), mz(30));
    mg.fillText('PANEL ROWS', mx(-6), mz(-10));
    mg.fillText('WATER TOWER', mx(16), mz(11));
    // The planted device pulses red; the carrier is a yellow diamond.
    const d = m.device;
    if (d.state === 'planted') {
      const pulse = 0.6 + 0.4 * Math.sin(m.time * 6);
      mg.fillStyle = `rgba(255,60,40,${pulse})`;
      mg.beginPath();
      mg.arc(mx(d.x), mz(d.z), 5, 0, Math.PI * 2);
      mg.fill();
    } else if (d.state === 'dropped') {
      mg.fillStyle = '#ffd23c';
      mg.fillRect(mx(d.x) - 3, mz(d.z) - 3, 6, 6);
    }
    // Dots: teammates always; enemies only while a teammate sees them.
    for (const a of game.actors) {
      if (!a.alive) continue;
      const isMate = a.rec.team === game.player.rec.team;
      let show = isMate;
      if (!isMate) {
        // Seen by the player (line of sight) or targeted by a teammate bot.
        const eyeY = game.player.pos.y + 1.6;
        const seenByPlayer = hasLOS(game.colliders, game.fx.smokes, game.player.pos.x, eyeY, game.player.pos.z, a.pos.x, a.pos.y + 1.2, a.pos.z)
          && Math.hypot(a.pos.x - game.player.pos.x, a.pos.z - game.player.pos.z) < 60;
        const seenByMate = game.actors.some((b) => b.bot && b.rec.team === game.player.rec.team && b.bot.targetId === a.rec.id);
        show = seenByPlayer || seenByMate;
      }
      if (!show) continue;
      const px = mx(a.pos.x);
      const py = mz(a.pos.z);
      mg.fillStyle = TEAM_CSS[a.rec.team];
      mg.beginPath();
      mg.arc(px, py, a.human ? 4 : 3, 0, Math.PI * 2);
      mg.fill();
      if (a.human) {
        mg.strokeStyle = '#ffffff';
        mg.lineWidth = 1;
        mg.stroke();
        // Player view cone.
        const a0 = Math.atan2(Math.cos(a.yaw), Math.sin(a.yaw)) - 0.45;
        mg.fillStyle = 'rgba(255,255,255,0.25)';
        mg.beginPath();
        mg.moveTo(px, py);
        mg.arc(px, py, 14, a0, a0 + 0.9);
        mg.closePath();
        mg.fill();
      }
      if (d.state === 'carried' && d.carrierId === a.rec.id) {
        mg.fillStyle = '#ffd23c';
        mg.fillRect(px - 2, py - 9, 4, 4);
      }
    }
  }

  // ---- Kill feed: killer, weapon, HS marker, victim. Last 4 lines. ----
  function renderKillfeed() {
    const sig = m.killfeed.map((k) => `${k.killer}|${k.weapon}|${k.victim}|${k.hs}`).join(';');
    if (sig === hud.lastFeedSig) return;
    hud.lastFeedSig = sig;
    const el = $('killfeed');
    el.innerHTML = '';
    for (const k of m.killfeed.slice(-4)) {
      const row = document.createElement('div');
      row.className = 'kf-row';
      const kc = document.createElement('span');
      kc.textContent = k.killer;
      kc.style.color = TEAM_CSS[teamOfName(k.killer)] || '#f5ead6';
      const w = document.createElement('span');
      w.className = 'kf-weapon';
      w.textContent = ` ${k.weapon}${k.hs ? ' HS' : ''} `;
      if (k.hs) w.classList.add('hs');
      const v = document.createElement('span');
      v.textContent = k.victim;
      v.style.color = TEAM_CSS[teamOfName(k.victim)] || '#f5ead6';
      row.append(kc, w, v);
      el.appendChild(row);
    }
  }
  function teamOfName(name) {
    const p = m.players.find((x) => x.name === name);
    return p ? p.team : null;
  }

  // ---- Radio feed: last 4 callouts with bot name + role. ----
  function renderRadio() {
    const sig = m.radio.map((r) => `${r.name}|${r.text}`).join(';');
    if (sig === hud.lastRadioSig) return;
    hud.lastRadioSig = sig;
    const el = $('radiofeed');
    el.innerHTML = '';
    for (const r of m.radio.slice(-4)) {
      const row = document.createElement('div');
      row.className = 'radio-row';
      const who = document.createElement('span');
      who.className = 'radio-who';
      who.textContent = `${r.name} (${r.role})`;
      who.style.color = TEAM_CSS[teamOfName(r.name)] || '#f5ead6';
      const txt = document.createElement('span');
      txt.textContent = `: ${r.text}`;
      row.append(who, txt);
      el.appendChild(row);
    }
  }

  // ---- Buy menu: five columns, thirteen items, numeric stats on every card. ----
  function buildBuyMenu() {
    const grid = $('buy-grid');
    grid.innerHTML = '';
    let idx = 0;
    for (const col of BUY_COLUMNS) {
      const colEl = document.createElement('div');
      colEl.className = 'buy-col';
      const title = document.createElement('div');
      title.className = 'buy-col-title';
      title.textContent = col.title;
      colEl.appendChild(title);
      for (const item of col.items) {
        const card = document.createElement('div');
        card.className = 'buy-card';
        card.dataset.kind = item.kind;
        card.dataset.id = item.id;
        card.dataset.idx = String(idx);
        const key = document.createElement('div');
        key.className = 'buy-key';
        key.textContent = BUY_HOTKEYS[idx];
        const name = document.createElement('div');
        name.className = 'buy-name';
        const price = document.createElement('div');
        price.className = 'buy-price';
        const stats = document.createElement('div');
        stats.className = 'buy-stats';
        const note = document.createElement('div');
        note.className = 'buy-note';
        const state = document.createElement('div');
        state.className = 'buy-state';
        if (item.kind === 'weapon') {
          const w = WEAPONS[item.id];
          name.textContent = w.name;
          price.textContent = `$${w.price}`;
          stats.textContent = statsLine(w);
          note.textContent = w.note;
        } else if (item.kind === 'gear') {
          const g = GEAR[item.id];
          name.textContent = g.name;
          price.textContent = `$${g.price}`;
          stats.textContent = g.defenceOnly ? 'DEFENCE ONLY' : 'PROTECTION';
          note.textContent = g.note;
        } else {
          const u = UTILITIES[item.id];
          name.textContent = u.name;
          price.textContent = `$${u.price}`;
          stats.textContent = 'THROWABLE · 1 PER ROUND';
          note.textContent = u.note;
        }
        card.append(key, name, price, stats, note, state);
        card.addEventListener('click', () => {
          const r = buyItem(game, game.player, item.kind, item.id);
          if (r.ok) game.audio.buy();
          refreshBuyMenu();
          hud.update();
        });
        colEl.appendChild(card);
        idx += 1;
      }
      grid.appendChild(colEl);
    }
  }

  function refreshBuyMenu() {
    const rec = game.player.rec;
    $('buy-funds').textContent = `$${rec.money.toLocaleString('en-US')}`;
    for (const card of document.querySelectorAll('.buy-card')) {
      const { kind, id } = card.dataset;
      const state = card.querySelector('.buy-state');
      card.classList.remove('owned', 'unaffordable', 'defence-only');
      let label = '';
      if (kind === 'weapon') {
        const w = WEAPONS[id];
        const owned = id === rec.primary || id === rec.secondary;
        if (owned) { card.classList.add('owned'); label = 'OWNED'; }
        else if (rec.money < w.price) { card.classList.add('unaffordable'); label = 'Too expensive'; }
      } else if (kind === 'gear') {
        const g = GEAR[id];
        const owned = (id === 'vest' && rec.hasVest) || (id === 'vestHelmet' && rec.hasVest && rec.helmet) || (id === 'kit' && rec.hasKit);
        if (g.defenceOnly && m.attackTeam === rec.team) { card.classList.add('defence-only'); label = 'DEFENCE'; }
        else if (owned) { card.classList.add('owned'); label = 'OWNED'; }
        else if (rec.money < g.price) { card.classList.add('unaffordable'); label = 'Too expensive'; }
      } else {
        if (rec.utils[id] >= 1) { card.classList.add('owned'); label = 'OWNED'; }
        else if (rec.money < UTILITIES[id].price) { card.classList.add('unaffordable'); label = 'Too expensive'; }
      }
      state.textContent = label;
    }
  }

  // ---- Scoreboard: Name / Role / K / A / D / HS% / DMG / MVP / Funds ----
  function teamTable(team) {
    const rows = m.players.filter((p) => p.team === team)
      .slice()
      .sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    let html = `<div class="sb-team" style="--tc:${TEAM_CSS[team]}"><div class="sb-team-head">${team} — ${m.scores[team]}</div>`
      + '<table><tr><th>NAME</th><th>ROLE</th><th>K</th><th>A</th><th>D</th><th>HS%</th><th>DMG</th><th>MVP</th><th>FUNDS</th></tr>';
    for (const p of rows) {
      const mvp = m.roundMvp && m.roundMvp.id === p.id;
      html += `<tr class="${mvp ? 'mvp-row' : ''}${p.human ? ' you-row' : ''}">`
        + `<td>${p.name}${mvp ? ' ★ MVP' : ''}${p.human ? ' (YOU)' : ''}</td><td>${p.role}</td>`
        + `<td>${p.kills}</td><td>${p.assists}</td><td>${p.deaths}</td><td>${hsPercent(p)}%</td>`
        + `<td>${p.damage}</td><td>${p.mvps}</td><td>$${p.money.toLocaleString('en-US')}</td></tr>`;
    }
    return `${html}</table></div>`;
  }

  function renderScoreboard() {
    const sig = `${m.round}|${m.scores[SUN]}|${m.scores[BED]}|${m.players.map((p) => `${p.kills},${p.deaths},${p.damage},${p.money}`).join(';')}|${m.phase}`;
    if (sig === hud.lastScoreSig && $('scoreboard').style.display !== 'none') return;
    hud.lastScoreSig = sig;
    $('score-table').innerHTML = teamTable(SUN) + teamTable(BED);
    if (m.phase === 'matchend') {
      const w = m.matchWinner;
      const title = w === 'DRAW'
        ? 'DRAW — 6 TO 6'
        : `${w} WIN THE MATCH — ${m.scores[SUN]} TO ${m.scores[BED]}`;
      $('match-banner').textContent = title;
      $('match-sub').textContent = 'Click or press R to play again';
      $('match-banner').style.display = 'block';
      $('match-sub').style.display = 'block';
    } else {
      $('match-banner').style.display = 'none';
      $('match-sub').style.display = 'none';
    }
  }

  // ---- Damage numbers: pooled divs projected from world points. ----
  const dmgLayer = $('damage-layer');
  for (let i = 0; i < 12; i++) {
    const el = document.createElement('div');
    el.className = 'dmg-num';
    el.style.display = 'none';
    dmgLayer.appendChild(el);
    hud.dmgPool.push({ el, x: 0, y: 0, z: 0, y0: 0, born: -100, t: 0 });
  }
  const _v = new THREE.Vector3();
  hud.damageNumber = (x, y, z, text) => {
    const d = hud.dmgPool.find((e) => e.t <= 0) || hud.dmgPool[0];
    d.x = x; d.y = y; d.z = z;
    d.y0 = y;
    d.born = m.time; // sim time: a paused staged scene holds the number
    d.t = 0.9;
    d.el.textContent = text;
    d.el.className = `dmg-num${text.startsWith('HEAD') ? ' head' : ''}`;
    d.el.style.display = 'block';
  };
  function updateDamageNumbers() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const d of hud.dmgPool) {
      d.t = 0.9 - (m.time - (d.born || 0));
      if (d.t <= 0) { d.el.style.display = 'none'; continue; }
      const y = d.y0 + (m.time - d.born) * 0.7;
      _v.set(d.x, y, d.z).project(game.camera);
      if (_v.z > 1) { d.el.style.display = 'none'; continue; }
      d.el.style.left = `${((_v.x + 1) / 2) * w}px`;
      d.el.style.top = `${((-_v.y + 1) / 2) * h}px`;
      d.el.style.opacity = String(Math.min(1, d.t / 0.4));
    }
  }

  // ---- Banners, action bar, overlays ----
  hud.showBanner = (text, sub, dur) => {
    $('banner').textContent = text;
    $('banner-sub').textContent = sub || '';
    $('banner-wrap').style.display = 'block';
    hud.bannerUntil = m.time + (dur || 3);
  };
  hud.hideBanner = () => { $('banner-wrap').style.display = 'none'; };
  hud.setAction = (label, frac) => {
    if (!label) { $('action-wrap').style.display = 'none'; return; }
    $('action-wrap').style.display = 'block';
    $('action-label').textContent = label;
    $('action-fill').style.width = `${Math.round(frac * 100)}%`;
  };
  hud.hitmarker = (head) => {
    hud.hitT = 0.15;
    $('hitmarker').className = head ? 'show head' : 'show';
  };

  hud.openBuy = () => {
    hud.buyOpen = true;
    $('buy-menu').style.display = 'block';
    // The menu owns the frame: park the panels it would overlap.
    for (const id of ['top-center', 'minimap-wrap', 'radiofeed', 'killfeed', 'plan-line', 'banner-wrap']) {
      $(id).style.display = 'none';
    }
    refreshBuyMenu();
    if (document.pointerLockElement) document.exitPointerLock();
  };
  hud.closeBuy = () => {
    hud.buyOpen = false;
    $('buy-menu').style.display = 'none';
    for (const id of ['top-center', 'minimap-wrap', 'radiofeed', 'killfeed', 'plan-line']) {
      $(id).style.display = 'block';
    }
  };
  hud.setScoreboard = (open) => {
    hud.scoreOpen = open;
    $('scoreboard').style.display = open ? 'block' : 'none';
    if (open) renderScoreboard();
  };

  // ---- Slots bar ----
  function renderSlots() {
    const rec = game.player.rec;
    const w = game.player.weap;
    const slots = $('slots');
    const defs = [
      ['1', rec.primary || '—'],
      ['2', rec.secondary],
      ['3', 'RASP'],
      ['4', `FRAG${rec.utils.frag ? ' ×1' : ''}`],
      ['5', `SMOKE${rec.utils.smoke ? ' ×1' : ''}`],
      ['6', `FLASH${rec.utils.flash ? ' ×1' : ''}`],
      ['7', `FLARE${rec.utils.flare ? ' ×1' : ''}`],
    ];
    const cur = { 1: rec.primary, 2: rec.secondary, 3: 'RASP', 4: 'frag', 5: 'smoke', 6: 'flash', 7: 'flare' };
    slots.innerHTML = defs.map(([n, label], i) => {
      const active = w.current === cur[Number(n)] ? ' active' : '';
      const empty = (i === 0 && !rec.primary) || (i >= 3 && !rec.utils[['frag', 'smoke', 'flash', 'flare'][i - 3]]) ? ' empty' : '';
      return `<div class="slot${active}${empty}"><span class="slot-key">${n}</span>${label}</div>`;
    }).join('');
  }

  function renderPips(el, team) {
    const alive = aliveOf(m, team).length;
    let html = '';
    for (let i = 0; i < 5; i++) html += `<span class="pip${i < alive ? ' alive' : ''}"></span>`;
    el.innerHTML = html;
  }

  // ---- Main per-frame update ----
  hud.update = (dt) => {
    const rec = game.player.rec;
    const w = game.player.weap;
    drawMinimap();
    renderKillfeed();
    renderRadio();
    $('zone-label').textContent = zoneAt(game.player.pos.x, game.player.pos.z);
    $('score-sun').textContent = m.scores[SUN];
    $('score-bed').textContent = m.scores[BED];
    renderPips($('pips-sun'), SUN);
    renderPips($('pips-bed'), BED);
    $('side-sun').textContent = m.attackTeam === SUN ? 'ATTACK' : 'DEFEND';
    $('side-bed').textContent = m.attackTeam === BED ? 'ATTACK' : 'DEFEND';
    $('round-label').textContent = m.phase === 'matchend' ? 'FINAL SCORE' : `ROUND ${m.round} / 12`;
    const t = m.device.state === 'planted' ? m.device.timer : m.roundTime;
    const disp = Math.ceil(Math.max(0, t)); // ceil: the timer and the device line agree
    const mins = Math.floor(disp / 60);
    const secs = disp % 60;
    const timerEl = $('round-timer');
    timerEl.textContent = m.phase === 'matchend' ? '—' : `${mins}:${String(secs).padStart(2, '0')}`;
    timerEl.classList.toggle('danger', t < 15 && m.phase !== 'matchend');
    const d = m.device;
    $('device-line').textContent = m.phase === 'matchend' ? '—' : d.state === 'planted'
      ? `DEVICE ARMED · SITE ${d.site} — ${Math.ceil(d.timer)}s`
      : d.state === 'dropped'
        ? `DEVICE DROPPED · ${zoneAt(d.x, d.z)}`
        : d.state === 'carried'
          ? `DEVICE: CARRIED BY ${(m.players.find((p) => p.id === d.carrierId) || {}).name || '—'}`.toUpperCase()
          : 'DEVICE: —';
    // Health / armour / funds.
    $('health-num').textContent = Math.max(0, rec.hp);
    $('health-fill').style.width = `${Math.max(0, rec.hp)}%`;
    $('health-fill').classList.toggle('low', rec.hp <= 25);
    $('armour-num').textContent = rec.armour + (rec.helmet ? ' +H' : '');
    $('armour-fill').style.width = `${Math.min(100, rec.armour)}%`;
    $('funds').textContent = `$${rec.money.toLocaleString('en-US')}`;
    // Weapon / ammo.
    const cur = w.current;
    const def = WEAPONS[cur];
    $('weapon-name').textContent = def ? def.name : (UTILITIES[cur] ? UTILITIES[cur].name : cur);
    $('weapon-mode').textContent = def ? def.mode : 'THROWABLE';
    if (def && cur !== 'RASP') {
      $('ammo-big').textContent = `${w.mag[cur]} / ${w.reserve[cur]}`;
      $('low-ammo').style.display = w.mag[cur] === 0 ? 'block' : 'none';
    } else if (cur === 'RASP') {
      $('ammo-big').textContent = '—';
      $('low-ammo').style.display = 'none';
    } else {
      $('ammo-big').textContent = `×${rec.utils[cur] || 0}`;
      $('low-ammo').style.display = 'none';
    }
    if (w.reloading) {
      $('reload-wrap').style.display = 'block';
      $('reload-fill').style.width = `${Math.round((w.reloading.t / w.reloading.total) * 100)}%`;
    } else {
      $('reload-wrap').style.display = 'none';
    }
    renderSlots();
    // Crosshair bloom from spread heat + movement.
    const speed = Math.hypot(game.player.vel.x, game.player.vel.z);
    const gap = 5 + w.heat * 12 + speed * 1.1 + (game.player.scoped ? -3 : 0);
    $('crosshair').style.setProperty('--gap', `${Math.max(3, gap).toFixed(1)}px`);
    $('crosshair').style.display = game.player.scoped ? 'none' : 'block';
    $('scope-overlay').style.display = game.player.scoped ? 'block' : 'none';
    if (hud.hitT > 0) {
      hud.hitT -= dt;
      if (hud.hitT <= 0) $('hitmarker').className = '';
    }
    // Banner expiry on sim time.
    if (m.time > hud.bannerUntil && hud.bannerUntil > 0) {
      $('banner-wrap').style.display = 'none';
      hud.bannerUntil = 0;
    }
    // Plan line during the buy phase.
    $('plan-line').textContent = m.phase === 'buy'
      ? `PLAN: ${m.plan} — YOU: ${m.playerRole}`
      : '';
    // Flash / flare blind overlays.
    $('flash-overlay').style.opacity = String(Math.min(1, game.flashBlind / 1.2));
    $('flare-overlay').style.opacity = String(Math.min(0.85, game.flareBlind / 1.2));
    // Mute + dead indicators.
    $('mute-indicator').style.display = game.audio.muted ? 'block' : 'none';
    $('dead-msg').style.display = !game.player.alive && m.phase === 'live' ? 'block' : 'none';
    // Click-to-play hint (never in shot mode: no pointer lock there).
    $('center-msg').style.display = !game.shotMode && !document.pointerLockElement && !hud.buyOpen && !hud.scoreOpen && m.phase !== 'matchend'
      ? 'block' : 'none';
    if (hud.scoreOpen) renderScoreboard();
    updateDamageNumbers();
  };

  buildBuyMenu();
  return hud;
}
