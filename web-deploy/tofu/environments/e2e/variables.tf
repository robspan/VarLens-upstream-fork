# Inputs for the E2E test environment. Defaults are cost-minimal and
# named so that nothing collides with pilot (separate SSH key, server,
# and volume names).

variable "hcloud_token" {
  description = "Hetzner Cloud API token. May be identical to the pilot token."
  type        = string
  sensitive   = true
}

variable "server_name" {
  description = "Name of the E2E test server."
  type        = string
  default     = "varlens-e2e-fsn1"
}

variable "server_type" {
  description = "Hetzner server type. cpx11 = 2 vCPU, 2 GB RAM, cheaper than pilot."
  type        = string
  default     = "cpx11"
}

variable "server_image" {
  description = "OS image."
  type        = string
  default     = "ubuntu-24.04"
}

variable "server_location" {
  description = "Hetzner location."
  type        = string
  default     = "fsn1"
}

variable "data_volume_size_gb" {
  description = "Volume size for E2E. Kept small."
  type        = number
  default     = 10
}

variable "ssh_pubkey" {
  description = "SSH public key for the E2E test server. Must have a different fingerprint than the pilot key (Hetzner unique constraint)."
  type        = string
}

variable "ssh_pubkey_name" {
  description = "Label of the SSH key in the Hetzner Console."
  type        = string
  default     = "varlens-e2e-tofu"
}

variable "deploy_user" {
  description = "Deploy user on the server."
  type        = string
  default     = "deploy"
}

variable "ssh_allowlist" {
  description = "CIDR ranges with SSH access."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
