/**
 * WebSocket client for server communication.
 */
export default class WebSocketClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.messageHandlers = {};
    // Frontend and backend are served from the same EC2 instance (same host:port).
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${wsProto}//${window.location.host}/ws`;
  }

  connect() {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[WebSocket] Connected to server');
          this.connected = true;
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log(`[WS:RECV] type=${data.type}`, data);
            const handler = this.messageHandlers[data.type];
            if (handler) {
              handler(data);
            }
          } catch (e) {
            console.warn('[WebSocket] Failed to parse message:', e);
          }
        };

        this.ws.onclose = () => {
          console.log('[WebSocket] Disconnected');
          this.connected = false;
        };

        this.ws.onerror = () => {
          console.error('[WebSocket] Connection failed');
          this.connected = false;
          resolve(false);
        };

        // Timeout for connection attempt
        setTimeout(() => {
          if (!this.connected) {
            console.error('[WebSocket] Connection timeout');
            resolve(false);
          }
        }, 3000);
      } catch (e) {
        console.error('[WebSocket] Cannot create WebSocket');
        this.connected = false;
        resolve(false);
      }
    });
  }

  on(messageType, handler) {
    this.messageHandlers[messageType] = handler;
  }

  send(type, data = {}) {
    if (!this.connected || !this.ws) {
      return false;
    }
    try {
      const message = { type, ...data };
      console.log(`[WS:SEND] type=${type}`, message);
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (e) {
      console.warn('[WebSocket] Failed to send message:', e);
      return false;
    }
  }

  isConnected() {
    return this.connected;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}
