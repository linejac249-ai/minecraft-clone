import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const CHUNK_SIZE = 16;
const VIEW_RADIUS = 2;
const PLAYER_HEIGHT = 1.7;
const MOVE_SPEED = 7.5;
const GRAVITY = 22;
const JUMP_SPEED = 8.5;

const BLOCK = {
  air: 0,
  grass: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  wood: 5,
  leaves: 6,
};

const BLOCK_COLORS = {
  [BLOCK.grass]: new THREE.Color(0x5dbb63),
  [BLOCK.dirt]: new THREE.Color(0x8a5a2b),
  [BLOCK.stone]: new THREE.Color(0x7d7d81),
  [BLOCK.sand]: new THREE.Color(0xd8c37a),
  [BLOCK.wood]: new THREE.Color(0x9a6731),
  [BLOCK.leaves]: new THREE.Color(0x3d8b42),
};

const FACE_DEFS = [
  ['north', [0, 0, -1]],
  ['south', [0, 0, 1]],
  ['east', [1, 0, 0]],
  ['west', [-1, 0, 0]],
  ['up', [0, 1, 0]],
  ['down', [0, -1, 0]],
];

const FACE_VERTICES = {
  north: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ],
  south: [
    [1, 0, 1],
    [0, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ],
  east: [
    [1, 0, 0],
    [1, 0, 1],
    [1, 1, 1],
    [1, 1, 0],
  ],
  west: [
    [0, 0, 1],
    [0, 0, 0],
    [0, 1, 0],
    [0, 1, 1],
  ],
  up: [
    [0, 1, 0],
    [1, 1, 0],
    [1, 1, 1],
    [0, 1, 1],
  ],
  down: [
    [0, 0, 1],
    [1, 0, 1],
    [1, 0, 0],
    [0, 0, 0],
  ],
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ecbff);
scene.fog = new THREE.Fog(0x8ecbff, 30, 180);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3e3e3e, 1.2);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff2d1, 1.2);
sunLight.position.set(12, 30, 8);
scene.add(sunLight);

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const player = {
  position: new THREE.Vector3(0, 18, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  yaw: 0,
  pitch: 0,
  onGround: false,
  locked: false,
};

const keys = {};
const chunks = new Map();
const chunkMeshes = [];
const entities = [];

const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
  new THREE.LineBasicMaterial({ color: 0x00d1ff, opacity: 0.9, transparent: true })
);
highlight.visible = false;
scene.add(highlight);

const selected = {
  block: null,
  normal: null,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function keyForChunk(cx, cz) {
  return `${cx},${cz}`;
}

function worldToChunk(x, z) {
  return {
    cx: Math.floor(x / CHUNK_SIZE),
    cz: Math.floor(z / CHUNK_SIZE),
  };
}

function terrainHeight(x, z) {
  const base = 6 + Math.sin(x * 0.32) * 3.4 + Math.cos(z * 0.28) * 3.8 + Math.sin((x + z) * 0.18) * 2.5;
  return clamp(Math.floor(base), 3, 18);
}

function setBlockAt(x, y, z, id) {
  const { cx, cz } = worldToChunk(x, z);
  const key = keyForChunk(cx, cz);
  let chunk = chunks.get(key);

  if (!chunk) {
    chunk = generateChunk(cx, cz);
    chunks.set(key, chunk);
  }

  const localX = x - cx * CHUNK_SIZE;
  const localZ = z - cz * CHUNK_SIZE;
  const blockKey = `${localX},${y},${localZ}`;

  if (id === BLOCK.air) {
    chunk.data.delete(blockKey);
  } else {
    chunk.data.set(blockKey, id);
  }

  rebuildChunk(chunk);

  const chunkNeighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (const [dx, dz] of chunkNeighbors) {
    const neighborChunk = chunks.get(keyForChunk(cx + dx, cz + dz));
    if (neighborChunk) {
      rebuildChunk(neighborChunk);
    }
  }
}

function getBlockAt(x, y, z) {
  const { cx, cz } = worldToChunk(x, z);
  const chunk = chunks.get(keyForChunk(cx, cz));

  if (!chunk) {
    return BLOCK.air;
  }

  const localX = x - cx * CHUNK_SIZE;
  const localZ = z - cz * CHUNK_SIZE;
  return chunk.data.get(`${localX},${y},${localZ}`) ?? BLOCK.air;
}

function addTree(data, x, y, z) {
  for (let i = 0; i < 4; i += 1) {
    data.set(`${x},${y + i},${z}`, BLOCK.wood);
  }

  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dy = 0; dy <= 2; dy += 1) {
        const distance = Math.abs(dx) + Math.abs(dz) + Math.abs(dy - 1);
        if (distance <= 4 && Math.random() > 0.18) {
          data.set(`${x + dx},${y + 3 + dy},${z + dz}`, BLOCK.leaves);
        }
      }
    }
  }
}

function createStoneTower(data, x, y, z) {
  for (let h = 0; h < 3; h += 1) {
    data.set(`${x},${y + h},${z}`, BLOCK.stone);
  }
}

function generateChunk(cx, cz) {
  const chunk = { cx, cz, data: new Map(), mesh: null };

  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const worldX = cx * CHUNK_SIZE + lx;
      const worldZ = cz * CHUNK_SIZE + lz;
      const height = terrainHeight(worldX, worldZ);

      for (let y = 0; y <= height; y += 1) {
        let id = BLOCK.stone;
        if (y === height) {
          id = height < 6 ? BLOCK.sand : BLOCK.grass;
        } else if (y >= height - 2) {
          id = height < 6 ? BLOCK.sand : BLOCK.dirt;
        }

        chunk.data.set(`${lx},${y},${lz}`, id);
      }

      if (height > 5 && lx > 2 && lx < CHUNK_SIZE - 3 && lz > 2 && lz < CHUNK_SIZE - 3 && Math.random() < 0.09) {
        addTree(chunk.data, lx, height + 1, lz);
      }

      if (Math.random() < 0.012 && height > 5 && lx > 1 && lx < CHUNK_SIZE - 2 && lz > 1 && lz < CHUNK_SIZE - 2) {
        createStoneTower(chunk.data, lx, height + 1, lz);
      }
    }
  }

  rebuildChunk(chunk);
  return chunk;
}

function rebuildChunk(chunk) {
  const positions = [];
  const colors = [];
  const normals = [];

  for (const [key, value] of chunk.data.entries()) {
    if (value === BLOCK.air) continue;

    const [lx, y, lz] = key.split(',').map(Number);
    const worldX = chunk.cx * CHUNK_SIZE + lx;
    const worldZ = chunk.cz * CHUNK_SIZE + lz;
    const color = BLOCK_COLORS[value] ?? new THREE.Color(0xffffff);

    for (const [faceName, direction] of FACE_DEFS) {
      const neighborX = worldX + direction[0];
      const neighborY = y + direction[1];
      const neighborZ = worldZ + direction[2];

      if (getBlockAt(neighborX, neighborY, neighborZ) !== BLOCK.air) continue;

      for (const vertex of FACE_VERTICES[faceName]) {
        const px = worldX + vertex[0];
        const py = y + vertex[1];
        const pz = worldZ + vertex[2];

        positions.push(px, py, pz);
        colors.push(color.r, color.g, color.b);
        normals.push(direction[0], direction[1], direction[2]);
      }
    }
  }

  if (chunk.mesh) {
    worldGroup.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.mesh.material.dispose();
  }

  if (positions.length === 0) {
    chunk.mesh = null;
    return;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0, 0);
  mesh.userData.chunkKey = keyForChunk(chunk.cx, chunk.cz);
  chunk.mesh = mesh;
  worldGroup.add(mesh);
}

function updateChunkLoading() {
  const playerChunk = worldToChunk(player.position.x, player.position.z);
  const needed = new Set();

  for (let cx = playerChunk.cx - VIEW_RADIUS; cx <= playerChunk.cx + VIEW_RADIUS; cx += 1) {
    for (let cz = playerChunk.cz - VIEW_RADIUS; cz <= playerChunk.cz + VIEW_RADIUS; cz += 1) {
      const key = keyForChunk(cx, cz);
      needed.add(key);

      if (!chunks.has(key)) {
        const chunk = generateChunk(cx, cz);
        chunks.set(key, chunk);
      }
    }
  }

  for (const key of [...chunks.keys()]) {
    if (!needed.has(key)) {
      const chunk = chunks.get(key);
      if (chunk && chunk.mesh) {
        worldGroup.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        chunk.mesh.material.dispose();
      }
      chunks.delete(key);
    }
  }

  chunkMeshes.length = 0;
  for (const chunk of chunks.values()) {
    if (chunk.mesh) {
      chunkMeshes.push(chunk.mesh);
    }
  }
}

function getHighestSolidY(x, z) {
  const floorX = Math.floor(x);
  const floorZ = Math.floor(z);

  for (let y = 64; y >= -16; y -= 1) {
    if (getBlockAt(floorX, y, floorZ) !== BLOCK.air) {
      return y;
    }
  }

  return 0;
}

function updatePlayer(delta) {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  direction.y = 0;
  direction.normalize();

  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, direction).normalize();

  const move = new THREE.Vector3();
  if (keys.KeyW) move.add(direction);
  if (keys.KeyS) move.sub(direction);
  if (keys.KeyA) move.sub(right);
  if (keys.KeyD) move.add(right);

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(MOVE_SPEED * delta);
  }

  player.position.x += move.x;
  player.position.z += move.z;

  player.velocity.y -= GRAVITY * delta;
  player.position.y += player.velocity.y * delta;

  const groundY = getHighestSolidY(player.position.x, player.position.z);
  const eyeFloor = groundY + PLAYER_HEIGHT;

  if (player.position.y <= eyeFloor) {
    player.position.y = eyeFloor + 0.02;
    player.velocity.y = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  camera.position.copy(player.position);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}

function raycastSelection() {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3(); const direction = new THREE.Vector3();
  origin.copy(camera.position);
  camera.getWorldDirection(direction);
  raycaster.set(origin, direction);

  const intersections = raycaster.intersectObjects(chunkMeshes, false);
  highlight.visible = false;
  selected.block = null;
  selected.normal = null;

  if (intersections.length === 0) return;

  const hit = intersections[0];
  const normal = hit.face.normal.clone();
  const point = hit.point.clone().addScaledVector(normal, -0.02);
  const blockPosition = new THREE.Vector3(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z));

  if (blockPosition.y < -20) return;

  highlight.position.copy(blockPosition.clone().addScalar(0.5));
  highlight.visible = true;
  selected.block = blockPosition;
  selected.normal = normal;
}

function removeSelectedBlock() {
  if (!selected.block) return;
  setBlockAt(selected.block.x, selected.block.y, selected.block.z, BLOCK.air);
  highlight.visible = false;
}

function placeSelectedBlock() {
  if (!selected.block || !selected.normal) return;
  const newPos = selected.block.clone().add(selected.normal);
  const yTest = newPos.y;
  if (yTest < -18) return;

  const blockAt = getBlockAt(newPos.x, newPos.y, newPos.z);
  if (blockAt === BLOCK.air) {
    setBlockAt(newPos.x, newPos.y, newPos.z, BLOCK.wood);
  }
}

function spawnMob(x, z, color = 0xff6b6b) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.25, 0.7),
    new THREE.MeshLambertMaterial({ color })
  );
  mesh.position.set(x, getHighestSolidY(x, z) + 1.1, z);
  scene.add(mesh);
  entities.push({
    mesh,
    baseX: x,
    baseZ: z,
    phase: Math.random() * Math.PI * 2,
    speed: 0.6 + Math.random() * 1.1,
    offsetX: (Math.random() - 0.5) * 2.5,
    offsetZ: (Math.random() - 0.5) * 2.5,
  });
}

function spawnWorldEntities() {
  for (let i = 0; i < 15; i += 1) {
    const x = (Math.random() - 0.5) * 120;
    const z = (Math.random() - 0.5) * 120;
    const y = getHighestSolidY(x, z) + 1;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 1.25, 0.7),
      new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? 0xff6b6b : 0x3db7ff })
    );
    mesh.position.set(x, y, z);
    scene.add(mesh);
    entities.push({
      mesh,
      baseX: x,
      baseZ: z,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 1.1,
      offsetX: (Math.random() - 0.5) * 2.5,
      offsetZ: (Math.random() - 0.5) * 2.5,
    });
  }
}

function updateEntities(time) {
  for (const entity of entities) {
    const swayX = Math.sin(time * entity.speed + entity.phase) * entity.offsetX;
    const swayZ = Math.cos(time * entity.speed + entity.phase) * entity.offsetZ;
    const baseY = getHighestSolidY(entity.baseX + swayX, entity.baseZ + swayZ) + 1.2;
    entity.mesh.position.set(entity.baseX + swayX, baseY + Math.sin(time * 8 + entity.phase) * 0.12, entity.baseZ + swayZ);
  }
}

window.addEventListener('keydown', (event) => {
  keys[event.code] = true;
  if (event.code === 'Space' && player.onGround) {
    player.velocity.y = JUMP_SPEED;
    player.onGround = false;
  }
});

window.addEventListener('keyup', (event) => {
  keys[event.code] = false;
});

window.addEventListener('mousedown', (event) => {
  if (!player.locked) return;

  if (event.button === 0) {
    removeSelectedBlock();
  }

  if (event.button === 2) {
    placeSelectedBlock();
  }
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

renderer.domElement.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  player.locked = document.pointerLockElement === renderer.domElement;
  document.body.classList.toggle('pointer-locked', player.locked);
});

document.addEventListener('mousemove', (event) => {
  if (!player.locked) return;
  player.yaw -= event.movementX * 0.0023;
  player.pitch -= event.movementY * 0.0018;
  player.pitch = clamp(player.pitch, -1.55, 1.55);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function initWorld() {
  const origin = worldToChunk(player.position.x, player.position.z);
  for (let cx = origin.cx - VIEW_RADIUS; cx <= origin.cx + VIEW_RADIUS; cx += 1) {
    for (let cz = origin.cz - VIEW_RADIUS; cz <= origin.cz + VIEW_RADIUS; cz += 1) {
      const key = keyForChunk(cx, cz);
      chunks.set(key, generateChunk(cx, cz));
    }
  }

  spawnWorldEntities();
}

function animate() {
  requestAnimationFrame(animate);
  const time = performance.now() * 0.001;

  updateChunkLoading();
  updatePlayer(1 / 60);
  raycastSelection();
  updateEntities(time);

  renderer.render(scene, camera);
}

initWorld();
animate();
