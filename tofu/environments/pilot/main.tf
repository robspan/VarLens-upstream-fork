# Konzept-Pilot auf Hetzner Cloud.
# Stack: ein Server, ein Daten-Volume, eine Firewall, ein SSH-Key.
# Bootstrapping per cloud-init (siehe cloud-init/pilot.yaml).

provider "hcloud" {
  token = var.hcloud_token
}

# SSH-Key des Maintainers in die Hetzner Console hochladen.
resource "hcloud_ssh_key" "maintainer" {
  name       = var.ssh_pubkey_name
  public_key = var.ssh_pubkey
}

# Daten-Volume separat vom Server. Überlebt eine Neu-Provisionierung des Servers.
# Wird per cloud-init formatiert und nach /mnt/data gemountet.
#
# Konzept-Pilot: kein prevent_destroy, weil Test-Daten und Kostenersparnis-Teardown
# wichtiger ist als Daten-Schutz. Stufe 2 (Echt-Daten): prevent_destroy einschalten.
resource "hcloud_volume" "data" {
  name     = "${var.server_name}-data"
  size     = var.data_volume_size_gb
  location = var.server_location
  format   = "ext4"
}

# Firewall. Konzept-Stand: SSH und HTTPS nach außen offen, HTTP nur für ACME-Redirect.
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
    description = "HTTP fuer ACME und Redirect auf HTTPS"
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
    description = "ICMP fuer Diagnose"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
}

# Hinweis: Monitoring-UIs (Uptime Kuma, Dozzle) sind via Caddy-Reverse-Proxy
# unter /monitor/ und /logs/ erreichbar, hinter Basic-Auth. Direkte Ports 3001
# und 8080 werden nicht in der Cloud-Firewall geöffnet.

# Server. cloud-init bekommt das Volume per Templatefile als Mount-Ziel mitgeteilt.
#
# Wichtig zum Lifecycle: jede Änderung an cloud-init/pilot.yaml ändert den
# user_data-Hash. Hetzner kann user_data nicht in-place ändern; tofu apply
# zerstört dann den Server und erstellt einen neuen. Das Daten-Volume bleibt
# (eigene Resource), aber der Compose-Stack muss nach dem Replace neu deployed
# werden (`make stack-up`). Diese Eigenschaft ist Absicht: cloud-init-Änderungen
# sollen sich tatsächlich auf neuen Servern auswirken können. Für Adopter, die
# das Verhalten ändern möchten, siehe das auskommentierte ignore_changes-Beispiel.
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

  # Adopter, die ihren Server vor user_data-Replace schützen möchten:
  # lifecycle {
  #   ignore_changes = [user_data, ssh_keys]
  # }
}

# Volume-Anhang: Volume bleibt eigenes Lifecycle, wird nur beim Server-Boot mit angehängt.
resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.pilot.id
  automount = false # Mount erfolgt durch cloud-init mit fstab-Eintrag.
}
