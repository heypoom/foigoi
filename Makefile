PROJECT_ID ?= rui-an
REGION ?= asia-southeast1
ZONE ?= asia-southeast1-b
IMAGE_REPOSITORY := $(REGION)-docker.pkg.dev/$(PROJECT_ID)/foigoi/foigoi-api

.PHONY: image-smoke infra-init infra-up infra-down infra-smoke infra-schedule infra-validate

image-smoke:
	FOIGOI_API_IMAGE=foigoi-api:test docker compose -f api/compose.yaml config
	docker build --file api/Dockerfile --tag foigoi-api:test api

infra-init:
	@set -eu; \
	access_token="$$(gcloud auth print-access-token)"; \
	state_bucket="foigoi-tf-state-$$(gcloud projects describe $(PROJECT_ID) --format='value(projectNumber)')"; \
	TF_VAR_access_token="$$access_token" terraform -chdir=infra/bootstrap init -backend=false; \
	if ! TF_VAR_access_token="$$access_token" terraform -chdir=infra/bootstrap state show google_storage_bucket.terraform_state >/dev/null 2>&1 && gcloud storage buckets describe "gs://$$state_bucket" >/dev/null 2>&1; then \
		TF_VAR_access_token="$$access_token" terraform -chdir=infra/bootstrap import google_storage_bucket.terraform_state "$$state_bucket"; \
	fi; \
	TF_VAR_access_token="$$access_token" terraform -chdir=infra/bootstrap apply -auto-approve; \
	state_bucket="$$(TF_VAR_access_token="$$access_token" terraform -chdir=infra/bootstrap output -raw state_bucket_name)"; \
	terraform -chdir=infra/terraform init -reconfigure \
		-backend-config="bucket=$$state_bucket" \
		-backend-config="prefix=foigoi/gpu-api" \
		-backend-config="access_token=$$access_token"

infra-up: infra-init
	@test -n "$(IMAGE_TAG)" || (echo "IMAGE_TAG is required (for example: IMAGE_TAG=$$(git rev-parse --short HEAD))" >&2; exit 1)
	@gcloud auth configure-docker $(REGION)-docker.pkg.dev --quiet
	docker build --platform linux/amd64 --file api/Dockerfile --tag $(IMAGE_REPOSITORY):$(IMAGE_TAG) api
	docker push $(IMAGE_REPOSITORY):$(IMAGE_TAG)
	@access_token="$$(gcloud auth print-access-token)"; \
	TF_VAR_access_token="$$access_token" terraform -chdir=infra/terraform apply -auto-approve \
		-var="api_image=$(IMAGE_REPOSITORY):$(IMAGE_TAG)" \
		-var="create_runtime_resources=true" \
		-var="create_gpu_instance=true"

infra-down: infra-init
	@access_token="$$(gcloud auth print-access-token)"; \
	TF_VAR_access_token="$$access_token" terraform -chdir=infra/terraform apply -auto-approve \
		-var="create_runtime_resources=false" \
		-var="create_gpu_instance=false"

infra-smoke:
	gcloud compute ssh foigoi-api --project $(PROJECT_ID) --zone $(ZONE) --tunnel-through-iap --command='sudo docker exec foigoi-api-1 uv run python scripts/run_gpu_smoke.py'

infra-schedule: infra-init
	@set -eu; \
	active_execution="$$(gcloud workflows executions list foigoi-performance-august-2026 --project $(PROJECT_ID) --location $(REGION) --filter='state=ACTIVE' --format='value(name)' --limit=1)"; \
	if [ -n "$$active_execution" ]; then \
		echo "The August 2026 performance schedule is already active: $$active_execution" >&2; \
		exit 1; \
	fi; \
	gcloud workflows run foigoi-performance-august-2026 --project $(PROJECT_ID) --location $(REGION) --async

infra-validate:
	terraform -chdir=infra/bootstrap init -backend=false
	terraform -chdir=infra/bootstrap validate
	terraform -chdir=infra/terraform init -backend=false
	terraform -chdir=infra/terraform validate
