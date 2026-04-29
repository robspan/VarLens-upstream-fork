# Inputs for the Concept Pilot. Real values live in terraform.tfvars
# (not committed, see .gitignore). Example: terraform.tfvars.example.

variable "hcloud_token" {
  description = "Hetzner Cloud API token with read-write permission. Create it in the Hetzner Console under Security, API Tokens."
  type        = string
  sensitive   = true
}

variable "server_name" {
  description = "Name of the server in the Hetzner Console."
  type        = string
  default     = "varlens-pilot-fsn1"
}

variable "server_type" {
  description = "Hetzner server type. cpx32 = 4 vCPU, 8 GB RAM, 160 GB disk."
  type        = string
  default     = "cpx32"
}

variable "server_image" {
  description = "OS image for the server. Ubuntu LTS recommended."
  type        = string
  default     = "ubuntu-24.04"
}

variable "server_location" {
  description = "Hetzner location. fsn1 = Falkenstein, EU-Central."
  type        = string
  default     = "fsn1"
}

variable "data_volume_size_gb" {
  description = "Size of the data volume in GB. Mounted to /mnt/data."
  type        = number
  default     = 50
}

variable "ssh_pubkey" {
  description = "SSH public key of the maintainer, who initially gets root access. Format as in ~/.ssh/id_ed25519.pub."
  type        = string
}

variable "ssh_pubkey_name" {
  description = "Label of the SSH key in the Hetzner Console."
  type        = string
  default     = "varlens-maintainer"
}

variable "deploy_user" {
  description = "Name of the deploy user, who is created via cloud-init with sudo rights and the SSH key. Root login is disabled afterwards."
  type        = string
  default     = "deploy"
}

variable "ssh_allowlist" {
  description = "CIDR ranges that get SSH access. Default: worldwide, because access is key-only and root is disabled. For stricter access, restrict this to your own IP."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
