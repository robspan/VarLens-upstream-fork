output "server_name" {
  value = hcloud_server.e2e.name
}

output "server_id" {
  value = hcloud_server.e2e.id
}

output "ipv4" {
  value = hcloud_server.e2e.ipv4_address
}

output "ipv6" {
  value = hcloud_server.e2e.ipv6_address
}

output "volume_id" {
  value = hcloud_volume.data.id
}

output "ssh_command" {
  value = "ssh ${var.deploy_user}@${hcloud_server.e2e.ipv4_address}"
}
