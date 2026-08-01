variable "project_id" {
  type    = string
  default = "rui-an"
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

variable "access_token" {
  type        = string
  sensitive   = true
  description = "Short-lived token from `gcloud auth print-access-token`."
}
