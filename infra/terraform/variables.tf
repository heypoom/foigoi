variable "project_id" {
  type    = string
  default = "rui-an"
}

variable "access_token" {
  type        = string
  sensitive   = true
  description = "Short-lived token from `gcloud auth print-access-token`."
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

variable "zone" {
  type    = string
  default = "asia-southeast1-b"
}

variable "api_image" {
  type        = string
  default     = ""
  description = "Immutable Artifact Registry image reference, required only when create_gpu_instance is true."
}

variable "api_hostname" {
  type    = string
  default = "foigoi-api.poom.dev"
}

variable "cache_disk_size_gb" {
  type    = number
  default = 200
}

variable "create_runtime_resources" {
  type        = bool
  default     = true
  description = "Create the public IP and firewall. Set false to tear down billable runtime resources while retaining state and Artifact Registry."
}

variable "create_gpu_instance" {
  type        = bool
  default     = false
  description = "Create the G2 VM and its persistent model-cache disk. Keep false until NVIDIA L4 quota is granted."
}
