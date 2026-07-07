const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Glitch Drift WebSocket server\n');
});

const wss = new WebSocketServer({ server });

const STROKE_MS = 120000;
const MAX_SERVER_STROKES = 500;
const MAX_PARTICLES = 5000;

let users = {};  // id → { params, ws }
let serverStrokes = [];
let serverParticles = [];

// ─── Particle Generation ────────────────────────────────────────────
function generateParticles(stroke) {
  let points = stroke.points || [];
  if (points.length === 0) return [];
  let num = 2 + Math.floor(Math.random() * 9); // 2–10
  let col = stroke.params ? (stroke.params.color || [200, 180, 220]) : [200, 180, 220];
  let types = ['dot', 'fragment', 'spark', 'memory'];
  let particles = [];
  for (let i = 0; i < num; i++) {
    let idx = Math.floor(Math.random() * points.length);
    let p = points[idx];
    particles.push({
      id: 'particle_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      x: p.x + (Math.random() - 0.5) * 10,
      y: p.y + (Math.random() - 0.5) * 10,
      color: [col[0], col[1], col[2]],
      size: 3 + Math.random() * 5,
      type: types[Math.floor(Math.random() * types.length)],
      originalStrokeId: stroke.id,
      createdAt: Date.now()
    });
  }
  return particles;
}

// ─── Decay Check ────────────────────────────────────────────────────
function checkDecay() {
  let now = Date.now();
  let expired = serverStrokes.filter(s => now - (s.birth || s.timestamp || now) >= STROKE_MS);
  if (expired.length === 0) return;
  let expiredIds = expired.map(s => s.id);
  let newParticles = [];
  for (let s of expired) newParticles.push(...generateParticles(s));
  serverStrokes = serverStrokes.filter(s => !expiredIds.includes(s.id));
  serverParticles.push(...newParticles);
  if (serverParticles.length > MAX_PARTICLES) serverParticles.splice(0, serverParticles.length - MAX_PARTICLES);
  broadcast({ type: 'decay', expiredStrokeIds: expiredIds, particles: newParticles });
}

setInterval(checkDecay, 1000);

// ─── Glitch Rifts ─────────────────────────────────────────────────
let serverRifts = [];
let riftIdCounter = 0;

function generateRiftsWithTypes() {
  let counts = { code: 4, ghost: 4, connection: 3, energy: 5, resistance: 2, glitchspeak: 2 };
  let fresh = [];
  for (let [type, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      fresh.push({
        id: 'rift_' + (riftIdCounter++),
        x: (Math.random() - 0.5) * 4000,
        y: (Math.random() - 0.5) * 4000,
        type: type,
        activated: false
      });
    }
  }
  return fresh;
}

function getMissingRiftCounts() {
  let counts = { code: 4, ghost: 4, connection: 3, energy: 5, resistance: 2, glitchspeak: 2 };
  let active = {};
  for (let r of serverRifts) {
    if (!r.activated) active[r.type] = (active[r.type] || 0) + 1;
  }
  let needed = [];
  for (let [type, want] of Object.entries(counts)) {
    let have = active[type] || 0;
    for (let i = 0; i < want - have; i++) {
      needed.push(type);
    }
  }
  return needed;
}

function replenishRifts() {
  serverRifts = serverRifts.filter(r => !r.activated);
  let needed = getMissingRiftCounts();
  for (let type of needed) {
    serverRifts.push({
      id: 'rift_' + (riftIdCounter++),
      x: (Math.random() - 0.5) * 4000,
      y: (Math.random() - 0.5) * 4000,
      type: type,
      activated: false
    });
  }
  if (needed.length > 0) {
    broadcast({ type: 'rifts-sync', rifts: serverRifts.map(r => ({ id: r.id, x: r.x, y: r.y, type: r.type, activated: r.activated })) });
  }
}

serverRifts = generateRiftsWithTypes();

// Replenish every 30 seconds to maintain minimum rift counts
setInterval(replenishRifts, 30000);

function broadcast(data, excludeWs) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client !== excludeWs) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  ws._id = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    switch (msg.type) {
      case 'join':
        ws._id = msg.id;
        users[msg.id] = { params: msg.params, ws };
        let existing = {};
        for (let uid in users) {
          if (uid !== msg.id) existing[uid] = users[uid].params;
        }
        // Only send strokes under 2 minutes old
        let now = Date.now();
        let activeStrokes = serverStrokes.filter(s => now - (s.birth || s.timestamp || now) < STROKE_MS);
        console.log(`[join] ${msg.id} — ${Object.keys(existing).length} users, ${activeStrokes.length} strokes, ${serverParticles.length} particles`);
        ws.send(JSON.stringify({ type: 'welcome', users: existing, strokes: activeStrokes,
          particles: serverParticles,
          rifts: serverRifts.map(r => ({ id: r.id, x: r.x, y: r.y, type: r.type, activated: r.activated })) }));
        broadcast({ type: 'user-join', id: msg.id, params: msg.params }, ws);
        break;

      case 'stroke':
        serverStrokes.push(msg.data);
        if (serverStrokes.length > MAX_SERVER_STROKES) {
          // Remove oldest strokes (first in array)
          let overflow = serverStrokes.length - MAX_SERVER_STROKES;
          // Before removing old strokes, generate particles for any that would be lost
          let removed = serverStrokes.splice(0, overflow);
          for (let s of removed) {
            // Only generate particles if they haven't been generated yet
            if (!serverStrokes.find(rs => rs.id === s.id)) {
              serverParticles.push(...generateParticles(s));
            }
          }
        }
        broadcast({ type: 'stroke', data: msg.data }, ws);
        break;

      case 'glitchspeak':
        broadcast({ type: 'glitchspeak', words: msg.words }, ws);
        break;

      case 'rift-discover':
        {
          let rift = serverRifts.find(r => r.id === msg.riftId);
          if (rift && !rift.activated) {
            rift.activated = true;
            broadcast({ type: 'rift-discovered', rift: { id: rift.id, x: rift.x, y: rift.y, type: rift.type }, userId: msg.userId });
            if (rift.type === 'energy') {
              broadcast({ type: 'energy-grant', amount: 30 });
            }
          }
        }
        break;

      case 'reset':
        serverStrokes = [];
        serverParticles = [];
        serverRifts = generateRiftsWithTypes();
        broadcast({ type: 'reset', rifts: serverRifts.map(r => ({ id: r.id, x: r.x, y: r.y, type: r.type, activated: r.activated })) });
        break;

      case 'ping':
        if (ws._id && users[ws._id]) {
          users[ws._id].lastSeen = Date.now();
        }
        break;
    }
  });

  ws.on('close', () => {
    if (ws._id) {
      delete users[ws._id];
      broadcast({ type: 'user-leave', id: ws._id });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Glitch Drift server running on port ${PORT}`);
});
