import { IncomingMessage } from 'http';

/**
 * Check if an IP address is within a CIDR range
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bits = '32'] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1);
  
  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range || '');
  
  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Convert IP address to number
 */
function ipToNumber(ip: string): number {
  const parts = ip.split('.');
  return parts.reduce((acc, part, i) => acc + (parseInt(part) << (8 * (3 - i))), 0);
}

/**
 * Get client IP from request, handling proxies
 */
export function getClientIp(req: IncomingMessage): string {
  // Check X-Forwarded-For header (from nginx proxy)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // Take the first IP if there are multiple
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    if (ips) {
      const parts = ips.split(',');
      return parts[0] ? parts[0].trim() : '';
    }
    return '';
  }
  
  // Check X-Real-IP header (from nginx proxy)
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? (realIp[0] || '') : realIp;
  }
  
  // Fall back to socket address
  return req.socket.remoteAddress || '';
}

/**
 * Check if an IP is in any of the trusted networks
 */
export function isIpTrusted(ip: string, trustedNetworks: string[]): boolean {
  // Handle IPv6 mapped IPv4 addresses (::ffff:192.168.1.1)
  const cleanIp = ip.includes('::ffff:') ? ip.replace('::ffff:', '') : ip;
  
  // Always trust localhost
  if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
    return true;
  }
  
  // Check against trusted networks
  for (const network of trustedNetworks) {
    if (network.includes('/')) {
      // CIDR notation
      if (isIpInCidr(cleanIp, network)) {
        return true;
      }
    } else {
      // Single IP
      if (cleanIp === network) {
        return true;
      }
    }
  }
  
  return false;
}