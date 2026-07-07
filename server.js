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

// ─── Easter Eggs ──────────────────────────────────────────────────
let serverEggs = [];
let eggIdCounter = 0;
const EGG_TYPES = ['theory', 'refusal', 'glitchspeak', 'commons', 'transformation', 'energy'];

function generateEggs(count) {
  let newEggs = [];
  for (let i = 0; i < count; i++) {
    newEggs.push({
      id: 'egg_' + (eggIdCounter++),
      x: (Math.random() - 0.5) * 4000,
      y: (Math.random() - 0.5) * 4000,
      type: EGG_TYPES[Math.floor(Math.random() * EGG_TYPES.length)],
      discovered: false,
      discoveredBy: null,
      commonsClicks: []
    });
  }
  return newEggs;
}

// Initial spawn
serverEggs = generateEggs(10 + Math.floor(Math.random() * 6));

// Respawn timer: every 5-7 minutes, add 1-3 new eggs
setInterval(() => {
  let oldCount = serverEggs.length;
  serverEggs = serverEggs.filter(e => !e.discovered || (Date.now() - (e.discoveryTime || 0) < 60000));
  let newCount = 1 + Math.floor(Math.random() * 3);
  let fresh = generateEggs(newCount);
  serverEggs = serverEggs.concat(fresh);
  broadcast({ type: 'eggs-sync', eggs: serverEggs.map(e => ({ id: e.id, x: e.x, y: e.y, type: e.type, discovered: e.discovered })) });
}, 5 * 60 * 1000 + Math.floor(Math.random() * 2 * 60 * 1000));

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
        ws.send(JSON.stringify({ type: 'welcome', users: existing, strokes: replayStrokes, eggs: serverEggs.map(e => ({ id: e.id, x: e.x, y: e.y, type: e.type, discovered: e.discovered })) }));
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

      case 'reset':
        serverStrokes = [];
        broadcast({ type: 'reset' });
        break;

      case 'ping':
        if (ws._id && users[ws._id]) {
          users[ws._id].lastSeen = Date.now();
        }
        break;

      case 'egg-discover':
        {
          let egg = serverEggs.find(e => e.id === msg.eggId);
          if (egg && !egg.discovered) {
            egg.discovered = true;
            egg.discoveredBy = msg.userId;
            egg.discoveryTime = Date.now();
            broadcast({ type: 'egg-discovered', egg: { id: egg.id, x: egg.x, y: egg.y, type: egg.type }, userId: msg.userId });
          }
        }
        break;

      case 'egg-commons-click':
        {
          let cEgg = serverEggs.find(e => e.id === msg.eggId);
          if (cEgg && !cEgg.discovered) {
            if (!cEgg.commonsClicks) cEgg.commonsClicks = [];
            if (!cEgg.commonsClicks.includes(msg.userId)) {
              cEgg.commonsClicks.push(msg.userId);
            }
            broadcast({ type: 'egg-commons-count', eggId: msg.eggId, count: cEgg.commonsClicks.length }, ws);
            if (cEgg.commonsClicks.length >= 3) {
              cEgg.discovered = true;
              cEgg.discoveryTime = Date.now();
              broadcast({ type: 'egg-discovered', egg: { id: cEgg.id, x: cEgg.x, y: cEgg.y, type: 'commons' }, userId: 'commons' });
              broadcast({ type: 'egg-commons-activated', eggId: msg.eggId, x: cEgg.x, y: cEgg.y });
            }
          }
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
