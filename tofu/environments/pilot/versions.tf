# Pin OpenTofu and provider versions for reproducibility.

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }

  # Local state backend for the Concept Pilot.
  # Stage 2: S3-native locking against an S3 API bucket (see ADR-9).
}
