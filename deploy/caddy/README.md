# Caddy Configuration Examples

Caddy is a modern web server with automatic HTTPS that's popular on Raspberry Pi and home servers due to its simplicity and low resource usage.

**Note**: These configurations have been generated based on Caddy best practices but have NOT been tested by the authors. Please test thoroughly before using in production.

## Why Caddy?

- **Automatic HTTPS**: Obtains and renews Let's Encrypt certificates automatically
- **Simple configuration**: Much less verbose than nginx/Apache
- **Low resource usage**: Perfect for Raspberry Pi
- **Built-in security**: Secure defaults out of the box

## Files

### Caddyfile
Production configuration with:
- Automatic HTTPS via Let's Encrypt
- Security headers
- IP-based access control for /events and /debug
- SSE support with proper timeouts
- Request size limits

### Caddyfile.simple
Minimal HTTP-only configuration for internal use

## Installation

### On Raspberry Pi:
```bash
# Install Caddy
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Copy configuration
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Using Docker:
```bash
docker run -d \
  --name caddy \
  --network host \
  -v $PWD/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  -v caddy_config:/config \
  caddy:latest
```

## Key Features

### Automatic HTTPS
Simply use your domain name and Caddy handles certificates:
```
sonosapi.yourdomain.com {
    reverse_proxy localhost:5005
}
```

### IP-Based Access Control
Caddy uses matcher blocks for access control:
```
@allowed {
    remote_ip 192.168.0.0/16 10.0.0.0/8
}
handle @allowed {
    reverse_proxy localhost:5005
}
respond 403
```

### SSE Support
Disable buffering for Server-Sent Events:
```
reverse_proxy localhost:5005 {
    flush_interval -1
}
```

## Differences from nginx/Apache

1. **Simpler syntax**: No semicolons, fewer directives
2. **Automatic HTTPS**: No manual certificate configuration
3. **Built-in matchers**: Easier conditional logic
4. **Implicit features**: Many security features enabled by default

## Usage

1. Update `sonosapi.yourdomain.com` with your actual domain
2. Adjust IP ranges in the `@allowed` matchers
3. Save as `/etc/caddy/Caddyfile`
4. Test configuration: `caddy validate`
5. Reload: `sudo systemctl reload caddy`

## Monitoring

View Caddy logs:
```bash
# Service logs
sudo journalctl -u caddy -f

# Access logs (if configured)
sudo tail -f /var/log/caddy/access.log
```

## Tips for Raspberry Pi

1. **Use local DNS**: Add entry to `/etc/hosts` for testing
2. **Monitor resources**: `htop` to watch CPU/memory usage
3. **SD card considerations**: Consider log rotation to minimize writes
4. **Temperature**: Monitor with `vcgencmd measure_temp`