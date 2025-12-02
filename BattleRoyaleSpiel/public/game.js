import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- GLOBALS ---
let previewMesh = null;
const clock = new THREE.Clock(); 
const otherPlayers = {}; 
const objectsMap = {}; 
const cratesMap = {};
const projectiles = [];
let lastFiredTime = 0;
let respawnInterval = null; // To track the timer loop
let isDead = false;

// --- GEOMETRIES ---
const GRID_SIZE = 4;
const geoWall = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, 0.1);
const geoFloor = new THREE.BoxGeometry(GRID_SIZE, 0.1, GRID_SIZE);
const rampLen = Math.sqrt(GRID_SIZE**2 + GRID_SIZE**2);
const geoRamp = new THREE.BoxGeometry(GRID_SIZE, 0.1, rampLen);

// --- CONFIG ---
const PLAYER_SCALE = 0.6;
const PLAYER_RADIUS = 0.8 * PLAYER_SCALE;
const CAMERA_OFFSET = new THREE.Vector3(1.5, 1.5, 3.5);
const MOUSE_SENSITIVITY = 0.002;
const TOUCH_SENSITIVITY = 0.005;
const JUMP_FORCE = 12;
const MOVE_SPEED = 15;

const WEAPON_STATS = {
    1: { name: 'Pickaxe', fireRate: 400, type: 'melee', damage: 20 },
    2: { name: 'Pumpgun', fireRate: 900, type: 'gun', speed: 40, recoil: 0.5, damage: 90 },
    3: { name: 'Assault Rifle', fireRate: 120, type: 'gun', speed: 80, recoil: 0.1, damage: 25 },
    4: { name: 'SMG', fireRate: 80, type: 'gun', speed: 70, recoil: 0.05, damage: 15 },
    5: { name: 'Sniper', fireRate: 1500, type: 'gun', speed: 200, recoil: 1.0, damage: 110 }
};

// --- INIT ---
const socket = io();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true }); // Sharp edges
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio); // Fix for Retina/iPad blur
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
scene.add(dirLight);

// --- PHYSICS ---
const world = new CANNON.World();
world.gravity.set(0, -30, 0); 
world.solver.iterations = 20; 

const GROUP_PLAYER = 1;
const GROUP_SCENE = 2;

const physicsMat = new CANNON.Material('slippery');
const physicsContactMat = new CANNON.ContactMaterial(physicsMat, physicsMat, { friction: 0.0, restitution: 0.0 });
world.addContactMaterial(physicsContactMat);

const groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: physicsMat,
    collisionFilterGroup: GROUP_SCENE, collisionFilterMask: GROUP_PLAYER | GROUP_SCENE
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x339933 }));
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// --- PLAYER PHYSICS ---
const playerShape = new CANNON.Sphere(PLAYER_RADIUS);
const playerBody = new CANNON.Body({
    mass: 20, shape: playerShape, material: physicsMat,
    position: new CANNON.Vec3(0, 10, 0), linearDamping: 0.9, fixedRotation: true,
    collisionFilterGroup: GROUP_PLAYER, collisionFilterMask: GROUP_SCENE
});
world.addBody(playerBody);

function createPlayerMesh(isEnemy = false) {
    const group = new THREE.Group();
    const color = isEnemy ? 0xFF0000 : 0x22AA22; 
    const skinMat = new THREE.MeshStandardMaterial({ color: color }); 
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111 }); 

    const torso = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.5), skinMat);
    torso.position.y = 0.75; torso.castShadow = true; group.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), skinMat);
    head.position.y = 1.9; group.add(head);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.1), darkMat);
    face.position.set(0, 1.9, 0.41); group.add(face);

    const armGeo = new THREE.BoxGeometry(0.35, 1.2, 0.35);
    const armL = new THREE.Mesh(armGeo, skinMat);
    armL.position.set(-0.7, 1.3, 0); armL.geometry.translate(0, -0.4, 0); group.add(armL);
    const armR = new THREE.Mesh(armGeo, skinMat);
    armR.position.set(0.7, 1.3, 0); armR.geometry.translate(0, -0.4, 0); group.add(armR);

    const legGeo = new THREE.BoxGeometry(0.4, 1.5, 0.4);
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.25, 0.75, 0); legL.geometry.translate(0, -0.75, 0); group.add(legL);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.25, 0.75, 0); legR.geometry.translate(0, -0.75, 0); group.add(legR);

    group.scale.set(PLAYER_SCALE, PLAYER_SCALE, PLAYER_SCALE);
    if (isEnemy) return { group };

    const weapons = {};
    const handPos = new THREE.Vector3(-0.2, -1.0, 0.5);

    const pickaxe = new THREE.Group();
    pickaxe.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), new THREE.MeshStandardMaterial({color: 0x8B4513})));
    const ph = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.15, 0.15), new THREE.MeshStandardMaterial({color: 0x999999}));
    ph.position.y=0.5; pickaxe.add(ph);
    pickaxe.position.copy(handPos); pickaxe.rotation.x = Math.PI/2; pickaxe.visible=false;
    armL.add(pickaxe); weapons[1] = pickaxe;

    const pump = new THREE.Group();
    pump.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.6), new THREE.MeshStandardMaterial({color: 0x333333})));
    const pb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.6), new THREE.MeshStandardMaterial({color: 0x111111}));
    pb.position.z=-0.4; pump.add(pb);
    pump.position.copy(handPos); pump.visible=false; armL.add(pump); weapons[2] = pump;

    const ar = new THREE.Group();
    ar.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.8), new THREE.MeshStandardMaterial({color: 0x222222})));
    const am = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.15), new THREE.MeshStandardMaterial({color: 0x111111}));
    am.position.set(0,-0.2,0.1); ar.add(am);
    ar.position.copy(handPos); ar.visible=false; armL.add(ar); weapons[3] = ar;

    const smg = new THREE.Group();
    smg.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.4), new THREE.MeshStandardMaterial({color: 0x444444})));
    smg.position.copy(handPos); smg.visible=false; armL.add(smg); weapons[4] = smg;

    const sniper = new THREE.Group();
    sniper.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 1.2), new THREE.MeshStandardMaterial({color: 0x111111})));
    const sc = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.2), new THREE.MeshStandardMaterial({color: 0x000000}));
    sc.position.set(0,0.15,0.2); sniper.add(sc);
    sniper.position.copy(handPos); sniper.visible=false; armL.add(sniper); weapons[5] = sniper;

    return { group, armL, armR, legL, legR, weapons };
}

const localPlayer = createPlayerMesh(false);
scene.add(localPlayer.group);

// --- CONTROLS ---
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 1000);
const controls = new PointerLockControls(camera, document.body);

let cameraYaw = 0;
let cameraPitch = 0;

document.addEventListener('click', (e) => {
    if(!isDead && !e.target.classList.contains('mob-btn') && e.target.id !== 'joystick-zone' && !e.target.classList.contains('slot') && e.target.id !== 'touch-look-zone' && e.target.id !== 'btn-rejoin') {
        controls.lock();
    }
});
document.addEventListener('mousemove', (event) => {
    if (controls.isLocked && !isDead) {
        cameraYaw -= event.movementX * MOUSE_SENSITIVITY;
        cameraPitch -= event.movementY * MOUSE_SENSITIVITY;
        cameraPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraPitch));
    }
});

let isScoped = false;
document.addEventListener('mousedown', (e) => {
    if (!isDead && e.button === 2 && activeSlot === 5) { isScoped = true; camera.fov = 30; camera.updateProjectionMatrix(); }
    if (!isDead && e.button === 0 && controls.isLocked) handleAction();
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 2) { isScoped = false; camera.fov = 80; camera.updateProjectionMatrix(); }
});

// --- TOUCH INPUTS ---
const joyZone = document.getElementById('joystick-zone');
const joyKnob = document.getElementById('joystick-knob');
const touchLook = document.getElementById('touch-look-zone');
let joyId = null; let lookId = null; let lastTouchX = 0; let lastTouchY = 0;

if(joyZone) {
    joyZone.addEventListener('touchstart', (e) => { if(isDead) return; e.preventDefault(); joyId = e.changedTouches[0].identifier; handleJoystick(e.changedTouches[0]); }, {passive: false});
    joyZone.addEventListener('touchmove', (e) => { if(isDead) return; e.preventDefault(); for(let i=0; i<e.changedTouches.length; i++) if(e.changedTouches[i].identifier === joyId) handleJoystick(e.changedTouches[i]); }, {passive: false});
    joyZone.addEventListener('touchend', (e) => { e.preventDefault(); joyId = null; joyKnob.style.transform = `translate(-50%, -50%)`; keys.w=keys.a=keys.s=keys.d=false; }, {passive: false});
}

function handleJoystick(touch) {
    const rect = joyZone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = touch.clientX - cx; let dy = touch.clientY - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if(dist > 35) { dx = (dx/dist)*35; dy = (dy/dist)*35; }
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    keys.w = dy < -10; keys.s = dy > 10; keys.a = dx < -10; keys.d = dx > 10;
}

if(touchLook) {
    touchLook.addEventListener('touchstart', (e) => { if(isDead) return; e.preventDefault(); lookId = e.changedTouches[0].identifier; lastTouchX = e.changedTouches[0].clientX; lastTouchY = e.changedTouches[0].clientY; }, {passive: false});
    touchLook.addEventListener('touchmove', (e) => { 
        if(isDead) return;
        e.preventDefault(); 
        for(let i=0; i<e.changedTouches.length; i++) {
            if(e.changedTouches[i].identifier === lookId) {
                const t = e.changedTouches[i];
                const dx = t.clientX - lastTouchX; const dy = t.clientY - lastTouchY;
                cameraYaw -= dx * TOUCH_SENSITIVITY;
                cameraPitch -= dy * TOUCH_SENSITIVITY;
                cameraPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraPitch));
                lastTouchX = t.clientX; lastTouchY = t.clientY;
            }
        }
    }, {passive: false});
    touchLook.addEventListener('touchend', (e) => { for(let i=0; i<e.changedTouches.length; i++) if(e.changedTouches[i].identifier === lookId) lookId = null; });
}

// Buttons
const btnJump = document.getElementById('btn-jump');
if(btnJump) {
    btnJump.addEventListener('touchstart', (e) => { if(isDead) return; e.preventDefault(); keys.space = true; }, {passive: false});
    btnJump.addEventListener('touchend', (e) => { e.preventDefault(); keys.space = false; }, {passive: false});
}
const btnShoot = document.getElementById('btn-shoot');
if(btnShoot) btnShoot.addEventListener('touchstart', (e) => { if(isDead) return; e.preventDefault(); handleAction(); }, {passive: false});
const btnMode = document.getElementById('btn-mode');
if(btnMode) btnMode.addEventListener('touchstart', (e) => { if(isDead) return; e.preventDefault(); toggleBuild(); }, {passive: false});

['btn-wall','btn-floor','btn-ramp'].forEach(id => {
    const btn = document.getElementById(id);
    if(btn) btn.addEventListener('touchstart', (e) => { if(isDead) return; e.preventDefault(); setBuild(id.replace('btn-','')); }, {passive: false});
});

for(let i=1; i<=5; i++) {
    const slot = document.getElementById(`slot-${i}`);
    if(slot) slot.addEventListener('touchstart', (e) => { if(isDead) return; e.preventDefault(); setSlot(i); }, {passive: false});
}

// --- STATE ---
let activeSlot = 1; 
let buildMode = false;
let buildType = 'wall';
let attackTimer = 0;
let recoilOffset = 0;

const keys = { w: false, a: false, s: false, d: false, space: false };

document.addEventListener('keydown', (e) => {
    if(isDead) return;
    switch(e.code) {
        case 'KeyW': keys.w = true; break;
        case 'KeyA': keys.a = true; break;
        case 'KeyS': keys.s = true; break;
        case 'KeyD': keys.d = true; break;
        case 'Space': keys.space = true; break;
        case 'Digit1': setSlot(1); break;
        case 'Digit2': setSlot(2); break;
        case 'Digit3': setSlot(3); break;
        case 'Digit4': setSlot(4); break;
        case 'Digit5': setSlot(5); break;
        case 'KeyG': toggleBuild(); break;
        case 'KeyQ': setBuild('wall'); break;
        case 'KeyX': setBuild('floor'); break;
        case 'KeyV': setBuild('ramp'); break;
        case 'KeyE': interact(); break;
    }
});
document.addEventListener('keyup', (e) => {
    switch(e.code) {
        case 'KeyW': keys.w = false; break;
        case 'KeyA': keys.a = false; break;
        case 'KeyS': keys.s = false; break;
        case 'KeyD': keys.d = false; break;
        case 'Space': keys.space = false; break;
    }
});

function setSlot(s) { activeSlot = s; buildMode = false; if(isScoped) { isScoped=false; camera.fov=80; camera.updateProjectionMatrix(); } updateUI(); }
function toggleBuild() { buildMode = !buildMode; updateUI(); }
function setBuild(t) { buildType = t; buildMode = true; updateUI(); }

function updateUI() {
    for(let i=1; i<=5; i++) localPlayer.weapons[i].visible = false;
    if (!buildMode) localPlayer.weapons[activeSlot].visible = true;
    for(let i=1; i<=5; i++) { const s = document.getElementById(`slot-${i}`); if(s) s.classList.remove('active'); }
    const curr = document.getElementById(`slot-${activeSlot}`); if(curr && !buildMode) curr.classList.add('active');
    const mobBuild = document.getElementById('build-select'); if(mobBuild) mobBuild.style.display = buildMode ? 'block' : 'none';
    if(!buildMode && previewMesh) { scene.remove(previewMesh); previewMesh = null; }
}

// --- PROJECTILE CONVERGENCE LOGIC ---
function spawnProjectile(overrideOrigin, overrideDir) {
    const geo = new THREE.SphereGeometry(0.15, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const mesh = new THREE.Mesh(geo, mat);
    
    // Remote shot
    if(overrideOrigin && overrideDir) {
        mesh.position.copy(overrideOrigin);
        scene.add(mesh);
        projectiles.push({ mesh: mesh, velocity: new THREE.Vector3().copy(overrideDir), life: 2.0 });
        return;
    }

    // Local aim convergence
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(scene.children.filter(o => o !== localPlayer.group));
    let targetPoint;
    if(intersects.length > 0) targetPoint = intersects[0].point;
    else targetPoint = raycaster.ray.origin.clone().add(raycaster.ray.direction.multiplyScalar(100));

    // Start from Left Hand Gun Pos
    const offset = new THREE.Vector3(-0.5, -0.2, 1.0).applyAxisAngle(new THREE.Vector3(0,1,0), cameraYaw);
    const origin = camera.position.clone().add(offset);
    
    // Direction: Gun -> Target
    const dir = new THREE.Vector3().subVectors(targetPoint, origin).normalize();

    mesh.position.copy(origin);
    scene.add(mesh);
    const speed = WEAPON_STATS[activeSlot].speed || 50;
    
    const vel = dir.multiplyScalar(speed);
    projectiles.push({ mesh: mesh, velocity: vel, life: 2.0 });
    
    // Send to server
    socket.emit('playerShoot', { origin: origin, direction: vel });
}

function handleAction() {
    const now = Date.now();
    const stats = WEAPON_STATS[activeSlot];

    if(!buildMode) {
        if(now - lastFiredTime >= stats.fireRate) {
            lastFiredTime = now;
            attackTimer = 1.0; 
            if(activeSlot === 1) {
                const ray = new THREE.Raycaster();
                const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
                const startPos = camera.position.clone().add(dir.clone().multiplyScalar(1.5));
                ray.set(startPos, dir); ray.far = 6;
                const targets = scene.children.filter(o => o.userData.type === 'building' && o !== previewMesh);
                const hits = ray.intersectObjects(targets);
                if(hits.length > 0 && hits[0].object.userData.id) {
                    hits[0].object.material.color.setHex(0xff0000);
                    socket.emit('hitObject', hits[0].object.userData.id);
                }
            } else {
                spawnProjectile();
                recoilOffset = stats.recoil; 
            }
        }
    } else if(previewMesh && checkStructuralIntegrity()) {
        socket.emit('build', { type: buildType, x: previewMesh.position.x, y: previewMesh.position.y, z: previewMesh.position.z, rotation: previewMesh.userData.rotY });
    }
}

function interact() {
    for(const id in cratesMap) { if(cratesMap[id].position.distanceTo(playerBody.position) < 3) socket.emit('interact', { targetId: id }); }
}

function snapToGrid(x, y, z) { return { x: Math.round(x/GRID_SIZE)*GRID_SIZE, y: Math.round(y/GRID_SIZE)*GRID_SIZE, z: Math.round(z/GRID_SIZE)*GRID_SIZE }; }
function getCardinalYaw(yaw) { let y = yaw % (Math.PI*2); if(y<0) y+=Math.PI*2; return (Math.round(y/(Math.PI/2))*(Math.PI/2)) + Math.PI; }
function checkStructuralIntegrity() {
    if(!previewMesh) return false;
    const buildings = scene.children.filter(o => o.userData.type === 'building' && o !== previewMesh);
    for(let b of buildings) {
        if(b.position.distanceTo(previewMesh.position) < 0.1) {
            const rotDiff = Math.abs(b.rotation.y - previewMesh.userData.rotY) % Math.PI;
            if(rotDiff < 0.1 || rotDiff > Math.PI-0.1) return false; 
        }
    }
    if(Math.abs(previewMesh.position.y - GRID_SIZE/2) < 0.1) return true;
    for(let b of buildings) if(b.position.distanceTo(previewMesh.position) <= GRID_SIZE*1.5) return true;
    return false;
}

function updateBuildPreview() {
    if (!buildMode) return;
    const dist = GRID_SIZE;
    const rawX = playerBody.position.x - Math.sin(cameraYaw) * dist;
    const rawZ = playerBody.position.z - Math.cos(cameraYaw) * dist;
    const snapped = snapToGrid(rawX, playerBody.position.y, rawZ);
    const rotY = getCardinalYaw(cameraYaw);

    if (!previewMesh) { previewMesh = new THREE.Mesh(geoWall, new THREE.MeshBasicMaterial({color: 0x0088ff, opacity: 0.5, transparent: true})); scene.add(previewMesh); }
    previewMesh.position.set(snapped.x, snapped.y, snapped.z); previewMesh.userData.rotY = rotY; previewMesh.rotation.set(0,0,0);

    if (buildType === 'wall') { previewMesh.geometry = geoWall; previewMesh.position.y += GRID_SIZE/2; previewMesh.rotation.y = rotY; }
    else if (buildType === 'floor') { previewMesh.geometry = geoFloor; }
    else if (buildType === 'ramp') { previewMesh.geometry = geoRamp; previewMesh.position.y += GRID_SIZE/2; previewMesh.rotation.set(-Math.PI/4, rotY, 0, 'YXZ'); }
    if (checkStructuralIntegrity()) previewMesh.material.color.setHex(0x0088ff); else previewMesh.material.color.setHex(0xff0000); 
}

socket.on('initWorld', d => { d.buildings.forEach(createBuilding); d.crates.forEach(createCrate); });
socket.on('playerMoved', (data) => {
    if (data.id === socket.id) return;
    if (!otherPlayers[data.id]) { const enemy = createPlayerMesh(true); enemy.group.userData.id = data.id; enemy.group.traverse(c=>{c.userData.id=data.id;}); scene.add(enemy.group); otherPlayers[data.id] = enemy.group; }
    const p = otherPlayers[data.id]; p.position.set(data.x, data.y - (PLAYER_RADIUS - 0.2), data.z); p.rotation.y = data.rotation + Math.PI;
});
socket.on('playerDisconnected', id => { if (otherPlayers[id]) { scene.remove(otherPlayers[id]); delete otherPlayers[id]; } });
socket.on('newBuilding', createBuilding);
socket.on('objectDestroyed', id => { if(objectsMap[id]) { scene.remove(objectsMap[id].mesh); world.removeBody(objectsMap[id].body); delete objectsMap[id]; } });
socket.on('crateLooted', id => { if(cratesMap[id]) { scene.remove(cratesMap[id]); delete cratesMap[id]; } });
socket.on('updateStats', d => { document.getElementById('hp-bar').style.width = d.hp+'%'; document.getElementById('shield-bar').style.width = d.shield+'%'; });

// DEATH HANDLER with TIMER and MOBILE FIX
socket.on('playerEliminated', () => {
    isDead = true;
    document.getElementById('lobby-screen').style.display = 'block';
    controls.unlock();
    
    // Clear old timer if any
    if (respawnInterval) clearInterval(respawnInterval);

    const btnRejoin = document.getElementById('btn-rejoin');
    const timerBox = document.querySelector('.timer-box');
    
    // Disable button
    btnRejoin.style.opacity = '0.5';
    btnRejoin.style.pointerEvents = 'none';
    
    let timeLeft = 5;
    timerBox.innerText = `RESPAWN-TIMER: ${timeLeft}`;
    
    respawnInterval = setInterval(() => {
        timeLeft--;
        timerBox.innerText = `RESPAWN-TIMER: ${timeLeft}`;
        if(timeLeft <= 0) {
            clearInterval(respawnInterval);
            timerBox.innerText = "BEREIT!";
            timerBox.style.color = "lime";
            // Enable button
            btnRejoin.style.opacity = '1';
            btnRejoin.style.pointerEvents = 'auto'; // CRITICAL
        }
    }, 1000);
});

socket.on('playerRespawn', d => { 
    if(d.id===socket.id) { 
        playerBody.position.set(d.x,d.y,d.z); 
        playerBody.velocity.set(0,0,0); 
        isDead = false;
        document.getElementById('lobby-screen').style.display = 'none';
        controls.lock();
    } 
});

socket.on('remoteShoot', (data) => {
    if (data.origin && data.direction) {
        spawnProjectile(data.origin, data.direction);
    }
});

// UI EVENT LISTENERS
const btnRejoin = document.getElementById('btn-rejoin');
// Add Touchstart for Mobile
btnRejoin.addEventListener('touchstart', (e) => { e.preventDefault(); socket.emit('requestRespawn'); }, {passive: false});
btnRejoin.addEventListener('click', () => socket.emit('requestRespawn'));

function createCrate(data) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.7,0.7), new THREE.MeshStandardMaterial({color:0xA0522D})); m.position.set(data.x, 0.35, data.z); scene.add(m); cratesMap[data.id] = m; }
function createBuilding(data) {
    let shape, geo;
    const body = new CANNON.Body({ mass:0, type:CANNON.Body.STATIC, material: physicsMat, collisionFilterGroup: GROUP_SCENE, collisionFilterMask: GROUP_PLAYER|GROUP_SCENE });
    body.position.set(data.x, data.y, data.z);
    const q = new CANNON.Quaternion(); if(data.type === 'ramp') q.setFromEuler(-Math.PI/4, data.rotation, 0, 'YXZ'); else q.setFromEuler(0, data.rotation, 0); body.quaternion.copy(q);
    if(data.type === 'wall') { shape=new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, GRID_SIZE/2, 0.05)); geo=geoWall; }
    else if(data.type === 'floor') { shape=new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.05, GRID_SIZE/2)); geo=geoFloor; }
    else if(data.type === 'ramp') { const len=Math.sqrt(GRID_SIZE**2+GRID_SIZE**2); shape=new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.05, len/2)); geo=geoRamp; }
    body.addShape(shape); world.addBody(body);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color: 0xD2B48C}));
    mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.userData = { id: data.id, type: 'building' };
    scene.add(mesh); objectsMap[data.id] = { mesh, body };
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    
    if (isDead) { renderer.render(scene, camera); return; }

    world.step(1/60, delta, 3);

    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i]; const oldPos = p.mesh.position.clone();
        p.mesh.position.add(p.velocity.clone().multiplyScalar(delta)); p.life -= delta;
        const ray = new THREE.Raycaster(oldPos, p.velocity.clone().normalize(), 0, p.mesh.position.distanceTo(oldPos));
        
        const enemies = Object.values(otherPlayers);
        const enemyHits = ray.intersectObjects(enemies, true);
        if(enemyHits.length > 0) {
            let hit = enemyHits[0].object; while(hit.parent && !hit.userData.id) hit = hit.parent; 
            if(hit.userData.id) { socket.emit('shootPlayer', { targetId: hit.userData.id, damage: WEAPON_STATS[activeSlot].damage }); scene.remove(p.mesh); projectiles.splice(i, 1); continue; }
        }

        const hits = ray.intersectObjects(scene.children.filter(o => o.userData.type === 'building'));
        if (hits.length > 0) { if (hits[0].object.userData.id) socket.emit('hitObject', hits[0].object.userData.id); scene.remove(p.mesh); projectiles.splice(i, 1); continue; }
        if (p.life <= 0) { scene.remove(p.mesh); projectiles.splice(i, 1); }
    }

    // FIX: TIGHT CAMERA FOLLOW (Lerp 1.0)
    if (controls.isLocked || joyId !== null || lookId !== null) {
        const v = new THREE.Vector3(0,0,0);
        if(keys.w) v.z -= 1; if(keys.s) v.z += 1; if(keys.a) v.x -= 1; if(keys.d) v.x += 1;
        if(v.length()>0) { v.normalize().applyAxisAngle(new THREE.Vector3(0,1,0), cameraYaw); playerBody.velocity.x = v.x * MOVE_SPEED; playerBody.velocity.z = v.z * MOVE_SPEED; }
        else { playerBody.velocity.x *= 0.5; playerBody.velocity.z *= 0.5; }

        const rs = playerBody.position.clone(); const re = rs.clone(); re.y -= (PLAYER_RADIUS + 0.1);
        const ray = new CANNON.Ray(rs, re); ray.collisionFilterMask=GROUP_SCENE; ray.collisionFilterGroup=GROUP_PLAYER;
        const hit = world.raycastAny(rs, re, {}, new CANNON.RaycastResult());
        if(hit && keys.space && Math.abs(playerBody.velocity.y)<1) playerBody.velocity.y = JUMP_FORCE;

        localPlayer.group.rotation.y = cameraYaw + Math.PI;
        localPlayer.group.position.copy(playerBody.position);
        localPlayer.group.position.y -= (PLAYER_RADIUS - 0.2);

        if(recoilOffset > 0) { recoilOffset -= delta * 5; localPlayer.armL.rotation.x = -1.5 - recoilOffset; }
        else if(attackTimer > 0) { attackTimer -= delta * 5; localPlayer.armL.rotation.x = -Math.sin(attackTimer*Math.PI)*2; }
        else { localPlayer.armL.rotation.x = (activeSlot>=2 && !buildMode) ? -1.5 : (v.length()>0 ? -Math.sin(Date.now()*0.015) : 0); }
        
        if (v.length() > 0) { const t = Date.now() * 0.015; localPlayer.legL.rotation.x = Math.sin(t); localPlayer.legR.rotation.x = -Math.sin(t); }
        else { localPlayer.legL.rotation.x = 0; localPlayer.legR.rotation.x = 0; }

        socket.emit('movement', { x:playerBody.position.x, y:playerBody.position.y, z:playerBody.position.z, rotation:cameraYaw, id: socket.id });
        updateBuildPreview();
    }

    const camPos = localPlayer.group.position.clone();
    const off = CAMERA_OFFSET.clone().applyAxisAngle(new THREE.Vector3(0,1,0), cameraYaw);
    camPos.add(off);
    camera.position.lerp(camPos, 1.0); 
    camera.rotation.set(cameraPitch, cameraYaw, 0, 'YXZ');
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => { camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
