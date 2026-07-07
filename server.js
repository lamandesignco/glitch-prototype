const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Glitch Drift WebSocket server\n');
});

const wss = new WebSocketServer({ server });

let users = {};  // id → { params, ws }
let serverStrokes = [];
const MAX_SERVER_STROKES = 500;

// ─── Glitch Rifts ─────────────────────────────────────────────────
let serverRifts = [];
let riftIdCounter = 0;
const RIFT_TYPES = ['code', 'ghost', 'connection', 'energy', 'resistance', 'glitchspeak'];

function generateRifts(count) {
  let fresh = [];
  for (let i = 0; i < count; i++) {
    fresh.push({
      id: 'rift_' + (riftIdCounter++),
      x: (Math.random() - 0.5) * 4000,
      y: (Math.random() - 0.5) * 4000,
      type: RIFT_TYPES[Math.floor(Math.random() * RIFT_TYPES.length)],
      activated: false
    });
  }
  return fresh;
}

serverRifts = generateRifts(3 + Math.floor(Math.random() * 3));

// Respawn: every 3-5 min, add 1 new rift (max 8)
setInterval(() => {
  serverRifts = serverRifts.filter(r => !r.activated);
  if (serverRifts.length < 8) {
    serverRifts = serverRifts.concat(generateRifts(1));
  }
  broadcast({ type: 'rifts-sync', rifts: serverRifts.map(r => ({ id: r.id, x: r.x, y: r.y, type: r.type, activated: r.activated })) });
}, 3 * 60 * 1000 + Math.floor(Math.random() * 2 * 60 * 1000));

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
        // Send existing users to the new client
        let existing = {};
        for (let uid in users) {
          if (uid !== msg.id) existing[uid] = users[uid].params;
        }
        let replayStrokes = serverStrokes.slice(-200);
        console.log(`[join] ${msg.id} — ${Object.keys(existing).length} users, ${replayStrokes.length} strokes replayed`);
        ws.send(JSON.stringify({ type: 'welcome', users: existing, strokes: replayStrokes,
          rifts: serverRifts.map(r => ({ id: r.id, x: r.x, y: r.y, type: r.type, activated: r.activated })) }));
        // Broadcast join to others
        broadcast({ type: 'user-join', id: msg.id, params: msg.params }, ws);
        break;

      case 'stroke':
        serverStrokes.push(msg.data);
        if (serverStrokes.length > MAX_SERVER_STROKES) serverStrokes.splice(0, serverStrokes.length - MAX_SERVER_STROKES);
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
          }
        }
        break;

      case 'reset':
        serverStrokes = [];
        serverRifts = generateRifts(3 + Math.floor(Math.random() * 3));
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
