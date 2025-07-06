import http from 'http';
import { networkInterfaces } from 'os';
import { debugManager } from '../utils/debug-manager.js';
import { EventManager } from '../utils/event-manager.js';

interface UPnPError extends Error {
  code?: string;
  statusCode?: number;
  originalError?: Error;
}

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
    const subscriptionId = `${deviceBaseUrl}${service}`;
    const existingSub = this.subscriptions.get(subscriptionId);
    
    if (existingSub) {
      // Already subscribed, renew if needed
      return subscriptionId;
    }

    // service already contains the full path (e.g., /MediaRenderer/AVTransport/Event)
    const eventUrl = `${deviceBaseUrl}${service}`;
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
      
      debugManager.debug('upnp', `Subscribed to ${service} on ${deviceBaseUrl} with ID: ${subscriptionId}`);
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

  private async performSubscribe(subscription: Subscription, isRenewal = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(subscription.url);
      const headers: Record<string, string> = {
        'TIMEOUT': `Second-${subscription.timeout}`,
        'USER-AGENT': 'Node.js UPnP/1.0 sonos-alexa-api'
      };
      
      if (isRenewal && subscription.sid) {
        // Renewal - use existing SID
        headers['SID'] = subscription.sid;
      } else {
        // Initial subscription
        headers['CALLBACK'] = `<${subscription.callback}>`;
        headers['NT'] = 'upnp:event';
      }
      
      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'SUBSCRIBE',
        headers
      };

      const req = http.request(options, (res) => {
        if (res.statusCode === 200) {
          const newSid = res.headers.sid as string;
          if (isRenewal) {
            debugManager.debug('upnp', `Renewal successful for ${subscription.id}, SID: ${newSid}`);
          } else {
            subscription.sid = newSid;
            debugManager.info('upnp', `Initial subscription successful for ${subscription.id}, SID: ${newSid}, timeout: ${subscription.timeout}s`);
          }
          resolve();
        } else if (res.statusCode === 412) {
          // 412 Precondition Failed - subscription expired, need to resubscribe
          const error = new Error(`Subscription expired (412): ${res.statusMessage}`) as UPnPError;
          error.code = 'SUBSCRIPTION_EXPIRED';
          error.statusCode = 412;
          reject(error);
        } else {
          reject(new Error(`Subscription failed: ${res.statusCode} ${res.statusMessage}`));
        }
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        // ECONNREFUSED means device is offline
        if (err.code === 'ECONNREFUSED') {
          const error = new Error(`Device offline: ${err.message}`) as UPnPError;
          error.code = 'DEVICE_OFFLINE';
          error.originalError = err;
          reject(error);
        } else {
          reject(err);
        }
      });
      req.setTimeout(5000, () => {
        req.destroy();
        const error = new Error('Subscription timeout') as UPnPError;
        error.code = 'TIMEOUT';
        reject(error);
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
        await this.performSubscribe(subscription, true); // Pass true for renewal
        this.scheduleRenewal(subscription); // Schedule next renewal
        debugManager.info('upnp', `Renewed subscription to ${subscription.id} (SID: ${subscription.sid})`);
        
        // Notify EventManager of successful renewal
        if (subscription.deviceId) {
          const eventManager = EventManager.getInstance();
          eventManager.handleSubscriptionRenewal(subscription.deviceId);
        }
      } catch (error) {
        debugManager.error('upnp', `Failed to renew subscription to ${subscription.id}:`, error);
        
        // Handle specific error cases
        const err = error as UPnPError;
        if (err.code === 'DEVICE_OFFLINE' || err.code === 'ECONNREFUSED' || err.code === 'TIMEOUT') {
          // Device is offline - no point trying to resubscribe
          debugManager.warn('upnp', `Device appears offline for ${subscription.id}`);
          this.subscriptions.delete(subscription.id);
          
          // Notify EventManager that device is offline
          if (subscription.deviceId) {
            const eventManager = EventManager.getInstance();
            eventManager.handleSubscriptionFailure(subscription.deviceId);
          }
          return;
        }
        
        // For 412 or other errors, try to resubscribe from scratch
        try {
          subscription.sid = undefined; // Clear SID to force new subscription
          await this.performSubscribe(subscription, false);
          this.scheduleRenewal(subscription);
          debugManager.info('upnp', `Resubscribed to ${subscription.id} after renewal failure`);
          
          // Successful resubscribe - update EventManager
          if (subscription.deviceId) {
            const eventManager = EventManager.getInstance();
            eventManager.handleSubscriptionRenewal(subscription.deviceId);
          }
        } catch (resubError) {
          debugManager.error('upnp', `Failed to resubscribe to ${subscription.id}:`, resubError);
          this.subscriptions.delete(subscription.id);
          
          // Notify EventManager that device is likely offline
          if (subscription.deviceId) {
            const eventManager = EventManager.getInstance();
            eventManager.handleSubscriptionFailure(subscription.deviceId);
          }
        }
      }
    }, renewalTime);
  }

  private handleNotification(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Don't end the response until we've read all the data
    debugManager.info('upnp', `Received ${req.method} request to ${req.url}`);
    
    if (req.method !== 'NOTIFY') {
      debugManager.debug('upnp', `Ignoring non-NOTIFY request: ${req.method}`);
      res.writeHead(200);
      res.end();
      return;
    }
    
    // Debug: Check content length for ZoneGroupTopology
    if (req.url && req.url.includes('ZoneGroupTopology')) {
      debugManager.debug('upnp', 'ZoneGroupTopology notification headers:', req.headers);
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      debugManager.debug('upnp', `Processing notification for ${req.url}, body length: ${body.length}`);
      
      // Send response after we've read all data
      res.writeHead(200);
      res.end();
      
      try {
        // Extract subscription ID from URL path
        const urlPath = req.url || '';
        const match = urlPath.match(/\/notify\/(.+)$/);
        if (!match) {
          debugManager.warn('upnp', `No match for notification URL pattern: ${urlPath}`);
          return;
        }

        const subscriptionId = decodeURIComponent(match[1]!);
        debugManager.debug('upnp', `Looking up subscription for ID: ${subscriptionId}`);
        
        // Debug: show all subscription IDs
        if (subscriptionId.includes('ZoneGroupTopology')) {
          debugManager.debug('upnp', `All subscription IDs: ${Array.from(this.subscriptions.keys()).join(', ')}`);
        }
        
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription) {
          debugManager.warn('upnp', `No subscription found for ID: ${subscriptionId}`);
          return;
        }

        // Look up device ID and service from stored mapping
        const mapping = this.deviceMapping.get(subscriptionId);
        if (!mapping) {
          debugManager.warn('upnp', `No device mapping found for subscription ${subscriptionId}`);
          debugManager.debug('upnp', `Available mappings: ${Array.from(this.deviceMapping.keys()).join(', ')}`);
          return;
        }

        debugManager.info('upnp', `Processing event for device ${mapping.deviceId}, service ${mapping.service}`);
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