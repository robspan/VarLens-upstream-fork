# Concept Pilot on Hetzner Cloud.
# Stack: one server, one data volume, one firewall, one SSH key.
# Bootstrapping via cloud-init (see cloud-init/pilot.yaml).

provider "hcloud" {
  token = var.hcloud_token
}

# Upload the maintainer's SSH key to the Hetzner Console.
resource "hcloud_ssh_key" "maintainer" {
  name       = var.ssh_pubkey_name
  public_key = var.ssh_pubkey
}

# Data volume separate from the server. Survives a re-provisioning of the server.
# Formatted via cloud-init and mounted to /mnt/data.
#
# Concept Pilot: no prevent_destroy, because for test data the cost-saving
# teardown is more important than data protection. Stage 2 (real data):
# enable prevent_destroy.
resource "hcloud_volume" "data" {
  name     = "${var.server_name}-data"
  size     = var.data_volume_size_gb
  location = var.server_location
  format   = "ext4"
}

# Firewall. Concept Pilot: SSH and HTTPS open to the outside, HTTP only for the ACME redirect.
resource "hcloud_firewall" "pilot" {
  name = "${var.server_name}-fw"

  rule {
    description = "SSH"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.ssh_allowlist
  }

  rule {
    description = "HTTP for ACME and redirect to HTTPS"
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description = "HTTPS"
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description = "ICMP for diagnostics"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
}

# Note: monitoring UIs (Uptime Kuma, Dozzle) are reachable via the Caddy
# reverse proxy under /monitor/ and /logs/, behind Basic Auth. The direct
# ports 3001 and 8080 are not opened in the cloud firewall.

# Server. cloud-init receives the volume as a mount target via templatefile.
#
# Important regarding lifecycle: any change to cloud-init/pilot.yaml changes
# the user_data hash. Hetzner cannot change user_data in-place; tofu apply
# will then destroy the server and create a new one. The data volume remains
# (separate resource), but the Compose stack must be redeployed after the
# replace (`make stack-up`). This behavior is intentional: cloud-init changes
# should actually be able to take effect on new servers. For adopters who
# want to change this behavior, see the commented-out ignore_changes example.
resource "hcloud_server" "pilot" {
  name        = var.server_name
  server_type = var.server_type
  image       = var.server_image
  location    = var.server_location

  ssh_keys     = [hcloud_ssh_key.maintainer.id]
  firewall_ids = [hcloud_firewall.pilot.id]

  user_data = templatefile("${path.module}/../../../cloud-init/pilot.yaml", {
    deploy_user = var.deploy_user
    ssh_pubkey  = var.ssh_pubkey
    volume_id   = hcloud_volume.data.id
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  # Adopters who want to protect their server from a user_data replace:
  # lifecycle {
  #   ignore_changes = [user_data, ssh_keys]
  # }
}

# Volume attachment: the volume keeps its own lifecycle and is only attached when the server boots.
resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.pilot.id
  automount = false # Mounting is handled by cloud-init via an fstab entry.
}
