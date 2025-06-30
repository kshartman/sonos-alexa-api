# Synology DSM Reverse Proxy Setup

This guide explains how to configure Synology's built-in reverse proxy for the Sonos Alexa API.

**Note**: This guide has been created based on DSM documentation but has NOT been tested by the authors. Please test thoroughly and adjust for your specific DSM version and setup.

## Prerequisites

- Synology DSM 6.0 or later
- Sonos API running in Docker or as a native application
- Valid SSL certificate (Let's Encrypt via DSM or custom)

## Setup Steps

### 1. Open Control Panel

Navigate to **Control Panel** > **Application Portal** > **Reverse Proxy**

### 2. Create New Reverse Proxy Rule

Click **Create** and fill in:

#### General Settings:
- **Description**: Sonos Alexa API
- **Source Protocol**: HTTPS
- **Source Hostname**: sonosapi.yourdomain.com
- **Source Port**: 443
- **Enable HSTS**: ✓ (recommended)

#### Destination:
- **Destination Protocol**: HTTP
- **Destination Hostname**: localhost
- **Destination Port**: 5005

### 3. Custom Headers

Click **Custom Header** tab and add:

| Header Name | Value |
|------------|-------|
| X-Content-Type-Options | nosniff |
| X-Frame-Options | DENY |
| X-XSS-Protection | 1; mode=block |
| Referrer-Policy | no-referrer-when-downgrade |
| Content-Security-Policy | upgrade-insecure-requests |

### 4. Advanced Settings

For WebSocket/SSE support, you may need to add these headers:

| Header Name | Value |
|------------|-------|
| Upgrade | $http_upgrade |
| Connection | $connection_upgrade |

### 5. Access Control (Optional)

Since Synology's reverse proxy doesn't support path-based access control, consider:

1. **Use API Authentication**: Configure AUTH_USERNAME and AUTH_PASSWORD
2. **Firewall Rules**: Use DSM firewall to restrict access to certain IPs
3. **VPN Access**: Require VPN connection for sensitive endpoints

## Docker Setup on Synology

If running the API in Docker on Synology:

### Using Docker UI:

1. Open Docker package
2. Go to **Registry**, search for `kshartman/sonos-alexa-api`
3. Download the latest image
4. Go to **Image**, select the downloaded image, click **Launch**
5. Configure:
   - **Container Name**: sonos-api
   - **Network**: Use same network as host (for SSDP discovery)
   - **Port Settings**: Local Port 5005 → Container Port 5005
   - **Environment Variables**:
     - PORT=5005
     - DEFAULT_ROOM=Living Room
     - LOG_LEVEL=info

### Using SSH/Docker Compose:

```bash
# SSH into your Synology
ssh admin@your-synology-ip

# Create directory for compose file
mkdir -p /volume1/docker/sonos-api
cd /volume1/docker/sonos-api

# Create docker-compose.yml (see traefik example, adjust for direct deployment)
# Run with:
docker-compose up -d
```

## Limitations

Synology's built-in reverse proxy has some limitations:

1. **No path-based access control**: Cannot restrict /debug or /events by IP
2. **Limited header manipulation**: Some advanced proxy features unavailable
3. **No built-in rate limiting**: Consider using API-level rate limiting

## Alternative: Nginx Proxy Manager

For more control, consider using Nginx Proxy Manager in Docker:

```yaml
version: '3'
services:
  nginx-proxy-manager:
    image: 'jc21/nginx-proxy-manager:latest'
    ports:
      - '80:80'
      - '443:443'
      - '81:81'  # Admin interface
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
```

This provides a web UI with full nginx features including:
- Path-based access control
- Advanced headers and rewrites
- Built-in Let's Encrypt support
- Access lists for IP restrictions

## Security Recommendations

1. **Always enable API authentication** when exposed to internet
2. **Use Synology's firewall** to restrict access
3. **Enable 2FA on DSM** for additional security
4. **Regular updates** of both DSM and Docker containers
5. **Monitor logs** via DSM Log Center