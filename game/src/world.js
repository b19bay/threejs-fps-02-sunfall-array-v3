// world.js — SUNFALL ARRAY: a golden-hour desert solar farm. One original map.
// Geometry, collision boxes, named zones, waypoint routes, sky and lighting.
// Heading convention: forward = (sin(yaw), 0, cos(yaw)); yaw=PI/2 faces +X (east).
import * as THREE from 'three';

export const BOUNDS = { x0: -48, x1: 48, z0: -36, z1: 36 };
export const SITES = {
  A: { x: 26, z: -24, name: 'ARRAY FIELD' },
  B: { x: 24, z: 18, name: 'CONTROL BLOCK' },
};
export const SITE_RADIUS = 6;
export const SPAWNS = {
  SUNSPIRE: { x: -42, z: 0, yaw: Math.PI / 2 },
  BEDROCK: { x: 42, z: 0, yaw: -Math.PI / 2 },
};
// Raised maintenance platform (walkable via the ramp on its west side).
export const PLATFORM = { x0: 4, x1: 12, z0: -5, z1: -1, h: 2.2 };
export const RAMP = { x0: 0, x1: 4, z0: -5, z1: -1 };

// Ground height: 0 everywhere except the platform and its ramp.
export function groundHeight(x, z) {
  if (x >= PLATFORM.x0 && x <= PLATFORM.x1 && z >= PLATFORM.z0 && z <= PLATFORM.z1) return PLATFORM.h;
  if (x >= RAMP.x0 && x <= RAMP.x1 && z >= RAMP.z0 && z <= RAMP.z1) {
    return PLATFORM.h * (x - RAMP.x0) / (RAMP.x1 - RAMP.x0);
  }
  return 0;
}

// Named zones, first match wins (checked in order).
const ZONES = [
  ['WATER TOWER', 10, 10, 22, 22],
  ['ARRAY FIELD', 16, -32, 40, -14],
  ['CONTROL BLOCK', 16, 8, 44, 32],
  ['PANEL ROWS', -24, -14, 16, -6],
  ['PANEL ROWS', -24, 6, 16, 14],
  ['PERIMETER ROAD', -44, -36, 44, -27],
  ['PIPE RUN', -44, 26, 44, 34],
  ['SPAWN SUNSPIRE', -48, -12, -36, 12],
  ['SPAWN BEDROCK', 36, -12, 48, 12],
  ['MAINTENANCE YARD', -36, -6, 16, 6],
];
export function zoneAt(x, z) {
  for (const [name, x0, z0, x1, z1] of ZONES) {
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return name;
  }
  return 'OPEN GROUND';
}

// Waypoint routes. Attackers start at the west spawn; defenders at the east.
export const ROUTES = {
  atkA: [[-38, 0], [-30, -22], [-12, -30], [6, -30], [18, -27], [24, -24]],
  atkMidA: [[-38, 0], [-20, 0], [-6, 0], [6, 0], [14, -6], [20, -14], [24, -22]],
  atkMidB: [[-38, 0], [-20, 0], [-6, 0], [6, 0], [12, 6], [18, 12], [22, 17]],
  atkB: [[-38, 0], [-30, 22], [-12, 28], [4, 28], [14, 26], [20, 21], [24, 18]],
  defA: [[38, 0], [34, -10], [30, -18], [29, -22]],
  defB: [[38, 0], [34, 8], [30, 14], [27, 19]],
  defMid: [[38, 0], [26, 0], [20, 0]],
  rotAtoB: [[29, -22], [32, -8], [32, 6], [28, 16]],
  rotBtoA: [[27, 19], [32, 6], [32, -8], [29, -22]],
};
// Hold positions: bots pause here to check an angle. yaw faces the watched lane.
export const HOLDS = [
  { name: 'A SITE', x: 29, z: -22, yaw: -Math.PI / 2 },
  { name: 'A LONG', x: 14, z: -29, yaw: -Math.PI / 2 },
  { name: 'B SITE', x: 27, z: 19, yaw: -Math.PI / 2 },
  { name: 'B LINK', x: 12, z: 27, yaw: -Math.PI / 2 },
  { name: 'MID', x: 18, z: 0, yaw: -Math.PI / 2 },
  { name: 'TOWER', x: 15, z: 13, yaw: Math.PI },
];

function textTexture(text, w, h, bg, fg, font) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  // Canvas y maps to sphere v = 1 - y, so the horizon (v 0.5) is canvas 0.5:
  // the warm band sits AT eye level, blue above, sand below it.
  grad.addColorStop(0.0, '#5f8fc4');   // zenith: soft blue
  grad.addColorStop(0.30, '#8fb4d8');  // high sky
  grad.addColorStop(0.44, '#e8b07e');  // golden band
  grad.addColorStop(0.50, '#ff9a5c');  // horizon: warm orange-pink
  grad.addColorStop(0.54, '#e8b98a');  // haze at the ground line
  grad.addColorStop(0.62, '#c9a06b');  // below the horizon: sand
  grad.addColorStop(1.0, '#c9a06b');
  g.fillStyle = grad; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.25, 'rgba(255,200,120,0.85)');
  grad.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Ray vs axis-aligned wall boxes. Returns the hit distance or Infinity.
// Boxes are {x0,z0,x1,z1,top,bottom}: solid from bottom to top.
export function rayHitWall(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = Infinity;
  for (const b of colliders) {
    const b0 = b.bottom || 0;
    let tmin = 0;
    let tmax = maxDist;
    // X slab
    if (Math.abs(dx) < 1e-9) { if (ox < b.x0 || ox > b.x1) continue; }
    else {
      let t1 = (b.x0 - ox) / dx;
      let t2 = (b.x1 - ox) / dx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) { if (oz < b.z0 || oz > b.z1) continue; }
    else {
      let t1 = (b.z0 - oz) / dz;
      let t2 = (b.z1 - oz) / dz;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Y slab
    if (Math.abs(dy) < 1e-9) { if (oy < b0 || oy > b.top) continue; }
    else {
      let t1 = (b0 - oy) / dy;
      let t2 = (b.top - oy) / dy;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin < best) best = tmin;
  }
  return best;
}

// Line of sight between two points. Walls block; smoke clouds block too
// (a bot never shoots at an enemy it can only see through smoke).
export function hasLOS(colliders, smokes, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return true;
  const inv = 1 / dist;
  if (rayHitWall(colliders, ax, ay, az, dx * inv, dy * inv, dz * inv, dist) < dist - 0.01) return false;
  for (const s of smokes) {
    // Segment-sphere test against the smoke cloud.
    const cx = s.x - ax;
    const cy = s.y - ay;
    const cz = s.z - az;
    const t = Math.max(0, Math.min(dist, (cx * dx + cy * dy + cz * dz) / dist));
    const px = ax + dx * inv * t;
    const py = ay + dy * inv * t;
    const pz = az + dz * inv * t;
    const ddx = px - s.x;
    const ddy = py - s.y;
    const ddz = pz - s.z;
    if (ddx * ddx + ddy * ddy + ddz * ddz < s.r * s.r) return false;
  }
  return true;
}

export function buildWorld(scene) {
  const colliders = [];
  const addCollider = (x0, z0, x1, z1, top, bottom) => {
    colliders.push({ x0, z0, x1, z1, top, bottom: bottom || 0 });
  };

  const M = {
    sand: new THREE.MeshStandardMaterial({ color: 0xc9a06b, roughness: 1 }),
    sandDark: new THREE.MeshStandardMaterial({ color: 0xb08d5f, roughness: 1 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.85 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x2e4a6b, roughness: 0.35, metalness: 0.65 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.4 }),
    rust: new THREE.MeshStandardMaterial({ color: 0xc96a2e, roughness: 0.7, metalness: 0.3 }),
    charcoal: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.8 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.95 }),
    crate: new THREE.MeshStandardMaterial({ color: 0xa8824e, roughness: 0.9 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0xb0502a, roughness: 0.7, metalness: 0.2 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0x9a5a28, roughness: 0.55, metalness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x88a8c8, roughness: 0.2, metalness: 0.4 }),
  };

  const box = (w, h, d, mat, x, y, z, ry, shadow) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    m.castShadow = shadow !== false;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const cyl = (rt, rb, h, mat, x, y, z, seg) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  // ---- Sky, sun glow, fog, lights (golden hour: warm, low sun, bright) ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(380, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), transparent: true, depthWrite: false, fog: false,
  }));
  sunGlow.position.set(-320, 55, -90);
  sunGlow.scale.set(150, 150, 1);
  scene.add(sunGlow);
  scene.fog = new THREE.Fog(0xdfb183, 55, 190);

  const sun = new THREE.DirectionalLight(0xffb26b, 1.9);
  sun.position.set(-55, 32, -25); // low in the west: long shadows to the east
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0x9db8e8, 0xc79a5f, 0.65));

  // ---- Ground, roads, site pads ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), M.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const roadN = new THREE.Mesh(new THREE.PlaneGeometry(92, 7), M.sandDark);
  roadN.rotation.x = -Math.PI / 2; roadN.position.set(0, 0.02, -30); roadN.receiveShadow = true;
  scene.add(roadN);
  const roadS = roadN.clone();
  roadS.position.set(0, 0.02, 28);
  scene.add(roadS);
  const padA = new THREE.Mesh(new THREE.CircleGeometry(SITE_RADIUS + 1, 28), M.concrete);
  padA.rotation.x = -Math.PI / 2; padA.position.set(SITES.A.x, 0.03, SITES.A.z); padA.receiveShadow = true;
  scene.add(padA);
  const padB = padA.clone();
  padB.position.set(SITES.B.x, 0.03, SITES.B.z);
  scene.add(padB);

  // ---- Perimeter fence walls ----
  const wallH = 3.6;
  box(98, wallH, 0.6, M.concrete, 0, wallH / 2, -36.3, 0);
  box(98, wallH, 0.6, M.concrete, 0, wallH / 2, 36.3, 0);
  box(0.6, wallH, 74, M.concrete, -48.3, wallH / 2, 0, 0);
  box(0.6, wallH, 74, M.concrete, 48.3, wallH / 2, 0, 0);
  addCollider(-48.6, -36.6, 48.6, -36, 4);
  addCollider(-48.6, 36, 48.6, 36.6, 4);
  addCollider(-48.6, -36.6, -48, 36.6, 4);
  addCollider(48, -36.6, 48.6, 36.6, 4);

  // ---- Solar panel rows (instanced): the map's signature cover ----
  const panelGeo = new THREE.BoxGeometry(3.4, 0.14, 2.4);
  const postGeo = new THREE.BoxGeometry(0.18, 1.1, 0.18);
  const panelSpots = [];
  const row = (z, x0, x1) => { for (let x = x0; x <= x1; x += 4) panelSpots.push([x, z]); };
  row(-7, -20, 28); row(7, -20, 28);
  row(-14, 8, 40); row(-21, 8, 40); row(-28, 8, 40);
  const panels = new THREE.InstancedMesh(panelGeo, M.panel, panelSpots.length);
  const posts = new THREE.InstancedMesh(postGeo, M.frame, panelSpots.length * 2);
  const dummy = new THREE.Object3D();
  panelSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 1.35, z);
    dummy.rotation.set(-0.5, 0, 0); // tilted toward the low sun
    dummy.updateMatrix();
    panels.setMatrixAt(i, dummy.matrix);
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(x - 1.2, 0.55, z + 0.5);
    dummy.updateMatrix();
    posts.setMatrixAt(i * 2, dummy.matrix);
    dummy.position.set(x + 1.2, 0.55, z + 0.5);
    dummy.updateMatrix();
    posts.setMatrixAt(i * 2 + 1, dummy.matrix);
    addCollider(x - 1.7, z - 1.1, x + 1.7, z + 1.1, 2.2);
  });
  panels.castShadow = true; panels.receiveShadow = true;
  posts.castShadow = true;
  scene.add(panels);
  scene.add(posts);

  // ---- Control building (SITE B): white, flat roof, big B sign ----
  box(14, 6, 20, M.white, 37, 3, 18, 0);
  box(14.6, 0.5, 20.6, M.charcoal, 37, 6.2, 18, 0); // roof trim
  box(3, 3.2, 0.3, M.charcoal, 30, 1.6, 18, 0, false); // door on the west face
  box(8, 1.4, 0.2, M.glass, 30, 4.4, 18, 0, false); // window strip
  box(2, 2, 1.2, M.concrete, 34, 7, 12, 0); // roof unit
  addCollider(30, 8, 44, 28, 6.5);
  const bSign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 4.5),
    new THREE.MeshBasicMaterial({ map: textTexture('B', 256, 256, '#f2ede2', '#c96a2e', 'bold 200px Arial') }),
  );
  bSign.position.set(29.9, 3.6, 24);
  bSign.rotation.y = -Math.PI / 2;
  scene.add(bSign);
  const bBoard = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 1.2),
    new THREE.MeshBasicMaterial({ map: textTexture('CONTROL BLOCK', 512, 96, '#2b2b2b', '#f5ead6', 'bold 52px Arial') }),
  );
  bBoard.position.set(29.9, 5.4, 14);
  bBoard.rotation.y = -Math.PI / 2;
  scene.add(bBoard);
  // Warm light spilling from the building doorway.
  const doorLight = new THREE.PointLight(0xffc27a, 18, 16, 1.8);
  doorLight.position.set(28.5, 2.2, 18);
  scene.add(doorLight);

  // ---- Site A sign: big rust A on a panel frame + name board ----
  box(0.3, 4.4, 5.4, M.frame, 31, 2.2, -24, 0);
  const aSign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 4.6),
    new THREE.MeshBasicMaterial({ map: textTexture('A', 256, 256, '#2e4a6b', '#ff9a3c', 'bold 200px Arial') }),
  );
  aSign.position.set(30.8, 2.4, -24);
  aSign.rotation.y = -Math.PI / 2;
  scene.add(aSign);
  const aBoard = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 1.2),
    new THREE.MeshBasicMaterial({ map: textTexture('ARRAY FIELD', 512, 96, '#2b2b2b', '#f5ead6', 'bold 52px Arial') }),
  );
  aBoard.position.set(30.8, 5, -24);
  aBoard.rotation.y = -Math.PI / 2;
  scene.add(aBoard);
  addCollider(30.8, -26.7, 31.2, -21.3, 4.4);

  // ---- Water tower (landmark, visible across the map) ----
  const twX = 16;
  const twZ = 16;
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    const leg = cyl(0.22, 0.3, 8, M.rust, twX + dx, 4, twZ + dz, 8);
    leg.rotation.z = dx > 0 ? -0.06 : 0.06;
    leg.rotation.x = dz > 0 ? 0.06 : -0.06;
  }
  cyl(3.2, 3.2, 4, M.white, twX, 10, twZ, 18);
  cyl(0.2, 3.4, 1.6, M.rust, twX, 12.8, twZ, 18);
  box(0.8, 8, 0.2, M.frame, twX + 3.2, 4, twZ, 0, false); // ladder
  addCollider(twX - 2.4, twZ - 2.4, twX + 2.4, twZ + 2.4, 8);

  // ---- Transmission pylon (north-west) ----
  const pyX = -18;
  const pyZ = -28;
  box(0.5, 14, 0.5, M.frame, pyX, 7, pyZ, 0);
  box(6, 0.5, 0.5, M.frame, pyX, 12.5, pyZ, 0);
  box(4, 0.4, 0.4, M.frame, pyX, 10.5, pyZ, 0);
  box(0.3, 4, 0.3, M.frame, pyX - 1.5, 3, pyZ, 0, false);
  box(0.3, 4, 0.3, M.frame, pyX + 1.5, 3, pyZ, 0, false);
  addCollider(pyX - 0.5, pyZ - 0.5, pyX + 0.5, pyZ + 0.5, 14);

  // ---- Raised maintenance platform + ramp (walkable, see groundHeight) ----
  box(8, PLATFORM.h, 4, M.concrete, 8, PLATFORM.h / 2, -3, 0);
  box(8.4, 0.25, 4.4, M.charcoal, 8, PLATFORM.h + 0.1, -3, 0);
  box(0.15, 1, 4, M.rust, 12, PLATFORM.h + 0.6, -3, 0, false); // rail
  for (let i = 0; i < 4; i++) {
    box(1, 0.55 * (i + 1), 4, M.concrete, 0.5 + i, (0.55 * (i + 1)) / 2, -3, 0, false);
  }
  addCollider(PLATFORM.x0, PLATFORM.z0, PLATFORM.x1, PLATFORM.z1, PLATFORM.h);

  // ---- Pipes along B-LINK (rust-orange, covered pipe run) ----
  const pipeGeo = new THREE.CylinderGeometry(0.55, 0.55, 80, 10);
  const pipe1 = new THREE.Mesh(pipeGeo, M.pipe);
  pipe1.rotation.z = Math.PI / 2;
  pipe1.position.set(0, 0.9, 30.5);
  pipe1.castShadow = true;
  scene.add(pipe1);
  const pipe2 = pipe1.clone();
  pipe2.position.set(0, 2.1, 30.5);
  scene.add(pipe2);
  for (let x = -36; x <= 36; x += 12) box(0.4, 2.6, 0.4, M.frame, x, 1.3, 30.5, 0, false);
  addCollider(-40, 30, 40, 31, 2.6);
  cyl(0.5, 0.5, 6, M.pipe, 16, 3, 19.5, 10); // riser by the tower

  // ---- Crates, barrels, concrete barriers (instanced cover) ----
  const crateSpots = [
    [2, 3, 1.2, 0.3], [-4, -3, 1.2, 0.8], [10, 4, 1.2, 0.1], [14, -3, 1.2, 0.5],
    [-12, 2, 1.2, 0.9], [20, -18, 1.2, 0.2], [20, 12, 1.2, 0.6], [-24, -26, 1.2, 0.4],
    [-24, 24, 1.2, 0.7], [30, -14, 1.2, 0.1], [34, 12, 1.2, 0.3], [-34, 8, 1.2, 0.5],
    [2, 3, 1.2, 0.3], // stacked second crate, raised below
  ];
  const crates = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), M.crate, crateSpots.length);
  crateSpots.forEach(([x, z, s, ry], i) => {
    dummy.position.set(x, i === crateSpots.length - 1 ? 1.8 : 0.6, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    crates.setMatrixAt(i, dummy.matrix);
    if (i < crateSpots.length - 1) addCollider(x - 0.7, z - 0.7, x + 0.7, z + 0.7, 1.2);
  });
  dummy.scale.setScalar(1);
  crates.castShadow = true; crates.receiveShadow = true;
  scene.add(crates);

  const barrelSpots = [[-8, 5], [18, 8], [26, -16], [-30, -20], [36, 24], [-14, -10], [6, -9], [24, 26]];
  const barrels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12), M.barrel, barrelSpots.length);
  barrelSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 0.55, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    barrels.setMatrixAt(i, dummy.matrix);
    addCollider(x - 0.45, z - 0.45, x + 0.45, z + 0.45, 1.1);
  });
  barrels.castShadow = true;
  scene.add(barrels);

  const barrierSpots = [
    [-2, -8, 0], [8, 9, 0.4], [-16, -18, 1.2], [24, 8, 0.2], [-28, 12, 0.9], [18, -8, 0.3],
  ];
  const barriers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 1.1, 0.5), M.concrete, barrierSpots.length);
  barrierSpots.forEach(([x, z, ry], i) => {
    dummy.position.set(x, 0.55, z);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    barriers.setMatrixAt(i, dummy.matrix);
    const c = Math.abs(Math.cos(ry));
    const s = Math.abs(Math.sin(ry));
    const hx = 1.2 * c + 0.25 * s;
    const hz = 1.2 * s + 0.25 * c;
    addCollider(x - hx, z - hz, x + hx, z + hz, 1.1);
  });
  barriers.castShadow = true; barriers.receiveShadow = true;
  scene.add(barriers);

  // ---- Spawn canopies + map name boards ----
  for (const [sx, sz, label] of [[-42, 0, 'SUNSPIRE'], [42, 0, 'BEDROCK']]) {
    box(8, 0.3, 10, M.white, sx, 3.4, sz, 0);
    box(0.3, 3.4, 0.3, M.frame, sx - 3.8, 1.7, sz - 4.8, 0, false);
    box(0.3, 3.4, 0.3, M.frame, sx + 3.8, 1.7, sz - 4.8, 0, false);
    box(0.3, 3.4, 0.3, M.frame, sx - 3.8, 1.7, sz + 4.8, 0, false);
    box(0.3, 3.4, 0.3, M.frame, sx + 3.8, 1.7, sz + 4.8, 0, false);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 1.1),
      new THREE.MeshBasicMaterial({ map: textTexture(`SUNFALL ARRAY · ${label}`, 640, 96, '#2b2b2b', '#ffb347', 'bold 46px Arial') }),
    );
    board.position.set(sx, 2.6, sz + (sz === 0 ? 0 : 0));
    board.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
    board.position.x = sx < 0 ? sx + 4.1 : sx - 4.1;
    scene.add(board);
  }

  // ---- Site marker rings (flat, glowing edge) ----
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, side: THREE.DoubleSide });
  for (const site of [SITES.A, SITES.B]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(SITE_RADIUS - 0.25, SITE_RADIUS, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.05, site.z);
    scene.add(ring);
  }

  return { colliders, sun };
}
