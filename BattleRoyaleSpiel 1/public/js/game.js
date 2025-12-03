import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { initAuth, UserData, saveSkin } from './auth.js';

// --- CONFIGURATION ---
const MODES = { LOBBY: 0, DEATHMATCH: 1, BATTLEROYALE: 2 };
let CURRENT_MODE = MODES.LOBBY;
let socket = null;

// --- THREE.JS & PHYSICS SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // Darker background for menu
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);

// --- GAME MANAGER STATE MACHINE ---
function switchGameMode(mode) {
    CURRENT_MODE = mode;
    
    // Clear current level
    cleanupScene();

    if (mode === MODES.LOBBY) {
        setupLobby();
    } 
    else if (mode === MODES.BATTLEROYALE) {
        setupBattleRoyale();
    } 
    else if (mode === MODES.DEATHMATCH) {
        setupDeathmatch();
    }
}

// --- 1. LOBBY LOGIC ---
let lobbyChar;
function setupLobby() {
    scene.background = new THREE.Color(0x334455); // Blue hangar color
    document.getElementById('lobby-ui').style.display = 'block';
    document.getElementById('game-hud').style.display = 'none';
    
    // Position Camera for Menu
    camera.position.set(0, 1.5, 4);
    camera.lookAt(0, 1, 0);

    // Add Player Model for Locker
    const geo = new THREE.BoxGeometry(1, 2, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: getSkinColor(UserData.currentSkin) });
    lobbyChar = new THREE.Mesh(geo, mat);
    lobbyChar.position.set(0, 1, 0);
    scene.add(lobbyChar);
    
    // Lights
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(2, 2, 5);
    scene.add(light);
}

// Locker Logic
document.getElementById('btn-locker').addEventListener('click', () => {
    // Simple toggle for demo
    const nextSkin = UserData.currentSkin === 'default' ? 'gold' : 'default';
    saveSkin(nextSkin);
    if(lobbyChar) lobbyChar.material.color.setHex(getSkinColor(nextSkin));
});

function getSkinColor(id) {
    return id === 'gold' ? 0xffd700 : 0x00ff00;
}

// --- 2. BATTLE ROYALE LOGIC ---
let playerBody, playerMesh;
let isGliding = false;

function setupBattleRoyale() {
    document.getElementById('lobby-ui').style.display = 'none';
    document.getElementById('game-hud').style.display = 'block';
    scene.background = new THREE.Color(0x87CEEB); // Sky blue
    
    controls.lock();

    // 1. MAP GENERATION (Procedural City)
    createCity();

    // 2. SPAWN LOGIC (Battle Bus Jump)
    createPlayer(0, 200, 0); // High Y for jump
    
    // 3. LOOT CHESTS
    createChest(10, 0.5, 10);
    createChest(-20, 0.5, -15);
}

function createPlayer(x, y, z) {
    // Cannon Body
    const shape = new CANNON.Sphere(0.5);
    playerBody = new CANNON.Body({ mass: 60, shape: shape, position: new CANNON.Vec3(x, y, z), linearDamping: 0.9 });
    playerBody.fixedRotation = true;
    world.addBody(playerBody);

    // Three Mesh
    const geo = new THREE.BoxGeometry(1, 2, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: getSkinColor(UserData.currentSkin) });
    playerMesh = new THREE.Mesh(geo, mat);
    scene.add(playerMesh);
}

function createCity() {
    // Floor
    const floorGeo = new THREE.PlaneGeometry(500, 500);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x228b22 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI/2;
    scene.add(floor);
    
    const floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floorBody.quaternion.setFromEuler(-Math.PI/2, 0, 0);
    world.addBody(floorBody);

    // Random Houses (Destructible)
    for(let i=0; i<20; i++) {
        const x = (Math.random()-0.5)*200;
        const z = (Math.random()-0.5)*200;
        createDestructibleWall(x, 2, z);
    }
}

// --- DESTRUCTION SYSTEM ---
function createDestructibleWall(x, y, z) {
    const geo = new THREE.BoxGeometry(4, 4, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData = { hp: 100, type: 'wall' }; // HP Data
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 5, shape: new CANNON.Box(new CANNON.Vec3(2, 2, 0.5)) });
    body.position.set(x, y, z);
    world.addBody(body);
    
    // Link for deletion
    mesh.userData.physicsBody = body; 
}

function damageObject(mesh, damage) {
    if(mesh.userData.hp) {
        mesh.userData.hp -= damage;
        mesh.material.color.setHex(0xff0000); // Flash red
        
        if(mesh.userData.hp <= 0) {
            // DESTRUCTION
            scene.remove(mesh);
            if(mesh.userData.physicsBody) world.removeBody(mesh.userData.physicsBody);
        }
    }
}

// --- LOOT CHESTS ---
function createChest(x, y, z) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xFFFF00 }); // Yellow
    const chest = new THREE.Mesh(geo, mat);
    chest.position.set(x, y, z);
    chest.userData = { type: 'chest' };
    scene.add(chest);
}

// --- MAIN LOOP & INPUTS ---
const controls = new PointerLockControls(camera, document.body);
const keys = { w: false, a: false, s: false, d: false, space: false };

document.addEventListener('keydown', (e) => {
    if(e.code === 'KeyW') keys.w = true;
    if(e.code === 'KeyS') keys.s = true;
    if(e.code === 'KeyA') keys.a = true;
    if(e.code === 'KeyD') keys.d = true;
    if(e.code === 'Space') keys.space = true;
    if(e.code === 'KeyE') checkInteraction(); // Loot
    if(e.code === 'KeyF') shoot(); // Shoot/Destroy
});

document.addEventListener('keyup', (e) => {
    if(e.code === 'KeyW') keys.w = false;
    if(e.code === 'KeyS') keys.s = false;
    if(e.code === 'KeyA') keys.a = false;
    if(e.code === 'KeyD') keys.d = false;
    if(e.code === 'Space') keys.space = false;
});

// Play Buttons
document.getElementById('btn-play-br').addEventListener('click', () => switchGameMode(MODES.BATTLEROYALE));
document.getElementById('btn-play-dm').addEventListener('click', () => switchGameMode(MODES.DEATHMATCH));

function checkInteraction() {
    if(CURRENT_MODE !== MODES.BATTLEROYALE) return;
    
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0,0), camera);
    const hits = ray.intersectObjects(scene.children);
    
    if(hits.length > 0 && hits[0].distance < 3) {
        if(hits[0].object.userData.type === 'chest') {
            console.log("LOOTED!");
            scene.remove(hits[0].object); // Remove chest
            // Add weapon logic here
        }
    }
}

function shoot() {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0,0), camera);
    const hits = ray.intersectObjects(scene.children);
    if(hits.length > 0) {
        damageObject(hits[0].object, 50); // Deal 50 dmg
    }
}

function animate() {
    requestAnimationFrame(animate);
    
    if (CURRENT_MODE === MODES.LOBBY) {
        if(lobbyChar) lobbyChar.rotation.y += 0.01; // Idle Spin
        renderer.render(scene, camera);
        return;
    }

    world.step(1/60);

    // Player Physics Sync
    if(playerBody && playerMesh) {
        playerMesh.position.copy(playerBody.position);
        playerMesh.quaternion.copy(playerBody.quaternion);
        
        // Camera Follow
        camera.position.copy(playerBody.position);
        camera.position.y += 1.5;
    }

    // Movement Logic
    if(playerBody) {
        const speed = 10;
        const velocity = new CANNON.Vec3(0, playerBody.velocity.y, 0);
        
        // Basic movement calc (omitted for brevity, assume standard WASD->Velocity)
        
        // GLIDING LOGIC (Battle Royale)
        if(CURRENT_MODE === MODES.BATTLEROYALE) {
            if(playerBody.position.y > 5 && keys.space && playerBody.velocity.y < 0) {
                // Gliding: Reduce fall speed drastically
                playerBody.velocity.y = -2; 
                // Add forward momentum while gliding
            }
        }
        
        playerBody.velocity.x = velocity.x;
        playerBody.velocity.z = velocity.z;
    }

    renderer.render(scene, camera);
}

function cleanupScene() {
    while(scene.children.length > 0){ 
        scene.remove(scene.children[0]); 
    }
    // Re-add lights intentionally in setup
}

// START
initAuth(() => switchGameMode(MODES.LOBBY));
animate();