# Traefik Configuration Example

Traefik is a modern reverse proxy and load balancer that's especially popular in Docker environments. It's commonly used on both Raspberry Pi and Synology NAS systems.

**Note**: This configuration has been generated based on Traefik best practices but has NOT been tested by the authors. Please test thoroughly before using in production.

## Why Traefik?

- **Docker native**: Automatic service discovery via Docker labels
- **Dynamic configuration**: No restart needed for changes
- **Built-in Let's Encrypt**: Automatic HTTPS certificates
- **Dashboard**: Web UI for monitoring
- **Middleware**: Powerful request/response modification

## Files

### docker-compose.yml
Complete Docker Compose setup showing:
- Traefik configuration with automatic HTTPS
- Sonos API with proper labels for routing
- Security headers middleware
- IP whitelisting for sensitive endpoints
- Path-based routing

## Key Features

### Service Discovery
Traefik automatically discovers services via Docker labels:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.sonos.rule=Host(`sonosapi.yourdomain.com`)"
```

### Middleware
Apply security headers and access control:
```yaml
# Security headers
- "traefik.http.middlewares.headers.headers.customresponseheaders.X-Frame-Options=DENY"

# IP whitelist
- "traefik.http.middlewares.whitelist.ipwhitelist.sourcerange=192.168.0.0/16"
```

### Path-Based Routing
Different rules for different endpoints:
```yaml
# Debug endpoints with IP restriction
- "traefik.http.routers.debug.rule=Host(`api.domain.com`) && PathPrefix(`/debug`)"
- "traefik.http.routers.debug.middlewares=whitelist"
```

## Installation

### On Raspberry Pi or Synology:

1. **Create proxy network**:
```bash
docker network create proxy
```

2. **Create directories**:
```bash
mkdir -p traefik/letsencrypt
touch traefik/letsencrypt/acme.json
chmod 600 traefik/letsencrypt/acme.json
```

3. **Update docker-compose.yml**:
- Change `sonosapi.yourdomain.com` to your domain
- Update email for Let's Encrypt
- Adjust IP ranges for whitelist

4. **Start services**:
```bash
docker-compose up -d
```

## Synology Specific Notes

### Using Synology Docker UI:
1. Create the proxy network in Docker > Network
2. Deploy Traefik container with appropriate settings
3. Deploy Sonos API with labels as environment variables

### File Permissions:
On Synology, ensure proper ownership:
```bash
sudo chown -R 1000:1000 /volume1/docker/traefik
```

## Raspberry Pi Optimization

### Resource Limits:
Add to service definitions:
```yaml
deploy:
  resources:
    limits:
      cpus: '0.5'
      memory: 256M
```

### Lighter Traefik Image:
Use Alpine-based image:
```yaml
image: traefik:v2.10-alpine
```

## Common Issues

### Can't bind to port 80/443
On Synology, DSM might be using these ports:
1. Change DSM ports in Control Panel > Network > DSM Settings
2. Or use different ports and port forward on router

### Certificate Issues
Ensure DNS is properly configured and port 80 is accessible for HTTP challenge

### Service Discovery Not Working
Ensure Traefik container can access Docker socket:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

## Monitoring

### Traefik Dashboard
Access at http://your-server:8080 (if api.insecure=true)

### Logs
```bash
docker logs traefik
docker logs sonos-api
```

## Security Considerations

1. **Don't expose Docker socket** in production without proper security
2. **Use dashboard securely**: Add authentication middleware
3. **Restrict IP ranges** appropriately for your network
4. **Regular updates**: Keep Traefik and services updated

## Advanced Configuration

### Rate Limiting:
```yaml
- "traefik.http.middlewares.ratelimit.ratelimit.average=10"
- "traefik.http.middlewares.ratelimit.ratelimit.burst=20"
```

### Custom Error Pages:
```yaml
- "traefik.http.middlewares.errorpages.errors.status=400-599"
- "traefik.http.middlewares.errorpages.errors.service=errorpage-service"
```