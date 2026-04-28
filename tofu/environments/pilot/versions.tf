# Pin OpenTofu and provider versions for reproducibility.

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }

  # Lokales State-Backend für Konzept-Pilot.
  # Stufe 2: S3-natives Locking gegen einen S3-API-Bucket (siehe ADR-9).
}
