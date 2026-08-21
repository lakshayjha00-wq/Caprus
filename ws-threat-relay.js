/**
 * ws-threat-relay.js
 * ─────────────────────────────────────────────────────────────
 * Lightweight WebSocket broadcast relay for real-time threat
 * payload distribution. Attaches to an existing Node HTTP server
 * instance (shared with Express) — no extra port required.
 *
 * Responsibilities (Single Responsibility):
 *   1. Accept & track WebSocket client connections
 *   2. Maintain heartbeat (ping/pong) and prune dead clients
 *   3. Expose a broadcast(payload) method for upstream callers
 * ─────────────────────────────────────────────────────────────
 */

const { WebSocketServer } = require('ws');

const LOG_PREFIX = '[WS-RELAY]';
const HEARTBEAT_INTERVAL_MS = 30_000;

class WsThreatRelay {
  /**
   * @param {import('http').Server} httpServer — The Node http.Server to attach to
   * @param {object} [opts]
   * @param {string} [opts.path='/ws/threats'] — URL path for WS upgrades
   */
  constructor(httpServer, opts = {}) {
    this._path = opts.path || '/ws/threats';
    this._clients = new Set();
    this._heartbeatTimer = null;

    this._wss = new WebSocketServer({
      server: httpServer,
      path: this._path,
    });

    this._wss.on('connection', (ws, req) => this._onConnection(ws, req));
    this._wss.on('error', (err) => {
      console.error(`${LOG_PREFIX} Server error: ${err.message}`);
    });

    this._startHeartbeat();

    console.log(`${LOG_PREFIX} WebSocket relay active on path ${this._path}`);
  }

  /* ───────── Connection Lifecycle ───────── */

  _onConnection(ws, req) {
    const clientIp = req.socket.remoteAddress || 'unknown';
    ws.isAlive = true;
    this._clients.add(ws);

    console.log(
      `${LOG_PREFIX} Client connected [${clientIp}] — ` +
      `active: ${this._clients.size}`
    );

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', (code, reason) => {
      this._clients.delete(ws);
      console.log(
        `${LOG_PREFIX} Client disconnected [${clientIp}] ` +
        `code=${code} — active: ${this._clients.size}`
      );
    });

    ws.on('error', (err) => {
      console.error(`${LOG_PREFIX} Client error [${clientIp}]: ${err.message}`);
      this._clients.delete(ws);
    });

    // Send an initial handshake acknowledgment
    try {
      ws.send(JSON.stringify({
        type: 'WS_CONNECTED',
        message: 'Crisis Zone Threat Relay — connected',
        timestamp: new Date().toISOString(),
      }));
    } catch { /* client may have disconnected immediately */ }
  }

  /* ───────── Heartbeat / Dead-Client Pruning ───────── */

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      for (const ws of this._clients) {
        if (!ws.isAlive) {
          this._clients.delete(ws);
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* ignore */ }
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Don't let the heartbeat timer keep the process alive
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  /* ───────── Public API ───────── */

  /**
   * Broadcast a JSON-serializable payload to every connected client.
   * Non-blocking — skips clients that aren't in OPEN state.
   * @param {object} payload
   */
  broadcast(payload) {
    if (this._clients.size === 0) return;

    const message = JSON.stringify(payload);
    let sent = 0;

    for (const ws of this._clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(message);
          sent++;
        } catch (err) {
          console.error(`${LOG_PREFIX} Send error: ${err.message}`);
        }
      }
    }

    if (sent > 0) {
      console.log(
        `${LOG_PREFIX} Broadcast threat payload to ${sent} client(s)`
      );
    }
  }

  /** Number of currently connected clients. */
  get clientCount() {
    return this._clients.size;
  }

  /** Graceful shutdown. */
  close() {
    clearInterval(this._heartbeatTimer);
    for (const ws of this._clients) {
      ws.terminate();
    }
    this._clients.clear();
    this._wss.close();
    console.log(`${LOG_PREFIX} Relay shut down.`);
  }
}

module.exports = { WsThreatRelay };
