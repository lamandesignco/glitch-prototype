const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Glitch Drift WebSocket server\n');
});

const wss = new WebSocketServer({ server });

let users = {};  // id → { params, ws }

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
        ws.send(JSON.stringify({ type: 'welcome', users: existing }));
        // Broadcast join to others
        broadcast({ type: 'user-join', id: msg.id, params: msg.params }, ws);
        break;

      case 'stroke':
        broadcast({ type: 'stroke', data: msg.data }, ws);
        break;

      case 'glitchspeak':
        broadcast({ type: 'glitchspeak', words: msg.words }, ws);
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
