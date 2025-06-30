# Nginx Configuration Examples

This directory contains example nginx configurations for running the Sonos Alexa API behind a reverse proxy.

**Tested Configuration**: These nginx configurations have been tested and are in production use on Ubuntu 24.04.

For other web servers, see [../](../) - note that non-nginx configurations are provided as examples only and should be tested before production use.

## Files

### nginx-reverse-proxy.conf
Full-featured production configuration with:
- SSL/TLS termination
- Security headers with `always` directive
- Rate limiting preparation
- Access control for sensitive endpoints (/events, /debug)
- Optimized buffering and timeouts
- Server-Sent Events (SSE) support
- Modern SSL configuration with OCSP stapling

### nginx-simple.conf
Minimal configuration for internal/development use:
- HTTP only (no SSL)
- Basic proxy setup
- Suitable for internal networks only

## Key Features Explained

### Security Headers
All security headers use the `always` directive to ensure they're sent even on error responses:
```nginx
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header X-XSS-Protection "1; mode=block" always;
```

### Server-Sent Events (SSE)
The `/events` endpoint requires special handling:
- Extended timeout (24h) for long-lived connections
- Buffering disabled for real-time updates
- Access restricted to internal networks only

### Debug Endpoints
The `/debug` location uses regex matching to protect all debug endpoints:
- Separate access control from main API
- Optional rate limiting
- Real-time output with buffering disabled

### Rate Limiting
The configurations include commented-out rate limiting. To enable:

1. Add to your main nginx.conf http block:
```nginx
limit_req_zone $binary_remote_addr zone=api_zone:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=debug_zone:10m rate=2r/s;
```

2. Uncomment the `limit_req` lines in the server configuration

### Authentication
The configurations pass through Authorization headers to support the API's built-in authentication:
```nginx
proxy_set_header Authorization $http_authorization;
proxy_pass_header Authorization;
```

## Usage

1. Copy the appropriate configuration to your nginx sites directory
2. Update the following:
   - `server_name` with your domain
   - SSL certificate paths
   - Allowed IP ranges for /events and /debug
   - Log file paths
3. Test the configuration: `sudo nginx -t`
4. Reload nginx: `sudo systemctl reload nginx`

## Security Considerations

1. Always use SSL in production
2. Restrict access to /events and /debug endpoints
3. Enable rate limiting to prevent abuse
4. Keep security headers enabled
5. Use the API's built-in authentication
6. Monitor access logs for suspicious activity