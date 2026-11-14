// 心有靈排 連線伺服器：提供網頁本體，並用 WebSocket 轉送每個房間裡玩家的狀態（presence）。
// 遊戲規則都在房主的瀏覽器上跑，伺服器只負責轉送，不保存任何遊戲資料。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'index.html');
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const MAX_PEERS = 24;           // 每個房間最多連線數（玩家 + 觀戰）
const MAX_PRESENCE = 12 * 1024; // 每人狀態大小上限
const GRACE_MS = 45 * 1000;     // 斷線後保留位置多久（手機鎖螢幕、切換 App）
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

let html = fs.readFileSync(INDEX);

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end('xinyoulingpai');
  }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(html);
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('找不到這個頁面');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });
const rooms = new Map(); // roomName -> Map(peerId -> { pr, ws, tok, timer })

function clean(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const k of Object.keys(obj)) if (!BAD_KEYS.has(k)) out[k] = obj[k];
  return Buffer.byteLength(JSON.stringify(out)) > MAX_PRESENCE ? {} : out;
}
function broadcast(room, msg, except) {
  const s = JSON.stringify(msg);
  for (const [peer, ent] of room) if (peer !== except && ent.ws && ent.ws.readyState === 1) ent.ws.send(s);
}

wss.on('connection', ws => {
  let room = null, roomName = null, me = null, ent = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'join' && !room) {
      if (typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return ws.close(1008, 'bad room');
      roomName = m.room;
      room = rooms.get(roomName);
      if (!room) { room = new Map(); rooms.set(roomName, room); }
      const old = typeof m.peer === 'string' ? room.get(m.peer) : null;
      if (old && old.tok === m.tok && (!old.ws || old.ws.readyState !== 1)) {
        // 斷線重連：拿回原本的位置
        clearTimeout(old.timer);
        me = m.peer; ent = old; ent.ws = ws;
        const pr = clean(m.pr); if (Object.keys(pr).length) ent.pr = pr;
      } else {
        if (room.size >= MAX_PEERS) return ws.close(1013, 'room full');
        me = crypto.randomBytes(8).toString('hex');
        ent = { pr: clean(m.pr), ws, tok: crypto.randomBytes(12).toString('hex'), timer: null };
        room.set(me, ent);
      }
      ws.send(JSON.stringify({
        t: 'welcome', peer: me, tok: ent.tok,
        peers: [...room].filter(([p]) => p !== me).map(([p, e]) => ({ peer: p, pr: e.pr })),
      }));
      broadcast(room, { t: 'pr', peer: me, pr: ent.pr }, me);
      return;
    }
    if (!room || !ent || ent.ws !== ws) return;

    if (m.t === 'pr') {
      const patch = m.patch && typeof m.patch === 'object' && !Array.isArray(m.patch) ? m.patch : {};
      const next = { ...ent.pr };
      for (const k of Object.keys(patch)) {
        if (BAD_KEYS.has(k)) continue;
        if (patch[k] === null) delete next[k]; else next[k] = patch[k];
      }
      if (Buffer.byteLength(JSON.stringify(next)) > MAX_PRESENCE) return;
      ent.pr = next;
      broadcast(room, { t: 'pr', peer: me, pr: next }, me);
    } else if (m.t === 'leave') {
      drop(true);
    }
  });

  function drop(now) {
    if (!room || !ent || ent.ws !== ws) return;
    ent.ws = null;
    const myEnt = ent, myRoom = room, myId = me, myName = roomName;
    const finish = () => {
      if (myRoom.get(myId) !== myEnt || myEnt.ws) return;
      myRoom.delete(myId);
      broadcast(myRoom, { t: 'left', peer: myId });
      if (!myRoom.size) rooms.delete(myName);
    };
    if (now) finish(); else myEnt.timer = setTimeout(finish, GRACE_MS);
  }
  ws.on('close', () => drop(false));
  ws.on('error', () => {});
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 25000);

server.listen(PORT, () => console.log(`心有靈排 listening on :${PORT}`));
