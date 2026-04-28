# Ausgabe nach erfolgreichem tofu apply. Per `tofu output` einsehbar.

output "server_name" {
  description = "Name des Servers in der Hetzner Console."
  value       = hcloud_server.pilot.name
}

output "server_id" {
  description = "Hetzner Server-ID."
  value       = hcloud_server.pilot.id
}

output "ipv4" {
  description = "Öffentliche IPv4-Adresse."
  value       = hcloud_server.pilot.ipv4_address
}

output "ipv6" {
  description = "Öffentliche IPv6-Adresse."
  value       = hcloud_server.pilot.ipv6_address
}

output "volume_id" {
  description = "Hetzner Volume-ID für das Daten-Volume."
  value       = hcloud_volume.data.id
}

output "ssh_command" {
  description = "Erste Verbindung per SSH als Deploy-User nach Bootstrap."
  value       = "ssh ${var.deploy_user}@${hcloud_server.pilot.ipv4_address}"
}
