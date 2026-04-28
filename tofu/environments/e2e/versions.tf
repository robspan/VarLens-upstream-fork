# E2E-Test-Environment. Wegwerfbar, läuft parallel zu pilot, eigener State.

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }
}
