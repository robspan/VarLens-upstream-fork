# E2E test environment. Identical structure to pilot, with its own state
# and its own resource names. Provisioned end-to-end by `varlens e2e run`
# (up -> stack-up -> backup -> smoke -> restore-drill -> down).

provider "hcloud" {
  token = var.hcloud_token
}

resource "hcloud_ssh_key" "maintainer" {
  name       = var.ssh_pubkey_name
  public_key = var.ssh_pubkey
}

resource "hcloud_volume" "data" {
  name     = "${var.server_name}-data"
  size     = var.data_volume_size_gb
  location = var.server_location
  format   = "ext4"
}

resource "hcloud_firewall" "e2e" {
  name = "${var.server_name}-fw"

  rule {
    description = "SSH"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.ssh_allowlist
  }

  rule {
    description = "HTTP"
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
    description = "ICMP"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "e2e" {
  name        = var.server_name
  server_type = var.server_type
  image       = var.server_image
  location    = var.server_location

  ssh_keys     = [hcloud_ssh_key.maintainer.id]
  firewall_ids = [hcloud_firewall.e2e.id]

  # Same cloud-init as pilot: the setup must be bit-identical, otherwise
  # the E2E suite would test the wrong path.
  user_data = templatefile("${path.module}/../../../cloud-init/pilot.yaml", {
    deploy_user = var.deploy_user
    ssh_pubkey  = var.ssh_pubkey
    volume_id   = hcloud_volume.data.id
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  labels = {
    environment = "e2e"
    managed-by  = "varlens-cli"
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.e2e.id
  automount = false
}
