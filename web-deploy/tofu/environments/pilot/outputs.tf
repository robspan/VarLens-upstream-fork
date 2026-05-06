# Output after a successful tofu apply. View via `tofu output`.

output "server_name" {
  description = "Name of the server in the Hetzner Console."
  value       = hcloud_server.pilot.name
}

output "server_id" {
  description = "Hetzner server ID."
  value       = hcloud_server.pilot.id
}

output "ipv4" {
  description = "Public IPv4 address."
  value       = hcloud_server.pilot.ipv4_address
}

output "ipv6" {
  description = "Public IPv6 address."
  value       = hcloud_server.pilot.ipv6_address
}

output "volume_id" {
  description = "Hetzner volume ID for the data volume."
  value       = hcloud_volume.data.id
}

output "ssh_command" {
  description = "First SSH connection as the deploy user after bootstrap."
  value       = "ssh ${var.deploy_user}@${hcloud_server.pilot.ipv4_address}"
}
