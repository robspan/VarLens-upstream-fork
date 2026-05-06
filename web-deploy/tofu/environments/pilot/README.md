# Concept Pilot: OpenTofu Deploy Guide

Provisions a Hetzner Cloud server including firewall, data volume, and
first-boot bootstrap (Docker, SSH hardening, ufw, unattended-upgrades, restic, sops).

The primary Quickstart lives in the repository root README. This file documents
the OpenTofu configuration in detail and provides in-depth troubleshooting.

## Prerequisites

| Tool | Installation on macOS |
|---|---|
| OpenTofu (>= 1.7) | `brew install opentofu` |
| Hetzner token | Hetzner Console > Security > API Tokens > Read-Write |
| SSH key pair | `ssh-keygen -t ed25519 -f ~/.ssh/varlens-tofu -C "varlens-tofu" -N ""` |

## Setup

1. **Create the variables file**
   ```sh
   cd tofu/environments/pilot
   cp terraform.tfvars.example terraform.tfvars
   ```
   Set values in `terraform.tfvars`:
   - `hcloud_token` from the Hetzner Console
   - `ssh_pubkey` contents of `~/.ssh/varlens-tofu.pub`
   - `ssh_pubkey_name` (optional, default `varlens-maintainer`)

2. **Initialize**
   ```sh
   tofu init
   ```

3. **Review the plan**
   ```sh
   tofu plan
   ```
   Expected resources: 1 SSH key, 1 volume (50 GB), 1 firewall, 1 server, 1 volume attachment.

4. **Apply**
   ```sh
   tofu apply
   ```
   Hetzner resources take roughly 60 seconds, followed by the cloud-init bootstrap on the server, which takes two to five minutes.

5. **Retrieve outputs**
   ```sh
   tofu output
   ```
   Returns server name, IDs, IPv4, IPv6, and a ready-to-use SSH command.

6. **Server login**
   ```sh
   ssh -i ~/.ssh/varlens-tofu deploy@<ipv4>
   ```
   Login is by key only; root is disabled and password login is disabled.

## Removing a Manually Created Server

If a server was already created in the Hetzner Console beforehand (for example
for testing), delete it in the console before running `tofu apply`. Otherwise
Tofu will create an additional server and the manual one will be left orphaned.

## Bootstrap Verification

After logging in as the `deploy` user:

```sh
docker --version           # Docker Engine present
docker compose version     # Compose plugin present
df -h /mnt/data            # Data volume mounted, 50 GB
sudo ufw status            # Firewall active: 22, 80, 443
systemctl is-active ssh    # SSH running
cloud-init status          # status: done expected
```

Cloud-init log if there are issues: `sudo cat /var/log/cloud-init-output.log`.

## State Backend

The Concept Pilot uses local state (`terraform.tfstate` in the directory).
Stage 2 switches to S3-native locking against an S3-API bucket (see ADR-9 in the Architecture Decision Records).

Implication for the Concept stage: only one maintainer can run Tofu operations.
A multi-person workflow requires the Stage 2 remote backend.

## Destroy

```sh
tofu destroy
```

The Concept stage has **no** `prevent_destroy` on the volume — the `destroy` command
also removes the data volume. Stage 2 (real data) will change this.

## What's Next

After a successful bootstrap and Compose stack deploy, the next items are:

1. Add the application container to the Compose stack (once the app repo has a web build)
2. Database container (SQLite volume or PostgreSQL per `bewertungen.html` §bewertung2)
3. restic backup job against Hetzner Object Storage
4. Caddy TLS via Let's Encrypt once a domain is set
5. Continuous Integration: GitHub Actions, GHCR push, Trivy scan
