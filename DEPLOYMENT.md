# Zite — Deployment Guide

## Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 19 + Vite 8 |
| Backend | Node.js + Express 5 |
| Database | Airtable (SaaS) |
| Runtime | Node.js 24.x |
| Package Manager | npm |
| Reverse Proxy | Nginx |
| Process Manager | systemd |
| HTTPS | Let's Encrypt (requires domain) |

## Server Requirements

- **OS**: Ubuntu 22.04 / 24.04 LTS (recommended) or Debian 12
- **Memory**: 1GB minimum, 2GB recommended
- **Disk**: 10GB minimum
- **Node.js**: v24.x (install via `nvm` or `nodesource`)
- **Nginx**: latest stable
- **Domain**: optional (required for HTTPS)

## Project Structure

```
project-dvir/
├── client/             # React + Vite frontend
│   ├── src/            # source code
│   ├── dist/           # build output (generated)
│   └── package.json
├── server/             # Node.js + Express backend
│   ├── src/            # source code
│   │   ├── server.js   # main entry
│   │   ├── airtable.js # Airtable connection
│   │   ├── resolve-links.js
│   │   └── ...
│   └── package.json
├── .env                # environment variables (NOT in git)
├── .env.example        # template (in git)
├── .gitignore
└── DEPLOYMENT.md       # this file
```

## Environment Variables

Copy `.env.example` to `.env.production` and fill in the values:

```bash
cp .env.example .env.production
```

| Variable | Description | Required |
|----------|-------------|----------|
| `AIRTABLE_PAT` | Airtable Personal Access Token | ✅ |
| `AIRTABLE_BASE_ID` | Airtable Base ID | ✅ |
| `PORT` | Server port (default: 4000) | optional |
| `NODE_ENV` | `production` | ✅ |
| `ALLOWED_ORIGIN` | CORS origin (e.g. `https://yourdomain.com`) | optional |
| `VITE_API_URL` | API URL for client builds | optional |

**Security**: Never commit `.env` or `.env.production` to git.

## Install

### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Clone / Copy Project

```bash
# Option A: via git (recommended)
git clone <your-repo-url> /opt/zite
cd /opt/zite

# Option B: manual upload
# Upload the ZIP to server and extract
```

### 3. Install Dependencies

```bash
cd /opt/zite/server && npm install
cd /opt/zite/client && npm install
```

### 4. Configure Environment

```bash
# Copy and edit the environment file
cp /opt/zite/.env.example /opt/zite/server/.env
nano /opt/zite/server/.env
```

### 5. Build Frontend

```bash
cd /opt/zite/client && npm run build
```

### 6. Test Run

```bash
cd /opt/zite/server && node src/server.js
# Visit http://server-ip:4000/api/tables
# Should return 25 tables
```

## Production Setup

### Nginx Reverse Proxy

Install Nginx:

```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/zite`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL (configure after Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # Static files
    root /opt/zite/client/dist;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/zite /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### systemd Service

Create `/etc/systemd/system/zite-server.service`:

```ini
[Unit]
Description=Zite Express Server
After=network.target

[Service]
Type=simple
User=zite
Group=zite
WorkingDirectory=/opt/zite/server
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=4000
Environment=AIRTABLE_PAT=<fill>
Environment=AIRTABLE_BASE_ID=<fill>
Environment=ALLOWED_ORIGIN=https://yourdomain.com

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Create the system user:

```bash
sudo useradd -r -s /bin/false -m -d /opt/zite zite
sudo chown -R zite:zite /opt/zite
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable zite-server
sudo systemctl start zite-server
sudo systemctl status zite-server
```

### HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
# Auto-renewal is configured automatically
```

## Commands

| Action | Command |
|--------|---------|
| **Start** | `sudo systemctl start zite-server` |
| **Stop** | `sudo systemctl stop zite-server` |
| **Restart** | `sudo systemctl restart zite-server` |
| **Status** | `sudo systemctl status zite-server` |
| **Logs** | `sudo journalctl -u zite-server -f` |
| **Nginx reload** | `sudo systemctl reload nginx` |
| **Nginx test** | `sudo nginx -t` |

## Health Check

```bash
curl http://127.0.0.1:4000/api/tables
# Expected: JSON array of 25 tables
```

Or via browser/Nginx:

```
https://yourdomain.com/api/tables
```

## Logs

- Application: `sudo journalctl -u zite-server -f`
- Nginx access: `/var/log/nginx/access.log`
- Nginx error: `/var/log/nginx/error.log`

## Backup

### Database

Airtable is SaaS — no local backup needed. Export manually from Airtable UI.

### Project Files

```bash
# Backup entire project (excluding node_modules, dist, .env)
tar -czf /backup/zite-$(date +%Y%m%d).tar.gz \
  --exclude=node_modules \
  --exclude=client/dist \
  --exclude=.env \
  --exclude=.env.production \
  /opt/zite
```

### Retention

Keep last 30 days of backups:

```bash
find /backup -name "zite-*.tar.gz" -mtime +30 -delete
```

## Restore

```bash
# Stop the service
sudo systemctl stop zite-server

# Restore files
tar -xzf /backup/zite-20260101.tar.gz -C /opt/zite

# Re-install dependencies (if needed)
cd /opt/zite/server && npm install
cd /opt/zite/client && npm install && npm run build

# Restart
sudo systemctl start zite-server
```

## Deploy

### Manual Deploy (current process)

1. Backup current version
2. Copy new files to server
3. `cd /opt/zite/server && npm install`
4. `cd /opt/zite/client && npm install && npm run build`
5. Update `.env.production` if needed
6. `sudo systemctl restart zite-server`
7. Run health check
8. Smoke test

### Future: Git-based Deploy

1. `git pull` on server
2. `npm install` if dependencies changed
3. `npm run build` in client
4. `sudo systemctl restart zite-server`
5. Health check

## Rollback

1. Restore previous backup
2. `sudo systemctl restart zite-server`
3. Run health check
4. Verify in browser

## Troubleshooting

### Server won't start

```bash
# Check logs
sudo journalctl -u zite-server -n 50 --no-pager

# Test manually (as zite user)
sudo -u zite node /opt/zite/server/src/server.js

# Verify .env file
cat /opt/zite/server/.env | grep -v SECRET
```

### Nginx returns 502

```bash
# Server may not be running
sudo systemctl status zite-server

# Check Nginx config
sudo nginx -t
```

### Static files not loading

```bash
# Ensure dist exists
ls -la /opt/zite/client/dist/

# Check Nginx root path in config
# Restart Nginx after config change
sudo systemctl reload nginx
```

### HTTPS issues

```bash
# Check certificate expiry
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal
```
