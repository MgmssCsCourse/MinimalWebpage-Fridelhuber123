const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let buildings = []; 
let crates = []; 

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

    players[socket.id] = { x: 0, y: 10, z: 0, rotation: 0, hp: 100, shield: 100 };

    socket.emit('initWorld', { buildings, crates });
    socket.emit('updateStats', { hp: 100, shield: 100 });

    socket.on('movement', (data) => {
        if (players[socket.id]) {
            const { hp, shield } = players[socket.id];
            players[socket.id] = { ...data, hp, shield };
            socket.broadcast.emit('playerMoved', { id: socket.id, ...data });
        }
    });

    socket.on('build', (data) => {
        const building = { ...data, id: `build_${Date.now()}_${Math.random()}` };
        buildings.push(building);
        io.emit('newBuilding', building);
    });

    socket.on('hitObject', (id) => {
        const bIndex = buildings.findIndex(b => b.id === id);
        if (bIndex !== -1) {
            buildings.splice(bIndex, 1);
            io.emit('objectDestroyed', id);
        }
    });

    // --- PVP & DEATH FIX ---
    socket.on('shootPlayer', (data) => {
        const target = players[data.targetId];
        
        // CRITICAL FIX: Do not process damage if player is already dead or missing
        if (!target || target.hp <= 0) return;

        if (target.shield > 0) {
            target.shield -= data.damage;
            if (target.shield < 0) { 
                target.hp += target.shield; 
                target.shield = 0; 
            }
        } else {
            target.hp -= data.damage;
        }

        // Update Victim UI
        io.to(data.targetId).emit('updateStats', { hp: target.hp, shield: target.shield });

        // Death Check (Only trigger once because of the check above)
        if (target.hp <= 0) {
            target.hp = 0;
            io.to(data.targetId).emit('playerEliminated');
            io.emit('playerDied', { id: data.targetId });
        }
    });

    socket.on('requestRespawn', () => {
        const p = players[socket.id];
        if(p) {
            p.hp = 100; p.shield = 100;
            p.x = (Math.random()-0.5)*100; 
            p.z = (Math.random()-0.5)*100; 
            p.y = 10;
            
            io.to(socket.id).emit('updateStats', { hp: 100, shield: 100 });
            io.emit('playerRespawn', { id: socket.id, x: p.x, y: p.y, z: p.z });
        }
    });

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
