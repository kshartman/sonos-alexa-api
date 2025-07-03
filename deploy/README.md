# Deployment Examples

This directory contains example configurations for deploying the Sonos Alexa API in various environments.

**Important Note**: The authors have only tested the nginx configuration on Ubuntu 24.04. All other configurations (Apache, Caddy, Traefik, Synology) have been generated as a convenience but should be thoroughly tested before production use.

## Available Configurations

### [nginx/](nginx/)
Nginx reverse proxy configurations:
- Full production setup with SSL, security headers, and access control
- Simple HTTP-only configuration for internal use
- Optimized for Server-Sent Events (SSE) support

### [apache/](apache/)
Apache reverse proxy configurations:
- Full production setup with SSL and security features
- Simple HTTP-only configuration for internal use
- Includes Apache-specific SSE handling

### [caddy/](caddy/)
Caddy web server configurations (popular on Raspberry Pi):
- Automatic HTTPS with Let's Encrypt
- Simple, clean configuration syntax
- Low resource usage, perfect for Pi

### [traefik/](traefik/)
Traefik reverse proxy for Docker environments:
- Docker-native with automatic service discovery
- Dynamic configuration via Docker labels
- Popular on Synology NAS and container setups

### [synology/](synology/)
Synology DSM-specific setup guide:
- Using built-in Application Portal reverse proxy
- Docker deployment instructions
- Alternative solutions for advanced features

## Quick Start

1. Choose your web server or platform:
   - **Raspberry Pi**: Caddy (easiest) or nginx (more control)
   - **Synology NAS**: Built-in proxy or Traefik with Docker
   - **General server**: nginx or Apache
   - **Docker setup**: Traefik
2. Copy the appropriate configuration file
3. Customize for your environment:
   - Domain name
   - SSL certificate paths
   - Allowed IP ranges
   - Log file locations
4. Test and reload your web server

## Security Best Practices

1. **Always use HTTPS in production** - The example configs include SSL setup
2. **Restrict access to sensitive endpoints** - /events and /debug are locked down by default
3. **Enable authentication** - Use the API's built-in auth with environment variables
4. **Keep security headers enabled** - All configs include modern security headers
5. **Monitor access logs** - Watch for suspicious activity

## Spotify OAuth Configuration

All proxy configurations include special handling for the Spotify OAuth callback endpoint (`/spotify/callback`). This endpoint must be publicly accessible for the OAuth flow to work properly. The configurations ensure:

- `/spotify/callback` bypasses IP restrictions that apply to other endpoints
- The endpoint is accessible via HTTPS (required by Spotify)
- Proper headers are passed through for the OAuth flow

When configuring Spotify OAuth:
1. Set your redirect URI to `https://yourdomain.com/spotify/callback` in your Spotify app settings
2. Ensure this matches the `SPOTIFY_REDIRECT_URI` in your environment configuration
3. The callback endpoint will be publicly accessible even if you have authentication enabled

## Common Customizations

### Changing the API port
If running the API on a different port, update all `proxy_pass` (nginx) or `ProxyPass` (Apache) directives:
```nginx
proxy_pass http://localhost:5005/;  # Change 5005 to your port
```

### Adding rate limiting (nginx only)
1. Add to main nginx.conf:
```nginx
limit_req_zone $binary_remote_addr zone=api_zone:10m rate=10r/s;
```
2. Uncomment the `limit_req` lines in the server config

### Custom access control
Modify the IP ranges in the /events and /debug locations to match your network:
```nginx
allow 192.168.1.0/24;  # Your local network
allow 203.0.113.0/24;  # Your office network
```

## Troubleshooting

- **502 Bad Gateway**: Check if the API is running on the expected port
- **SSE not working**: Ensure buffering is disabled for /events endpoint
- **Authentication issues**: Verify proxy passes Authorization headers
- **SSL errors**: Check certificate paths and permissions

## Additional Resources

- [Sonos API Documentation](https://github.com/kshartman/sonos-alexa-api)
- [Nginx Proxy Documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Apache Proxy Documentation](https://httpd.apache.org/docs/current/mod/mod_proxy.html)