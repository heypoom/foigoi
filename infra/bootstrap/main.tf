terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0.0, < 7.0.0"
    }
  }
}

provider "google" {
  project      = var.project_id
  region       = var.region
  access_token = var.access_token
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_storage_bucket" "terraform_state" {
  name                        = "foigoi-tf-state-${data.google_project.current.number}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }
}
