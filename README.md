# SUNFALL ARRAY — golden-hour 5v5 solar-farm tactical FPS

A Counter-Strike-STYLE round-based tactical FPS in the browser, built on
three.js 0.187.0 with no build step and no network requests. One original
map: a golden-hour desert solar farm with three lanes (A-LONG, MID, B-LINK)
and two device sites (ARRAY FIELD, CONTROL BLOCK). You + 4 bot teammates vs
5 bot enemies, 12 rounds max, first to 7, sides swap after round 6.

## How to run

```sh
node serve.ts --port 8091
# open http://127.0.0.1:8091/ in desktop Chrome, click to play
```

Hand in: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` writes
`out/dossier.json`, `out/game/` and `out/screenshots/`.

## Controls

WASD move · mouse look (click to lock) · Shift walk quietly · Space jump ·
C / Ctrl crouch · R reload · 1–7 weapons and utilities · B buy menu ·
E plant / defuse / pick up · Tab scoreboard · M mute · right mouse scopes
the LONGSHOT.

## What's in the game

- **Gunplay:** hitscan with spread and a learnable recoil pattern; standing
  still and crouching tighten spread, moving and jumping widen it. Headshots
  deal double damage (triple for the LONGSHOT). Tracers, muzzle flash,
  hitmarkers, floating damage numbers.
- **Weapons:** SP-9, REX .45, WASP-9, MAUL-12, TALON AR, LONGSHOT, knife
  RASP — every buy card shows its numeric DMG / RPM / MAG stats.
- **Utilities:** Frag, Smoke (blocks sight — bots will not shoot through
  it), Flash, and the Flare (burns 6 s, blinds anyone facing it, lights
  dark corners). Thrown with a visible arc preview.
- **Tactics:** plant/defuse the device (3 s / 7 s, 3.5 s with a kit),
  CS-style economy ($800 start, $300 per kill, $3,250 round win, $16,000
  cap), bots with roles, waypoint routes, holds, peeks, hearing and radio
  callouts, a team plan each round.
- **HUD:** live minimap with zones, sites and seen-enemy dots, kill feed
  with headshot markers, radio feed, segmented alive pips beside the score,
  health / armour / funds, weapon slots, and a scoreboard with K / A / D /
  HS% / DMG / MVP / Funds.

## Deterministic screenshots

`?shot=combat|buy|objective|score&seed=N` stages a scene with the game's own
systems (fixed seed, fixed-step sim, then paused) and sets
`window.__shotReady` when the frame is ready for capture. See `shots.json`.

## Layout

- `game/index.html` — page, import map, HUD markup and CSS
- `game/src/main.js` — bootstrap, fixed-step loop, input, viewmodel, staging
- `game/src/world.js` — the SUNFALL ARRAY map, collision, zones, routes
- `game/src/sim.js` — match state, rounds, economy, damage, MVP
- `game/src/player.js` — movement, look, collision
- `game/src/weapon.js` — weapons, utilities, shooting, tracers, effects
- `game/src/bots.js` — bot AI: roles, routes, holds, hearing, radio
- `game/src/hud.js` — HUD DOM, minimap, buy menu, scoreboard
- `game/src/audio.js` — synthesized WebAudio blips
- `game/vendor/three/` — three.js 0.187.0, byte-for-byte from the kit

License: MIT (see LICENSE).
