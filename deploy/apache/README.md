# Apache Configuration Examples

This directory contains example Apache configurations for running the Sonos Alexa API behind a reverse proxy.

**Note**: These configurations have been generated based on Apache best practices but have NOT been tested by the authors. Please test thoroughly before using in production.

## Prerequisites

Enable required Apache modules:
```bash
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo systemctl restart apache2
```

## Files

### apache-reverse-proxy.conf
Full-featured production configuration with:
- SSL/TLS termination
- Security headers with `always` directive
- Access control for sensitive endpoints (/events, /debug)
- Server-Sent Events (SSE) support
- Modern SSL configuration
- Request body size limits

### apache-simple.conf
Minimal configuration for internal/development use:
- HTTP only (no SSL)
- Basic proxy setup
- Suitable for internal networks only

## Key Features Explained

### Security Headers
All security headers use the `always` keyword to ensure they're sent even on error responses:
```apache
Header always set X-Content-Type-Options "nosniff"
Header always set X-Frame-Options "DENY"
```

### Server-Sent Events (SSE)
The `/events` endpoint requires special handling:
- Buffering disabled with specific environment variables
- Extended timeout (24h) for long-lived connections
- Access restricted to internal networks only

### Debug Endpoints
The `/debug` location uses LocationMatch for regex matching:
- Separate access control from main API
- Real-time output with buffering disabled
- IP-based access restrictions

### Access Control
Apache uses `Require` directives for access control:
```apache
<RequireAll>
    Require ip 192.168.0.0/16
    Require ip 10.0.0.0/8
</RequireAll>
```

## Usage

1. Copy the appropriate configuration to `/etc/apache2/sites-available/`
2. Update the following:
   - `ServerName` with your domain
   - SSL certificate paths
   - Allowed IP ranges for /events and /debug
   - Log file paths
3. Enable the site:
   ```bash
   sudo a2ensite sonosapi
   sudo apache2ctl configtest
   sudo systemctl reload apache2
   ```

## Differences from Nginx

- Apache uses `ProxyPass` instead of `proxy_pass`
- Access control uses `Require` instead of `allow/deny`
- SSE buffering disabled with environment variables
- No built-in rate limiting (use mod_ratelimit or mod_security)

## Security Considerations

1. Always use SSL in production
2. Restrict access to /events and /debug endpoints
3. Keep security headers enabled
4. Use the API's built-in authentication
5. Consider adding mod_security for additional protection
6. Monitor access logs for suspicious activity

## Troubleshooting

### Proxy errors
If you see "Service Unavailable" errors:
1. Check if the API is running: `curl http://localhost:5005/health`
2. Verify proxy modules are enabled: `apache2ctl -M | grep proxy`
3. Check Apache error logs: `tail -f /var/log/apache2/sonosapi_error.log`

### SSE not working
If Server-Sent Events don't stream properly:
1. Ensure all proxy environment variables are set in the /events location
2. Check that buffering is disabled
3. Verify timeout settings are sufficient