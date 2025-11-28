// === FIREBASE IMPORTS ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";

// === DEINE CONFIG ===
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
const provider = new GoogleAuthProvider();

// === GLOBALE VARIABLEN ===
let scene, camera, renderer, socket;
let myPlayerMesh;
let otherPlayers = {}; 
let buildings = []; // Array von THREE.Mesh Objekten für Kollision
let inputs = { w: false, a: false, s: false, d: false };

// Spiel Status
let isBuildMode = false;
let currentBuildType = 'wall'; // 'wall', 'floor', 'ramp'
let ghostMesh;
let ammo = 30;
let health = 100;
let speed = 0.3;
let velocityY = 0; // Für Springen
let isGrounded = true;
let playerName = "Guest";

// === LOGIN LOGIC ===
document.getElementById('login-btn').addEventListener('click', () => {
    signInWithPopup(auth, provider).then((result) => {
        playerName = result.user.displayName;
        document.getElementById('login-screen').style.display = 'none';
        init(); // Spiel erst starten nach Login
    }).catch((error) => {
        alert("Login Fehler: " + error.message);
    });
});

// === INITIALISIERUNG ===
function init() {
    // Three.js Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Performance auf Mobile
    document.body.appendChild(renderer.domElement);

    // Licht
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    scene.add(dirLight);

    // Boden
    const floorGeo = new THREE.PlaneGeometry(500, 500);
    const floorMat = new THREE.MeshPhongMaterial({ color: 0x228B22 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    initSocket();
    setupInputs();
    
    // Resize Handler (fix white screen on mobile rotate)
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

function initSocket() {
    // Socket.io wird global geladen durch script tag, aber wir brauchen window.io
    socket = window.io();

    socket.on('initGame', (data) => {
        for (let id in data.players) {
            if (id === socket.id) createMyPlayer(data.players[id]);
            else createOtherPlayer(data.players[id]);
        }
        // Existierende Gebäude laden
        if(data.buildings) {
            data.buildings.forEach(b => createBuildingBlock(b));
        }
    });

    socket.on('newPlayer', (p) => createOtherPlayer(p));
    
    socket.on('updatePlayer', (data) => {
        if (otherPlayers[data.id]) {
            otherPlayers[data.id].position.set(data.x, data.y, data.z);
            otherPlayers[data.id].rotation.y = data.rotation;
        }
    });

    socket.on('removePlayer', (id) => {
        if (otherPlayers[id]) {
            scene.remove(otherPlayers[id]);
            delete otherPlayers[id];
        }
    });

    socket.on('newBuild', (data) => createBuildingBlock(data));

    socket.on('damaged', (newHp) => {
        health = newHp;
        document.getElementById('health-bar').innerText = `HP: ${health}`;
        if(health <= 0) alert("Eliminiert!");
    });
}

function createMyPlayer(data) {
    const geo = new THREE.BoxGeometry(1, 2, 1);
    const mat = new THREE.MeshPhongMaterial({ color: 0x0000FF });
    myPlayerMesh = new THREE.Mesh(geo, mat);
    myPlayerMesh.position.set(data.x, data.y, data.z);
    // Wir fügen den Spieler NICHT zur Scene hinzu, damit die Kamera nicht "in" ihm ist, 
    // oder wir machen ihn unsichtbar für uns selbst.
    // Aber für Kollision und Schatten ist er gut.
    scene.add(myPlayerMesh);
}

function createOtherPlayer(data) {
    const geo = new THREE.BoxGeometry(1, 2, 1);
    const mat = new THREE.MeshPhongMaterial({ color: 0xFF0000 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(data.x, data.y, data.z);
    otherPlayers[data.id] = mesh;
    scene.add(mesh);
}

// === KOLLISION ===
function checkCollision(newPos) {
    // Erstelle Box für Spieler an neuer Position
    const playerBox = new THREE.Box3().setFromCenterAndSize(newPos, new THREE.Vector3(1, 2, 1));
    
    for (let b of buildings) {
        const buildBox = new THREE.Box3().setFromObject(b);
        if (playerBox.intersectsBox(buildBox)) {
            return true; // Kollision gefunden
        }
    }
    return false;
}

// === BAU SYSTEM UPDATE ===
function toggleBuildMode() {
    isBuildMode = !isBuildMode;
    const menu = document.getElementById('build-menu');
    menu.style.display = isBuildMode ? 'flex' : 'none';
    
    if (isBuildMode) {
        createGhost();
    } else {
        if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
    }
}

function setBuildType(type) {
    currentBuildType = type;
    // UI Update
    document.querySelectorAll('.build-item').forEach(el => el.classList.remove('selected'));
    document.getElementById(`b-${type}`).classList.add('selected');
    // Ghost neu erstellen für neue Form
    if(isBuildMode) createGhost();
}

function createGhost() {
    if(ghostMesh) scene.remove(ghostMesh);
    
    let geo;
    if(currentBuildType === 'wall') geo = new THREE.BoxGeometry(4, 4, 0.5);
    else if(currentBuildType === 'floor') geo = new THREE.BoxGeometry(4, 0.5, 4);
    else if(currentBuildType === 'ramp') geo = new THREE.BoxGeometry(4, 0.5, 5); // Rampen sind flach aber rotiert

    const mat = new THREE.MeshBasicMaterial({ color: 0x00FFFF, opacity: 0.5, transparent: true });
    ghostMesh = new THREE.Mesh(geo, mat);
    scene.add(ghostMesh);
}

function updateGhostMesh() {
    if (!isBuildMode || !ghostMesh || !myPlayerMesh) return;

    const offsetDist = 5;
    const offset = new THREE.Vector3(0, 0, -offsetDist);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), myPlayerMesh.rotation.y);
    const targetPos = myPlayerMesh.position.clone().add(offset);

    // Grid Snapping
    ghostMesh.position.x = Math.round(targetPos.x / 4) * 4;
    ghostMesh.position.z = Math.round(targetPos.z / 4) * 4;
    
    // Rotation Snapping
    let rotY = myPlayerMesh.rotation.y;
    // Runde auf 90 Grad (PI/2)
    let snappedRot = Math.round(rotY / (Math.PI/2)) * (Math.PI/2);
    
    ghostMesh.rotation.set(0,0,0); // Reset

    if(currentBuildType === 'wall') {
        ghostMesh.position.y = 2; 
        ghostMesh.rotation.y = snappedRot;
    } 
    else if(currentBuildType === 'floor') {
        ghostMesh.position.y = 0.25; // Am Boden
    } 
    else if(currentBuildType === 'ramp') {
        ghostMesh.position.y = 1; // Etwas höher
        ghostMesh.rotation.y = snappedRot;
        ghostMesh.rotation.x = -Math.PI / 4; // 45 Grad schräg
    }
}

function tryPlaceBuild() {
    if (!isBuildMode || !ghostMesh) return;

    // Sende Daten an Server
    const buildData = {
        type: currentBuildType,
        x: ghostMesh.position.x,
        y: ghostMesh.position.y,
        z: ghostMesh.position.z,
        rx: ghostMesh.rotation.x,
        ry: ghostMesh.rotation.y,
        rz: ghostMesh.rotation.z
    };
    socket.emit('placeBuild', buildData);
}

function createBuildingBlock(data) {
    let geo;
    if(data.type === 'wall') geo = new THREE.BoxGeometry(4, 4, 0.5);
    else if(data.type === 'floor') geo = new THREE.BoxGeometry(4, 0.5, 4);
    else if(data.type === 'ramp') geo = new THREE.BoxGeometry(4, 0.5, 5);
    else geo = new THREE.BoxGeometry(4, 4, 1); // Fallback

    const mat = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
    const mesh = new THREE.Mesh(geo, mat);
    
    // Position & Rotation übernehmen
    if(data.rx !== undefined) {
        mesh.position.set(data.x, data.y, data.z);
        mesh.rotation.set(data.rx, data.ry, data.rz);
    } else {
        // Fallback für alte Daten
        mesh.position.set(data.x, data.y, data.z);
        mesh.rotation.y = data.rotation || 0;
    }
    
    scene.add(mesh);
    buildings.push(mesh);
}

function shoot() {
    if (ammo <= 0) return;
    ammo--;
    document.getElementById('ammo-bar').innerText = `AMMO: ${ammo}`;
    // Einfache Animation
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({color:0xffff00}));
    flash.position.set(0,0,-2);
    camera.add(flash);
    setTimeout(()=>camera.remove(flash), 50);

    const raycaster = new THREE.Raycaster();
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), myPlayerMesh.rotation.y);
    raycaster.set(myPlayerMesh.position, dir);

    const targets = Object.values(otherPlayers);
    const intersects = raycaster.intersectObjects(targets);
    if (intersects.length > 0) {
        const hitObj = intersects[0].object;
        const targetId = Object.keys(otherPlayers).find(k => otherPlayers[k] === hitObj);
        if (targetId) socket.emit('shoot', { targetId });
    }
}

// === INPUT SETUP ===
function setupInputs() {
    // Tastatur
    document.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (inputs[k] !== undefined) inputs[k] = true;
        if (k === ' ') { if(isGrounded) velocityY = 0.5; isGrounded = false; }
        if (k === 'f') toggleBuildMode();
        if (k === '1') setBuildType('wall');
        if (k === '2') setBuildType('floor');
        if (k === '3') setBuildType('ramp');
    });
    
    document.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        if (inputs[k] !== undefined) inputs[k] = false;
    });

    document.addEventListener('mousedown', (e) => {
        // Ignorieren wenn Klick auf UI (wie Login oder Buttons)
        if(e.target.closest('button') || e.target.closest('.build-item')) return;
        
        if (isBuildMode) tryPlaceBuild();
        else shoot();
    });

    document.addEventListener('mousemove', (e) => {
        if(myPlayerMesh && !document.getElementById('login-screen').style.display === 'none') {
             myPlayerMesh.rotation.y -= e.movementX * 0.005;
        }
    });

    // Touch Events (Mobile Fix)
    const btnShoot = document.getElementById('btn-shoot');
    const btnBuild = document.getElementById('btn-build');
    const btnJump = document.getElementById('btn-jump');
    const btnFwd = document.getElementById('btn-fwd');
    const bWall = document.getElementById('b-wall');
    const bFloor = document.getElementById('b-floor');
    const bRamp = document.getElementById('b-ramp');

    // Prevent Default verhindert Scrollen/Zoomen beim Button-Drücken
    const touchHandler = (btn, action) => {
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); action(true); }, {passive: false});
        btn.addEventListener('touchend', (e) => { e.preventDefault(); action(false); }, {passive: false});
    };

    touchHandler(btnFwd, (state) => inputs.w = state);
    touchHandler(btnJump, (state) => { if(state && isGrounded) { velocityY = 0.5; isGrounded = false; } });
    
    btnShoot.addEventListener('touchstart', (e) => { 
        e.preventDefault(); 
        if(isBuildMode) tryPlaceBuild(); else shoot(); 
    });
    
    btnBuild.addEventListener('touchstart', (e) => { e.preventDefault(); toggleBuildMode(); });
    
    // Build Auswahl Touch
    bWall.addEventListener('touchstart', (e) => { e.preventDefault(); setBuildType('wall'); });
    bFloor.addEventListener('touchstart', (e) => { e.preventDefault(); setBuildType('floor'); });
    bRamp.addEventListener('touchstart', (e) => { e.preventDefault(); setBuildType('ramp'); });
    
    // Mobile Dreh-Steuerung (Rechte Bildschirmhälfte wischen)
    let lastTouchX = 0;
    document.addEventListener('touchstart', e => { lastTouchX = e.touches[0].clientX; });
    document.addEventListener('touchmove', e => {
        const deltaX = e.touches[0].clientX - lastTouchX;
        lastTouchX = e.touches[0].clientX;
        if(myPlayerMesh) myPlayerMesh.rotation.y -= deltaX * 0.005;
    });
}

function animate() {
    requestAnimationFrame(animate);

    if (myPlayerMesh) {
        // Gravitation
        velocityY -= 0.02; 
        let nextPos = myPlayerMesh.position.clone();
        nextPos.y += velocityY;

        // Boden Kollision (Simple)
        if(nextPos.y < 2) { // 2 = Hälfte der Spielerhöhe + Boden
             nextPos.y = 2; 
             velocityY = 0; 
             isGrounded = true; 
        }

        // Horizontal Bewegung
        const dir = new THREE.Vector3();
        if (inputs.w) dir.z -= speed;
        if (inputs.s) dir.z += speed;
        if (inputs.a) dir.x -= speed;
        if (inputs.d) dir.x += speed;
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), myPlayerMesh.rotation.y);
        
        // Kollisions-Check (Vorwärts)
        let potentialPos = nextPos.clone().add(dir);
        if (!checkCollision(potentialPos)) {
            myPlayerMesh.position.copy(potentialPos);
        } else {
            // Wenn Kollision, nur Gravitation anwenden
             if(!checkCollision(nextPos)) myPlayerMesh.position.copy(nextPos);
        }

        // Kamera Logic
        const camOffset = new THREE.Vector3(0, 5, 10);
        camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), myPlayerMesh.rotation.y);
        camera.position.copy(myPlayerMesh.position).add(camOffset);
        camera.lookAt(myPlayerMesh.position);

        // Server Update
        if (dir.length() > 0 || velocityY !== 0) {
            socket.emit('playerMove', {
                x: myPlayerMesh.position.x,
                y: myPlayerMesh.position.y,
                z: myPlayerMesh.position.z,
                rotation: myPlayerMesh.rotation.y
            });
        }
    }

    updateGhostMesh();
    renderer.render(scene, camera);
}