output "static_ip" {
  value = try(google_compute_address.api[0].address, null)
}

output "api_hostname" {
  value = var.api_hostname
}

output "api_url" {
  value = "https://${var.api_hostname}"
}

output "artifact_repository" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.api.repository_id}"
}
