import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBayHgnLqeYYR_Wdu2_rkUBJu9Fh_y3Wy0",
  authDomain: "battle-royale-8a56d.firebaseapp.com",
  projectId: "battle-royale-8a56d",
  storageBucket: "battle-royale-8a56d.firebasestorage.app",
  messagingSenderId: "947963943120",
  appId: "1:947963943120:web:31ef9dca35995ef548e6d5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();

// === GLOBALS ===
let scene, camera, renderer, socket;
let myPlayerGroup, myPlayerMixer; // Für Animationen
let otherPlayers = {}; 
let buildings = []; 
let terrainMesh; // Der Boden
let inputs = { w: false, a: false, s: false, d: false, space: false };
let isLocked = false; // Mouse Lock Status

// Game State
let isBuildMode = false;
let currentBuildType = 'wall';
let ghostMesh;
let ammo = 30;
let health = 100;
let velocityY = 0;
let isGrounded = false;
let playerName = "Player";
let stormRadius = 300;
let stormMesh;

// Simplex Noise für Terrain
const simplex = new SimplexNoise();

// === LOGIN LOGIC ===
const emailInput = document.getElementById('inp-email');
const passInput = document.getElementById('inp-password');
const userInput = document.getElementById('inp-username');
const errorMsg = document.getElementById('error-msg');

document.getElementById('btn-register').addEventListener('click', () => {
    if(!emailInput.value || !passInput.value) return showError("Daten fehlen!");
    createUserWithEmailAndPassword(auth, emailInput.value, passInput.value)
        .then((creds) => updateProfile(creds.user, { displayName: userInput.value }).then(() => startGame(userInput.value)))
        .catch((err) => showError(err.message));
});

document.getElementById('btn-login').addEventListener('click', () => {
    signInWithEmailAndPassword(auth, emailInput.value, passInput.value)
        .then((creds) => startGame(creds.user.displayName || "Player"))
        .catch(() => showError("Login fehlgeschlagen."));
});

function showError(msg) { errorMsg.innerText = msg; errorMsg.style.display = 'block'; }
function startGame(name) {
    playerName = name;
    document.getElementById('login-screen').style.display = 'none';
    init();
}

// === ENGINE SETUP ===
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); 
    scene.fog = new THREE.Fog(0x87CEEB, 20, 150); // Nebel für Atmosphäre

    // CAMERA SETUP (Third Person Offset wird in animate gemacht)
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; // Schatten an!
    document.body.appendChild(renderer.domElement);

    // LICHT
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    scene.add(dirLight);

    createEnvironment();
    createStorm();
    
    // Initialen Spieler erstellen (noch unsichtbar bis Server connect)
    createMyPlayerModel();

    initSocket();
    setupInputs();
    
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

// === WELT GENERIERUNG (Berge & Bäume) ===
function createEnvironment() {
    // 1. TERRAIN (Bergig)
    const geo = new THREE.PlaneGeometry(600, 600, 64, 64);
    const posAttribute = geo.attributes.position;
    
    for (let i = 0; i < posAttribute.count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i);
        // Noise für Hügel: Höhe basierend auf X/Y
        const z = simplex.noise2D(x * 0.01, y * 0.01) * 15 + simplex.noise2D(x * 0.03, y * 0.03) * 5;
        // Ränder hochziehen (Insel)
        const dist = Math.sqrt(x*x + y*y);
        const islandMask = Math.max(0, dist - 250) * 0.5;
        
        posAttribute.setZ(i, z + islandMask); 
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x33aa33, roughness: 0.8 });
    terrainMesh = new THREE.Mesh(geo, mat);
    terrainMesh.rotation.x = -Math.PI / 2;
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // 2. BÄUME
    for(let i=0; i<100; i++) {
        const x = (Math.random() - 0.5) * 500;
        const z = (Math.random() - 0.5) * 500;
        const y = getTerrainHeight(x, z);
        if(y > 50) continue; // Keine Bäume im Wasser/Außen

        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 3), new THREE.MeshLambertMaterial({color: 0x8B4513}));
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(3, 6, 8), new THREE.MeshLambertMaterial({color: 0x006400}));
        
        trunk.position.set(x, y + 1.5, z);
        leaves.position.set(x, y + 5, z);
        
        trunk.castShadow = true; leaves.castShadow = true;
        scene.add(trunk); scene.add(leaves);
        buildings.push(trunk); // Bäume haben Kollision
    }
}

// Helfer: Höhe des Bodens an Position X,Z berechnen
function getTerrainHeight(x, z) {
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    const intersects = raycaster.intersectObject(terrainMesh);
    return intersects.length > 0 ? intersects[0].point.y : 0;
}

// === SPIELER MODELL (Roboter mit Animation) ===
function createPlayerMesh(color) {
    const group = new THREE.Group();

    const mat = new THREE.MeshStandardMaterial({ color: color });
    
    // Körper
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.6), mat);
    body.position.y = 1.5;
    body.castShadow = true;
    group.add(body);

    // Kopf
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({color: 0xffccaa}));
    head.position.y = 2.6;
    group.add(head);

    // Arme & Beine (als separate Meshes für Animation)
    const limbGeo = new THREE.BoxGeometry(0.3, 1.2, 0.3);
    
    const legL = new THREE.Mesh(limbGeo, mat); legL.position.set(-0.3, 0.6, 0);
    const legR = new THREE.Mesh(limbGeo, mat); legR.position.set(0.3, 0.6, 0);
    const armL = new THREE.Mesh(limbGeo, mat); armL.position.set(-0.7, 2, 0);
    const armR = new THREE.Mesh(limbGeo, mat); armR.position.set(0.7, 2, 0);

    group.add(legL, legR, armL, armR);

    // Referenzen speichern für Animation
    group.userData = { legL, legR, armL, armR, body, head };
    return group;
}

function createMyPlayerModel() {
    myPlayerGroup = createPlayerMesh(0x0000FF);
    myPlayerGroup.position.set(0, 10, 0);
    scene.add(myPlayerGroup);
}

// === GAMEPLAY ===
function createStorm() {
    const geo = new THREE.CylinderGeometry(stormRadius, stormRadius, 100, 32, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0x5500ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    stormMesh = new THREE.Mesh(geo, mat);
    stormMesh.position.y = 50;
    scene.add(stormMesh);
}

function updateStorm() {
    if(stormRadius > 20) stormRadius -= 0.05; // Sturm wird kleiner
    stormMesh.scale.set(stormRadius/300, 1, stormRadius/300); // Visuell skalieren
    
    // Check Damage
    const dist = Math.sqrt(myPlayerGroup.position.x**2 + myPlayerGroup.position.z**2);
    // Skalierung beachten (der Radius im Mesh ist initial 300)
    if(dist > stormRadius) {
        if(Math.random() > 0.95) health -= 1; // Langsam Schaden
        updateHealthUI();
    }
}

function updateHealthUI() {
    document.getElementById('health-fill').style.width = health + '%';
    if(health <= 0) { alert("Vom Sturm eliminiert!"); location.reload(); }
}

// === MULTIPLAYER SOCKET ===
function initSocket() {
    socket = window.io();
    socket.on('initGame', (data) => {
        for (let id in data.players) {
            if (id !== socket.id) createOtherPlayer(data.players[id]);
        }
        if(data.buildings) data.buildings.forEach(b => createBuildingBlock(b));
    });

    socket.on('newPlayer', createOtherPlayer);
    socket.on('updatePlayer', (data) => {
        const p = otherPlayers[data.id];
        if (p) {
            p.position.lerp(new THREE.Vector3(data.x, data.y, data.z), 0.2); // Interpolation
            p.rotation.y = data.rotation;
            // Einfache Lauf-Animation basierend auf Bewegung
            animateCharacter(p, true); 
        }
    });
    socket.on('removePlayer', (id) => { if(otherPlayers[id]) { scene.remove(otherPlayers[id]); delete otherPlayers[id]; }});
    socket.on('newBuild', createBuildingBlock);
    socket.on('shoot', (data) => {
         // Treffer Feedback
         if(data.targetId === socket.id) {
             health -= 10; updateHealthUI();
         }
    });
}

function createOtherPlayer(data) {
    const mesh = createPlayerMesh(0xFF0000);
    mesh.position.set(data.x, data.y, data.z);
    otherPlayers[data.id] = mesh;
    scene.add(mesh);
}

// === BAU SYSTEM ===
function toggleBuildMode() {
    isBuildMode = !isBuildMode;
    // UI Update
    document.getElementById('b-toggle').style.background = isBuildMode ? 'rgba(0,255,0,0.5)' : '';
    if (isBuildMode) createGhost();
    else if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
}

function setBuildType(type) {
    currentBuildType = type;
    document.querySelectorAll('.build-item').forEach(el => el.classList.remove('selected'));
    document.getElementById(`b-${type}`).classList.add('selected');
    if(isBuildMode) createGhost();
}

function createGhost() {
    if(ghostMesh) scene.remove(ghostMesh);
    let geo;
    if(currentBuildType === 'wall') geo = new THREE.BoxGeometry(4, 4, 0.2);
    else if(currentBuildType === 'floor') geo = new THREE.BoxGeometry(4, 0.2, 4);
    else if(currentBuildType === 'ramp') geo = new THREE.BoxGeometry(4, 0.2, 5); 

    const mat = new THREE.MeshBasicMaterial({ color: 0x00FFFF, opacity: 0.5, transparent: true });
    ghostMesh = new THREE.Mesh(geo, mat);
    scene.add(ghostMesh);
}

function updateGhost() {
    if (!isBuildMode || !ghostMesh) return;
    
    // Raycast von Kamera Mitte
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
    const intersects = raycaster.intersectObject(terrainMesh); // Baue auf Terrain
    
    if(intersects.length > 0) {
        const p = intersects[0].point;
        ghostMesh.position.x = Math.round(p.x / 4) * 4;
        ghostMesh.position.z = Math.round(p.z / 4) * 4;
        ghostMesh.position.y = Math.round(p.y / 4) * 4 + 2; // Grid Snap Height

        const rotY = myPlayerGroup.rotation.y;
        const snappedRot = Math.round(rotY / (Math.PI/2)) * (Math.PI/2);
        ghostMesh.rotation.set(0, snappedRot, 0);

        if(currentBuildType === 'ramp') ghostMesh.rotation.x = -Math.PI/4;
        if(currentBuildType === 'floor') { ghostMesh.position.y -= 2; ghostMesh.rotation.x = 0; }
    }
}

function placeBuild() {
    if(!isBuildMode || !ghostMesh) return;
    const data = {
        type: currentBuildType,
        x: ghostMesh.position.x, y: ghostMesh.position.y, z: ghostMesh.position.z,
        rx: ghostMesh.rotation.x, ry: ghostMesh.rotation.y, rz: ghostMesh.rotation.z
    };
    socket.emit('placeBuild', data);
}

function createBuildingBlock(data) {
    let geo;
    if(data.type === 'wall') geo = new THREE.BoxGeometry(4, 4, 0.2);
    else if(data.type === 'floor') geo = new THREE.BoxGeometry(4, 0.2, 4);
    else if(data.type === 'ramp') geo = new THREE.BoxGeometry(4, 0.2, 5);
    else geo = new THREE.BoxGeometry(4, 4, 1);
    
    const mat = new THREE.MeshStandardMaterial({ map: getWoodTexture() });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(data.x, data.y, data.z);
    mesh.rotation.set(data.rx || 0, data.ry || 0, data.rz || 0);
    scene.add(mesh);
    buildings.push(mesh);
}

function getWoodTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8B4513'; ctx.fillRect(0,0,64,64);
    ctx.strokeStyle = '#5c2e0b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(64,64); ctx.stroke();
    return new THREE.CanvasTexture(c);
}

// === CONTROLS & PHYSICS ===
function setupInputs() {
    document.addEventListener('keydown', e => {
        const k = e.key.toLowerCase();
        if(k in inputs) inputs[k] = true;
        if(k === ' ') inputs.space = true;
        if(k === 'f') toggleBuildMode();
        if(k === '1') setBuildType('wall');
        if(k === '2') setBuildType('floor');
        if(k === '3') setBuildType('ramp');
    });
    document.addEventListener('keyup', e => {
        const k = e.key.toLowerCase();
        if(k in inputs) inputs[k] = false;
        if(k === ' ') inputs.space = false;
    });

    // POINTER LOCK (Maus fangen)
    document.addEventListener('click', () => {
        if(!isLocked && document.getElementById('login-screen').style.display === 'none') {
            document.body.requestPointerLock();
        } else {
            if(isBuildMode) placeBuild(); else shoot();
        }
    });
    document.addEventListener('pointerlockchange', () => {
        isLocked = document.pointerLockElement === document.body;
    });
    document.addEventListener('mousemove', e => {
        if(isLocked) {
            myPlayerGroup.rotation.y -= e.movementX * 0.002;
            // Kamera Pitch könnte man hier noch einbauen
        }
    });

    // TOUCH & BUTTONS
    const bindBtn = (id, fn) => {
        const el = document.getElementById(id);
        el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); });
    };
    bindBtn('b-wall', () => setBuildType('wall'));
    bindBtn('b-floor', () => setBuildType('floor'));
    bindBtn('b-ramp', () => setBuildType('ramp'));
    bindBtn('b-toggle', toggleBuildMode);
    bindBtn('btn-shoot', () => isBuildMode ? placeBuild() : shoot());
    bindBtn('btn-jump', () => { if(isGrounded) velocityY = 0.5; });
    
    // Joystick
    // (Vereinfacht: Tippen links bewegt nach vorne)
    const stickZone = document.getElementById('stick-zone');
    stickZone.addEventListener('touchstart', () => inputs.w = true);
    stickZone.addEventListener('touchend', () => inputs.w = false);
}

function shoot() {
    if(ammo <= 0) return;
    ammo--; document.getElementById('ammo-count').innerText = ammo;
    
    const raycaster = new THREE.Raycaster();
    const dir = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), myPlayerGroup.rotation.y);
    // Raycast etwas höher (Kopfhöhe)
    raycaster.set(myPlayerGroup.position.clone().add(new THREE.Vector3(0,2,0)), dir);
    
    const intersects = raycaster.intersectObjects(Object.values(otherPlayers).map(g => g.children[0])); // Hit Body
    if(intersects.length > 0) {
        const hitMesh = intersects[0].object.parent; // Group finden
        const targetId = Object.keys(otherPlayers).find(k => otherPlayers[k] === hitMesh);
        if(targetId) socket.emit('shoot', { targetId });
    }
}

// === ANIMATION LOOP ===
function animateCharacter(group, isMoving) {
    const time = Date.now() * 0.01;
    const parts = group.userData;
    if(isMoving) {
        // Laufbewegung (Sinus)
        parts.legL.rotation.x = Math.sin(time) * 0.5;
        parts.legR.rotation.x = Math.sin(time + Math.PI) * 0.5;
        parts.armL.rotation.x = Math.sin(time + Math.PI) * 0.5;
        parts.armR.rotation.x = Math.sin(time) * 0.5;
    } else {
        // Reset
        parts.legL.rotation.x = 0; parts.legR.rotation.x = 0;
        parts.armL.rotation.x = 0; parts.armR.rotation.x = 0;
    }
}

function animate() {
    requestAnimationFrame(animate);
    
    updateStorm();
    updateGhost();

    if(myPlayerGroup) {
        // Physik
        const terrainH = getTerrainHeight(myPlayerGroup.position.x, myPlayerGroup.position.z);
        
        velocityY -= 0.02; // Gravitation
        myPlayerGroup.position.y += velocityY;

        if(myPlayerGroup.position.y < terrainH) {
            myPlayerGroup.position.y = terrainH;
            velocityY = 0;
            isGrounded = true;
        } else {
            isGrounded = false;
        }
        if(inputs.space && isGrounded) { velocityY = 0.5; }

        // Bewegung
        const speed = 0.4;
        const dir = new THREE.Vector3();
        if(inputs.w) dir.z -= speed;
        if(inputs.s) dir.z += speed;
        if(inputs.a) dir.x -= speed;
        if(inputs.d) dir.x += speed;
        dir.applyAxisAngle(new THREE.Vector3(0,1,0), myPlayerGroup.rotation.y);
        
        // Kollision (Wände)
        const nextPos = myPlayerGroup.position.clone().add(dir);
        const pBox = new THREE.Box3().setFromCenterAndSize(nextPos.clone().add(new THREE.Vector3(0,1.5,0)), new THREE.Vector3(1,3,1));
        let collision = false;
        for(let b of buildings) {
            if(pBox.intersectsBox(new THREE.Box3().setFromObject(b))) collision = true;
        }

        if(!collision) myPlayerGroup.position.add(dir);

        // Animation
        const isMoving = dir.length() > 0;
        animateCharacter(myPlayerGroup, isMoving);

        // Third Person Camera Follow (Rechts über Schulter)
        const offset = new THREE.Vector3(2, 4, 6); // Rechts 2, Hoch 4, Zurück 6
        offset.applyAxisAngle(new THREE.Vector3(0,1,0), myPlayerGroup.rotation.y);
        const camPos = myPlayerGroup.position.clone().add(offset);
        
        camera.position.lerp(camPos, 0.1); // Weiches Folgen
        
        // Kamera schaut vor den Spieler (Zielpunkt)
        const lookTarget = myPlayerGroup.position.clone().add(new THREE.Vector3(0, 2, 0)); // Kopfhöhe
        // Wir schauen etwas in die Ferne vor den Spieler
        const forward = new THREE.Vector3(0,0,-10).applyAxisAngle(new THREE.Vector3(0,1,0), myPlayerGroup.rotation.y);
        camera.lookAt(lookTarget.add(forward));

        // Socket Sync
        if(isMoving || velocityY !== 0) {
            socket.emit('playerMove', {
                x: myPlayerGroup.position.x, y: myPlayerGroup.position.y, z: myPlayerGroup.position.z,
                rotation: myPlayerGroup.rotation.y
            });
        }
    }

    renderer.render(scene, camera);
}