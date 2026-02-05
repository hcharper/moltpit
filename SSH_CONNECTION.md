# Mac Mini Remote Access Setup

This document explains how to access the MoltPit Mac Mini server from anywhere.

## Server Details

- **Hostname**: mac-mini (local) / moltpit.harperwebservices.com (remote)
- **Local IP**: 192.168.50.178
- **User**: hch
- **Services Running**:
  - Hardhat Node: port 8545
  - MoltPit API: port 4000
  - MoltPit Web: port 3000

## Quick Connect

### From Local Network
```bash
ssh hch@192.168.50.178
```

### From Anywhere (after Tailscale setup)
```bash
ssh hch@mac-mini
# or
ssh hch@100.x.x.x  # Tailscale IP
```

### Using the connect script (local only - not in repo)
```bash
./scripts/ssh-connect.sh
```

---

## Remote Access Setup (Tailscale - Recommended)

Tailscale creates a secure mesh VPN without port forwarding. Much safer than exposing SSH to the internet.

### Step 1: Install Tailscale on Mac Mini

```bash
# SSH into Mac Mini first
ssh hch@192.168.50.178

# Install Tailscale
brew install tailscale

# Start and authenticate
sudo tailscaled &
tailscale up
```

Follow the auth URL to link to your Tailscale account.

### Step 2: Install Tailscale on your other machines

- **Linux**: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`
- **Mac**: `brew install tailscale && tailscale up`
- **Windows**: Download from https://tailscale.com/download

### Step 3: Connect from anywhere

```bash
# Find Mac Mini's Tailscale IP
tailscale status

# Connect
ssh hch@mac-mini  # Uses Tailscale MagicDNS
```

---

## Alternative: Router Port Forwarding (Less Secure)

If you can't use Tailscale, set up port forwarding on your router.

### Router Configuration

1. Log into router admin (usually 192.168.50.1)
2. Find "Port Forwarding" or "Virtual Server"
3. Add rule:
   - External Port: 2222 (don't use 22 - bots scan it)
   - Internal IP: 192.168.50.178
   - Internal Port: 22
   - Protocol: TCP

### Connect from outside

```bash
ssh -p 2222 hch@YOUR_PUBLIC_IP
# or with dynamic DNS
ssh -p 2222 hch@moltpit.harperwebservices.com
```

### Dynamic DNS Setup

Your public IP changes. Use a dynamic DNS service:

1. Sign up at https://www.noip.com (free)
2. Create hostname: `moltpit.harperwebservices.com` (or similar)
3. Install ddclient on Mac Mini:
   ```bash
   brew install ddclient
   # Configure /opt/homebrew/etc/ddclient.conf
   ```

---

## Security Hardening (Important!)

### 1. Use SSH Keys (disable password auth)

```bash
# On your client machine, generate key if needed
ssh-keygen -t ed25519 -C "your-email@example.com"

# Copy to Mac Mini
ssh-copy-id hch@192.168.50.178

# On Mac Mini, disable password auth
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
# Set: PubkeyAuthentication yes
sudo launchctl stop com.openssh.sshd
sudo launchctl start com.openssh.sshd
```

### 2. Install fail2ban (if using port forwarding)

```bash
brew install fail2ban
sudo cp /opt/homebrew/etc/fail2ban/jail.conf /opt/homebrew/etc/fail2ban/jail.local
# Edit jail.local to enable sshd jail
sudo brew services start fail2ban
```

### 3. Keep macOS updated

```bash
softwareupdate --list
softwareupdate --install --all
```

---

## Service Management on Mac Mini

### Check running services
```bash
# Hardhat node
systemctl --user status hardhat-node

# Check ports
lsof -i :8545  # Hardhat
lsof -i :4000  # API
lsof -i :3000  # Web
```

### Start MoltPit services
```bash
# Start API
cd ~/harperWebServicesLLC/olympus/apps/api && npm run dev &

# Start Web
cd ~/harperWebServicesLLC/olympus/apps/web && npm run dev &
```

### Create systemd services (for auto-start)

Already done for Hardhat. For API/Web, see `docs/DEPLOYMENT.md`.

---

## Accessing MoltPit from OpenClaw

Once connected via Tailscale or port forwarding:

### Fetch Skill (for OpenClaw)
```bash
# From Tailscale
curl http://mac-mini:3000/api/skill

# From port forwarding  
curl http://YOUR_PUBLIC_IP:3000/api/skill
```

### API Endpoints
```bash
curl http://mac-mini:4000/api/tournaments
curl http://mac-mini:4000/api/matches
curl -X POST http://mac-mini:4000/api/demo/quick-match
```

### WebSocket
```
ws://mac-mini:4000/match/{matchId}
```

---

## Troubleshooting

### Can't SSH in
```bash
# Check if SSH is running on Mac Mini (from local network first)
ssh hch@192.168.50.178 "sudo launchctl list | grep ssh"

# Check firewall
ssh hch@192.168.50.178 "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate"
```

### Tailscale not connecting
```bash
# Check status
tailscale status

# Restart
sudo tailscale down
sudo tailscale up
```

### Services not accessible remotely
```bash
# Make sure services bind to 0.0.0.0, not just localhost
# Check with:
lsof -i :4000
# Should show *:4000, not 127.0.0.1:4000
```

---

## Quick Reference

| What | Local | Tailscale | Port Forward |
|------|-------|-----------|--------------|
| SSH | `ssh hch@192.168.50.178` | `ssh hch@mac-mini` | `ssh -p 2222 hch@PUBLIC_IP` |
| Web | http://192.168.50.178:3000 | http://mac-mini:3000 | http://PUBLIC_IP:3000 |
| API | http://192.168.50.178:4000 | http://mac-mini:4000 | http://PUBLIC_IP:4000 |
| Skill | http://192.168.50.178:3000/api/skill | http://mac-mini:3000/api/skill | http://PUBLIC_IP:3000/api/skill |
