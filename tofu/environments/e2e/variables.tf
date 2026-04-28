# Eingaben für die E2E-Test-Environment. Defaults sind kosten-minimal
# und so benannt dass nichts mit pilot kollidiert (eigene SSH-Key-,
# Server- und Volume-Namen).

variable "hcloud_token" {
  description = "Hetzner Cloud API-Token. Darf identisch mit dem pilot-Token sein."
  type        = string
  sensitive   = true
}

variable "server_name" {
  description = "Name des E2E-Test-Servers."
  type        = string
  default     = "varlens-e2e-fsn1"
}

variable "server_type" {
  description = "Hetzner-Server-Typ. cpx11 = 2 vCPU, 2 GB RAM, billiger als pilot."
  type        = string
  default     = "cpx11"
}

variable "server_image" {
  description = "OS-Image."
  type        = string
  default     = "ubuntu-24.04"
}

variable "server_location" {
  description = "Hetzner-Standort."
  type        = string
  default     = "fsn1"
}

variable "data_volume_size_gb" {
  description = "Volume-Größe für E2E. Klein gehalten."
  type        = number
  default     = 10
}

variable "ssh_pubkey" {
  description = "SSH-Public-Key für den E2E-Test-Server. Muss anderen Fingerprint haben als der pilot-Key (Hetzner-Unique-Constraint)."
  type        = string
}

variable "ssh_pubkey_name" {
  description = "Bezeichnung des SSH-Keys in der Hetzner Console."
  type        = string
  default     = "varlens-e2e-tofu"
}

variable "deploy_user" {
  description = "Deploy-User auf dem Server."
  type        = string
  default     = "deploy"
}

variable "ssh_allowlist" {
  description = "CIDR-Bereiche mit SSH-Zugriff."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
