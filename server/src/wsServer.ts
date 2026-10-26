import { WebSocketServer, WebSocket } from 'ws';
import { WSMessageRequest, WSMessageResponse, BrowserTab } from './types.js';

export class BrowserBridge {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (data: any) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private currentTabs: BrowserTab[] = [];
  private activeTab: BrowserTab | null = null;
  private port: number;

  constructor(port = 3025) {
    this.port = port;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' }, () => {
          console.error(`[Browser Bridge] WebSocket server listening on ws://127.0.0.1:${this.port}`);
          resolve();
        });

        this.wss.on('connection', (ws: WebSocket) => {
          console.error('[Browser Bridge] Chrome extension connected!');
          this.client = ws;

          ws.on('message', (messageRaw: string | Buffer) => {
            try {
              const msgStr = messageRaw.toString();
              const message = JSON.parse(msgStr);

              // Handle status broadcast or heartbeat from extension
              if (message.type === 'tabs_update') {
                this.currentTabs = message.tabs || [];
                this.activeTab = message.activeTab || null;
                return;
              }

              // Handle response to a command
              if (message.id && this.pendingRequests.has(message.id)) {
                const { resolve, reject, timer } = this.pendingRequests.get(message.id)!;
                clearTimeout(timer);
                this.pendingRequests.delete(message.id);

                if (message.success) {
                  resolve(message.data);
                } else {
                  reject(new Error(message.error || 'Unknown error occurred in browser extension'));
                }
              }
            } catch (err: any) {
              console.error('[Browser Bridge] Error parsing incoming WS message:', err);
            }
          });

          ws.on('close', () => {
            console.error('[Browser Bridge] Chrome extension disconnected');
            if (this.client === ws) {
              this.client = null;
            }
            this.rejectAllPending('Browser extension disconnected');
          });

          ws.on('error', (err) => {
            console.error('[Browser Bridge] Client WebSocket error:', err.message);
          });
        });

        this.wss.on('error', (err) => {
          console.error('[Browser Bridge] WebSocket Server error:', err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  public getConnectedTabs(): { tabs: BrowserTab[]; activeTab: BrowserTab | null } {
    return {
      tabs: this.currentTabs,
      activeTab: this.activeTab,
    };
  }

  public async sendCommand<T = any>(
    action: string,
    payload: any = {},
    timeoutMs = 30000
  ): Promise<T> {
    if (!this.isConnected()) {
      throw new Error(
        'Chrome extension is NOT connected. Please make sure the browser extension is installed, enabled, and connected to ws://127.0.0.1:' +
          this.port
      );
    }

    const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const request: WSMessageRequest = { id, action, payload };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Command '${action}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.client!.send(JSON.stringify(request));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  private rejectAllPending(reason: string) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  public async stop(): Promise<void> {
    this.rejectAllPending('Browser bridge is stopping');
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
  }
}
