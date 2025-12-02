// server.js - CLEAN COMMONJS VERSION
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files (Fixes 404s)
app.use(express.static(path.join(__dirname, 'public')));

// Game State
let players = {};
let buildings = []; 
let crates = []; 

// Initialize Crates
function spawnCrates() {
    crates = [];
    for (let i = 0; i < 20; i++) {
        crates.push({
            id: `crate_${i}`,
            x: (Math.random() - 0.5) * 160,
            y: 0.35, 
            z: (Math.random() - 0.5) * 160
        });
    }
}
spawnCrates();

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Init Player
    players[socket.id] = { x: 0, y: 10, z: 0, rotation: 0, hp: 100, shield: 100 };

    // Send World State
    socket.emit('initWorld', { buildings, crates });
    socket.emit('updateStats', { hp: 100, shield: 100 });

    // Movement
    socket.on('movement', (data) => {
        if (players[socket.id]) {
            // Keep stats from server, update pos from client
            const { hp, shield } = players[socket.id];
            players[socket.id] = { ...data, hp, shield };
            socket.broadcast.emit('playerMoved', { id: socket.id, ...data });
        }
    });

    // Building
    socket.on('build', (data) => {
        const building = { ...data, id: `build_${Date.now()}_${Math.random()}` };
        buildings.push(building);
        io.emit('newBuilding', building);
    });

    // Destruction
    socket.on('hitObject', (id) => {
        const bIndex = buildings.findIndex(b => b.id === id);
        if (bIndex !== -1) {
            buildings.splice(bIndex, 1);
            io.emit('objectDestroyed', id);
        }
    });

    // PvP Damage
    socket.on('shootPlayer', (data) => {
        const target = players[data.targetId];
        if (target) {
            if (target.shield > 0) {
                target.shield -= data.damage;
                if (target.shield < 0) {
                    target.hp += target.shield; // Overflow damage to HP
                    target.shield = 0;
                }
            } else {
                target.hp -= data.damage;
            }

            // Update victim UI
            io.to(data.targetId).emit('updateStats', { hp: target.hp, shield: target.shield });

            // Death Check
            if (target.hp <= 0) {
                // Reset & Respawn
                target.hp = 100; target.shield = 100;
                target.x = (Math.random() - 0.5) * 100;
                target.z = (Math.random() - 0.5) * 100;
                target.y = 10;
                
                io.to(data.targetId).emit('updateStats', { hp: 100, shield: 100 });
                io.emit('playerRespawn', { id: data.targetId, x: target.x, y: target.y, z: target.z });
            }
        }
    });

    // Loot Crate
    socket.on('interact', (data) => {
        const cIndex = crates.findIndex(c => c.id === data.targetId);
        if (cIndex !== -1) {
            crates.splice(cIndex, 1);
            io.emit('crateLooted', data.targetId);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});