import http from 'http';
import { networkInterfaces } from 'os';
import { debugManager } from '../utils/debug-manager.js';

export interface Subscription {
  id: string;
  sid?: string;
  url: string;
  callback: string;
  timeout: number;
  renewalTimer?: NodeJS.Timeout;
  deviceId?: string;
  service?: string;
}

export class UPnPSubscriber {
  private subscriptions = new Map<string, Subscription>();
  private callbackServer?: http.Server;
  private callbackPort = 0;
  private callbackHost = '';
  private deviceMapping = new Map<string, {deviceId: string, service: string}>();

  constructor(private eventHandler: (deviceId: string, service: string, body: string) => void) {}

  async start(port = 0): Promise<void> {
    // Create HTTP server to receive UPnP NOTIFY callbacks
    this.callbackServer = http.createServer((req, res) => {
      this.handleNotification(req, res);
    });

    return new Promise((resolve, reject) => {
      this.callbackServer!.listen(port, (err?: Error) => {
        if (err) {
          reject(err);
          return;
        }
        
        const addr = this.callbackServer!.address();
        if (typeof addr === 'object' && addr) {
          this.callbackPort = addr.port;
          this.callbackHost = this.getLocalIP();
          debugManager.info('upnp', `UPnP callback server listening on ${this.callbackHost}:${this.callbackPort}`);
          resolve();
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  stop(): void {
    // Unsubscribe from all services
    for (const subscription of this.subscriptions.values()) {
      this.unsubscribe(subscription.id).catch(err => 
        debugManager.error('upnp', `Error unsubscribing from ${subscription.id}:`, err)
      );
    }
    
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = undefined;
    }
  }

  async subscribe(deviceBaseUrl: string, service: string, deviceId?: string, timeout = 300): Promise<string> {
    const subscriptionId = `${deviceBaseUrl}/${service}`;
    const existingSub = this.subscriptions.get(subscriptionId);
    
    if (existingSub) {
      // Already subscribed, renew if needed
      return subscriptionId;
    }

    const eventUrl = `${deviceBaseUrl}/${service}/Event`;
    const callbackUrl = `http://${this.callbackHost}:${this.callbackPort}/notify/${encodeURIComponent(subscriptionId)}`;
    
    const subscription: Subscription = {
      id: subscriptionId,
      url: eventUrl,
      callback: callbackUrl,
      timeout,
      deviceId,
      service
    };
    
    // Store device mapping for later lookup
    this.deviceMapping.set(subscriptionId, { deviceId: deviceId || 'unknown', service });

    try {
      await this.performSubscribe(subscription);
      this.subscriptions.set(subscriptionId, subscription);
      
      // Set up renewal timer
      this.scheduleRenewal(subscription);
      
      debugManager.debug('upnp', `Subscribed to ${service} on ${deviceBaseUrl}`);
      return subscriptionId;
    } catch (error) {
      debugManager.error('upnp', `Failed to subscribe to ${service} on ${deviceBaseUrl}:`, error);
      throw error;
    }
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription || !subscription.sid) {
      return;
    }

    try {
      await this.performUnsubscribe(subscription);
      
      if (subscription.renewalTimer) {
        clearTimeout(subscription.renewalTimer);
      }
      
      this.subscriptions.delete(subscriptionId);
      debugManager.debug('upnp', `Unsubscribed from ${subscriptionId}`);
    } catch (error) {
      debugManager.error('upnp', `Failed to unsubscribe from ${subscriptionId}:`, error);
    }
  }

  private async performSubscribe(subscription: Subscription): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(subscription.url);
      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'SUBSCRIBE',
        headers: {
          'CALLBACK': `<${subscription.callback}>`,
          'NT': 'upnp:event',
          'TIMEOUT': `Second-${subscription.timeout}`,
          'USER-AGENT': 'Node.js UPnP/1.0 sonos-alexa-api'
        }
      };

      const req = http.request(options, (res) => {
        if (res.statusCode === 200) {
          subscription.sid = res.headers.sid as string;
          resolve();
        } else {
          reject(new Error(`Subscription failed: ${res.statusCode} ${res.statusMessage}`));
        }
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Subscription timeout'));
      });
      
      req.end();
    });
  }

  private async performUnsubscribe(subscription: Subscription): Promise<void> {
    return new Promise((resolve) => {
      const url = new URL(subscription.url);
      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'UNSUBSCRIBE',
        headers: {
          'SID': subscription.sid || '',
          'USER-AGENT': 'Node.js UPnP/1.0 sonos-alexa-api'
        }
      };

      const req = http.request(options, (_res) => {
        resolve(); // Don't care about response code for unsubscribe
      });

      req.on('error', () => resolve()); // Ignore errors on unsubscribe
      req.setTimeout(5000, () => {
        req.destroy();
        resolve();
      });
      
      req.end();
    });
  }

  private scheduleRenewal(subscription: Subscription): void {
    const renewalTime = (subscription.timeout - 30) * 1000; // Renew 30 seconds before expiry
    
    subscription.renewalTimer = setTimeout(async () => {
      try {
        await this.performSubscribe(subscription);
        this.scheduleRenewal(subscription); // Schedule next renewal
        debugManager.debug('upnp', `Renewed subscription to ${subscription.id}`);
      } catch (error) {
        debugManager.error('upnp', `Failed to renew subscription to ${subscription.id}:`, error);
        // Remove failed subscription
        this.subscriptions.delete(subscription.id);
      }
    }, renewalTime);
  }

  private handleNotification(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200);
    res.end();

    if (req.method !== 'NOTIFY') {
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        // Extract subscription ID from URL path
        const urlPath = req.url || '';
        const match = urlPath.match(/\/notify\/(.+)$/);
        if (!match) {
          return;
        }

        const subscriptionId = decodeURIComponent(match[1]!);
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription) {
          return;
        }

        // Look up device ID and service from stored mapping
        const mapping = this.deviceMapping.get(subscriptionId);
        if (!mapping) {
          debugManager.debug('upnp', `No device mapping found for subscription ${subscriptionId}`);
          return;
        }

        this.eventHandler(mapping.deviceId, mapping.service, body);
      } catch (error) {
        debugManager.error('upnp', 'Error handling UPnP notification:', error);
      }
    });
  }

  private getLocalIP(): string {
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
      const interfaces = nets[name];
      if (interfaces) {
        for (const net of interfaces) {
          if (net.family === 'IPv4' && !net.internal) {
            return net.address;
          }
        }
      }
    }

    return '127.0.0.1';
  }
}