# Eingaben für den Konzept-Pilot. Echte Werte stehen in terraform.tfvars
# (nicht commited, siehe .gitignore). Beispiel: terraform.tfvars.example.

variable "hcloud_token" {
  description = "Hetzner Cloud API-Token mit Read-Write-Recht. Erstellung in der Hetzner Console unter Sicherheit, API-Tokens."
  type        = string
  sensitive   = true
}

variable "server_name" {
  description = "Name des Servers in der Hetzner Console."
  type        = string
  default     = "varlens-pilot-fsn1"
}

variable "server_type" {
  description = "Hetzner-Server-Typ. cpx32 = 4 vCPU, 8 GB RAM, 160 GB Disk."
  type        = string
  default     = "cpx32"
}

variable "server_image" {
  description = "OS-Image für den Server. Ubuntu LTS empfohlen."
  type        = string
  default     = "ubuntu-24.04"
}

variable "server_location" {
  description = "Hetzner-Standort. fsn1 = Falkenstein, EU-Central."
  type        = string
  default     = "fsn1"
}

variable "data_volume_size_gb" {
  description = "Größe des Daten-Volumes in GB. Wird nach /mnt/data gemountet."
  type        = number
  default     = 50
}

variable "ssh_pubkey" {
  description = "SSH-Public-Key des Maintainers, der initial Root-Zugriff bekommt. Format wie in ~/.ssh/id_ed25519.pub."
  type        = string
}

variable "ssh_pubkey_name" {
  description = "Bezeichnung des SSH-Keys in der Hetzner Console."
  type        = string
  default     = "varlens-maintainer"
}

variable "deploy_user" {
  description = "Name des Deploy-Users, der per cloud-init mit sudo-Rechten und SSH-Key angelegt wird. Root-Login wird danach disabled."
  type        = string
  default     = "deploy"
}

variable "ssh_allowlist" {
  description = "CIDR-Bereiche, die SSH-Zugriff bekommen. Default: weltweit, weil key-only und root disabled. Für strikteren Zugriff hier auf eigene IP einschränken."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
