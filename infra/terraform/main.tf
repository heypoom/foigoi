provider "google" {
  project      = var.project_id
  region       = var.region
  access_token = var.access_token
}

moved {
  from = google_compute_address.api
  to   = google_compute_address.api[0]
}

moved {
  from = google_compute_firewall.https
  to   = google_compute_firewall.https[0]
}

resource "google_project_service" "services" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "api" {
  depends_on    = [google_project_service.services]
  location      = var.region
  repository_id = "foigoi"
  format        = "DOCKER"
}

resource "google_compute_address" "api" {
  count = var.create_runtime_resources ? 1 : 0

  depends_on = [google_project_service.services]
  name       = "foigoi-api"
  region     = var.region
}

resource "google_service_account" "api" {
  account_id   = "foigoi-api"
  display_name = "Foigoi API VM"
}

resource "google_project_iam_member" "logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "artifact_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_compute_disk" "model_cache" {
  count = var.create_gpu_instance ? 1 : 0

  name = "foigoi-model-cache"
  type = "pd-ssd"
  zone = var.zone
  size = var.cache_disk_size_gb
}

resource "google_compute_firewall" "https" {
  count = var.create_runtime_resources ? 1 : 0

  name        = "foigoi-https"
  network     = "default"
  target_tags = ["foigoi-api"]

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  source_ranges = ["0.0.0.0/0"]
}

resource "google_compute_instance" "api" {
  count = var.create_gpu_instance && var.create_runtime_resources ? 1 : 0

  depends_on   = [google_project_service.services]
  name         = "foigoi-api"
  machine_type = "g2-standard-24"
  zone         = var.zone
  tags         = ["foigoi-api"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 100
      type  = "pd-ssd"
    }
  }

  attached_disk {
    source      = google_compute_disk.model_cache[0].id
    device_name = "foigoi-model-cache"
  }

  guest_accelerator {
    type  = "nvidia-l4"
    count = 2
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.api[0].address
    }
  }

  service_account {
    email  = google_service_account.api.email
    scopes = ["cloud-platform"]
  }

  scheduling {
    provisioning_model  = "STANDARD"
    automatic_restart   = true
    on_host_maintenance = "TERMINATE"
  }

  metadata_startup_script = templatefile("${path.module}/templates/startup.sh.tftpl", {
    api_image    = var.api_image
    api_hostname = var.api_hostname
  })

  lifecycle {
    precondition {
      condition     = trimspace(var.api_image) != ""
      error_message = "api_image must reference an immutable Artifact Registry image when create_gpu_instance is true."
    }

    precondition {
      condition     = var.create_runtime_resources
      error_message = "create_runtime_resources must be true when create_gpu_instance is true."
    }
  }
}
