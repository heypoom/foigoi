# Foigoi Singapore G2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Foigoi inference API reproducibly on a standard two-L4 GCP G2 VM in Singapore, with one diffusion pipeline per GPU and one-command provision and teardown.

**Architecture:** A pinned CUDA container image runs the API on a `g2-standard-24` VM in `asia-southeast1-b`. Terraform owns the runtime infrastructure, while a small local-state bootstrap creates the remote-state bucket. The API rejects hosts with fewer than two visible CUDA devices and loads text-to-image on `cuda:0` and image-to-image on `cuda:1`.

**Tech Stack:** Terraform and HashiCorp Google provider, GCP Compute Engine/Artifact Registry/Cloud Storage, Docker Compose, Caddy, Python 3.11, uv, PyTorch 2.2.2, Diffusers 0.27.2.

## Global Constraints

- Use GCP project `foigoi`, region `asia-southeast1`, zone `asia-southeast1-b`, and machine type `g2-standard-24`.
- Use a standard VM; do not use Spot or expose TCP 22 publicly.
- Serve HTTPS and WebSockets at `foigoi-api.poom.dev`.
- Use `pd-ssd` for `/var/lib/foigoi/models`; do not use `pd-standard`.
- Keep Terraform state and the Artifact Registry repository after `infra-down`; destroy the VM, static IP, firewall rules, and model-cache disk.
- Never store GCP credentials, Terraform state, image digests, or model-cache data in Git.
- Pin container base-image and Hugging Face model revisions before the first production deployment.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `api/utils/gpu_devices.py` | Validate CUDA visibility and provide the two fixed pipeline device identifiers. |
| `api/utils/pipelines.py` | Load each pipeline onto its assigned device and pin model revisions. |
| `api/tests/test_gpu_devices.py` | Fast CPU-only tests for startup validation. |
| `api/Dockerfile` | Build the immutable GPU API image from the locked Python environment. |
| `api/compose.yaml` | Run API and Caddy with NVIDIA GPU access and persistent model cache. |
| `api/Caddyfile` | Proxy HTTPS and WebSockets for `foigoi-api.poom.dev`. |
| `infra/bootstrap/*.tf` | Create the durable GCS Terraform-state bucket using local bootstrap state. |
| `infra/terraform/*.tf` | Own the runtime VM, networking, service account, cache disk, Artifact Registry, and outputs. |
| `infra/terraform/templates/startup.sh.tftpl` | Install NVIDIA Container Toolkit and start the Compose stack after GPU readiness. |
| `Makefile` | Provide `infra-init`, `infra-up`, and `infra-down` commands. |
| `README.md` | Document operator prerequisites, DNS, lifecycle, and Jakarta latency validation. |

### Task 1: Enforce two-GPU pipeline placement

**Files:**
- Create: `api/utils/gpu_devices.py`
- Create: `api/tests/test_gpu_devices.py`
- Modify: `api/utils/pipelines.py:1-25`

**Interfaces:**
- Produces: `require_pipeline_devices() -> tuple[str, str]`.
- Consumes: `torch.cuda.is_available()` and `torch.cuda.device_count()`.
- The returned tuple is `(text2img_device, img2img_device)` and is consumed only by `pipelines.py`.

- [ ] **Step 1: Write failing CPU-only validation tests**

```python
import unittest
from unittest.mock import patch

from utils.gpu_devices import require_pipeline_devices

class PipelineDeviceTest(unittest.TestCase):
    @patch('utils.gpu_devices.torch.cuda.is_available', return_value=False)
    def test_requires_cuda(self, _is_available):
        with self.assertRaisesRegex(RuntimeError, 'CUDA is not available'):
            require_pipeline_devices()

    @patch('utils.gpu_devices.torch.cuda.device_count', return_value=1)
    @patch('utils.gpu_devices.torch.cuda.is_available', return_value=True)
    def test_requires_two_visible_gpus(self, _is_available, _device_count):
        with self.assertRaisesRegex(
            RuntimeError, 'requires 2 CUDA devices, found 1'
        ):
            require_pipeline_devices()

    @patch('utils.gpu_devices.torch.cuda.device_count', return_value=2)
    @patch('utils.gpu_devices.torch.cuda.is_available', return_value=True)
    def test_assigns_one_device_per_pipeline(self, _is_available, _device_count):
        self.assertEqual(
            require_pipeline_devices(), ('cuda:0', 'cuda:1')
        )
```

- [ ] **Step 2: Run the test before implementation**

Run: `cd api && uv run python -m unittest tests.test_gpu_devices -v`

Expected: FAIL because `utils.gpu_devices` does not exist.

- [ ] **Step 3: Add the minimal device guard**

```python
import torch

TEXT2IMG_DEVICE = 'cuda:0'
IMG2IMG_DEVICE = 'cuda:1'

def require_pipeline_devices() -> tuple[str, str]:
    if not torch.cuda.is_available():
        raise RuntimeError('Foigoi requires CUDA, but CUDA is not available')

    device_count = torch.cuda.device_count()
    if device_count < 2:
        raise RuntimeError(
            f'Foigoi requires 2 CUDA devices, found {device_count}'
        )

    return TEXT2IMG_DEVICE, IMG2IMG_DEVICE
```

In `pipelines.py`, call `require_pipeline_devices()` before loading either
pipeline, use the first result in `.to(...)` for `text2img`, and the second
result for `img2img`. Log the selected device identifiers and
`torch.cuda.get_device_name(0/1)` after validation. Add these immutable
`revision=` arguments beside their model IDs:

```python
SDXL_REVISION = 'e4e60c65aa20ee60092c60ba197f541872cf9373'
SD15_REVISION = '451f4fe16113bff5a5d2269ed5ad43b0592e9a14'
```

- [ ] **Step 4: Run the CPU-only tests and static syntax check**

Run: `cd api && uv run python -m unittest tests.test_gpu_devices -v && uv run python -m compileall utils/pipelines.py utils/gpu_devices.py`

Expected: all three tests pass and both modules compile.

- [ ] **Step 5: Commit the independently testable change**

```bash
git add api/utils/gpu_devices.py api/utils/pipelines.py api/tests/test_gpu_devices.py
git commit -m "feat: assign diffusion pipelines to separate GPUs"
```

### Task 2: Package the API and HTTPS proxy as a GPU-ready runtime

**Files:**
- Create: `api/Dockerfile`
- Create: `api/compose.yaml`
- Modify: `api/Caddyfile:1-22`
- Modify: `api/pyproject.toml`
- Modify: `api/uv.lock`

**Interfaces:**
- Consumes: image tag `asia-southeast1-docker.pkg.dev/foigoi/foigoi/foigoi-api:<git-sha>`.
- Consumes: host model-cache mount `/var/lib/foigoi/models`.
- Produces: Caddy listener on TCP 443 forwarding `/` and `/ws` to API port 8000.

- [ ] **Step 1: Add a container smoke-test command that will initially fail**

Create a `healthcheck` in `api/compose.yaml` that calls
`http://api:8000/docs` and add a `make image-smoke` target that runs:

```bash
docker compose -f api/compose.yaml config
docker build --file api/Dockerfile --tag foigoi-api:test api
```

Run: `make image-smoke`

Expected: FAIL because the Dockerfile and Compose file do not exist.

- [ ] **Step 2: Build the locked CUDA image**

Use a CUDA 12.1 runtime base image pinned by digest, install Python 3.11 and
uv, copy `pyproject.toml` and `uv.lock` before source files, and execute:

```dockerfile
RUN uv sync --frozen --no-dev
ENV HF_HOME=/var/lib/foigoi/models
CMD ["uv", "run", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
```

Add an xFormers dependency compatible with the locked `torch==2.2.2`, resolve
it into `uv.lock`, and make the Docker build import `xformers` and `torch` to
fail at build time if the wheel pair is incompatible.

Define Compose services `api` and `caddy`. Give only `api` access to all GPUs,
mount the cache disk at `/var/lib/foigoi/models`, expose API port 8000 only to
Caddy, and expose Caddy ports 80 and 443. Caddy uses automatic HTTPS for
`foigoi-api.poom.dev` and proxies both normal HTTP and `/ws` traffic to
`api:8000`.

- [ ] **Step 3: Validate package metadata and container configuration**

Run: `cd api && uv lock --check && docker compose config && docker build --file Dockerfile --tag foigoi-api:test .`

Expected: lock is current, Compose resolves, and image build completes.

- [ ] **Step 4: Commit the deployable runtime**

```bash
git add api/Dockerfile api/compose.yaml api/Caddyfile api/pyproject.toml api/uv.lock
git commit -m "feat: package GPU inference API for deployment"
```

### Task 3: Bootstrap remote Terraform state and declare the Singapore runtime

**Files:**
- Create: `infra/bootstrap/main.tf`
- Create: `infra/bootstrap/variables.tf`
- Create: `infra/bootstrap/outputs.tf`
- Create: `infra/terraform/versions.tf`
- Create: `infra/terraform/variables.tf`
- Create: `infra/terraform/main.tf`
- Create: `infra/terraform/outputs.tf`
- Create: `infra/terraform/templates/startup.sh.tftpl`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `project_id=foigoi`, `region=asia-southeast1`, `zone=asia-southeast1-b`, and immutable API image tag.
- Produces: static external IP, `api_url`, and the Artifact Registry repository URL.
- Runtime Terraform state is supplied by `terraform init -backend-config="bucket=<bootstrap output>"`.

- [ ] **Step 1: Add Terraform formatting/validation checks before resources exist**

Add a root `Makefile` target:

```make
infra-validate:
	terraform -chdir=infra/bootstrap fmt -check -recursive
	terraform -chdir=infra/terraform fmt -check -recursive
	terraform -chdir=infra/bootstrap validate
	terraform -chdir=infra/terraform validate
```

Run: `make infra-validate`

Expected: FAIL because the Terraform directories and configuration are absent.

- [ ] **Step 2: Create deterministic remote-state bootstrap**

The bootstrap module uses the Google provider authenticated through Application
Default Credentials, reads the GCP project number, and creates a versioned,
uniform-bucket-level-access GCS bucket named `foigoi-tf-state-<project-number>`
in `asia-southeast1`. Output its name as `state_bucket_name`. Add
`.terraform/`, `*.tfstate`, `*.tfstate.*`, and `infra/terraform/backend.hcl`
to `.gitignore`.

- [ ] **Step 3: Declare the runtime infrastructure**

Use provider constraints `terraform >= 1.6.0` and Google provider
`>= 6.0.0, < 7.0.0`. The runtime module creates:

```hcl
resource "google_compute_instance" "api" {
  name         = "foigoi-api"
  machine_type = "g2-standard-24"
  zone         = var.zone

  scheduling {
    provisioning_model  = "STANDARD"
    automatic_restart   = true
    on_host_maintenance = "TERMINATE"
  }
}
```

Add a regional static IP, `pd-ssd` cache disk with `auto_delete = true`, an
Artifact Registry Docker repository, least-privilege service account, and a
firewall tag allowing only TCP 80/443. Do not create a TCP 22 rule. Attach the
startup-script template through instance metadata. The template installs the
NVIDIA driver/toolkit, authenticates Docker with the VM service account, pulls
the immutable image tag, writes the Compose environment file, and starts the
Compose stack. It must run `nvidia-smi -L` and reject any count other than two
before starting the API.

Output `static_ip`, `api_hostname`, `api_url`, and `artifact_repository`.

- [ ] **Step 4: Initialize and validate without applying cloud resources**

Run:

```bash
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
make infra-validate
```

Expected: all commands succeed without creating GCP resources.

- [ ] **Step 5: Commit the infrastructure declaration**

```bash
git add infra .gitignore Makefile
git commit -m "feat: provision Foigoi Singapore G2 infrastructure"
```

### Task 4: Add the operator lifecycle and deployment verification guide

**Files:**
- Create: `infra/README.md`
- Modify: `Makefile`
- Modify: `README.md`

**Interfaces:**
- Consumes: Terraform bootstrap output, an authenticated `gcloud` CLI, Docker,
  Terraform, and the DNS A record for `foigoi-api.poom.dev`.
- Produces: `infra-init`, `infra-up`, and `infra-down` commands.

- [ ] **Step 1: Add failing command documentation checks**

Add the exact operator commands below to `infra/README.md`, then run each with
`make -n` to confirm the targets are not yet defined:

```bash
make -n infra-init
make -n infra-up IMAGE_TAG=$(git rev-parse --short HEAD)
make -n infra-down
```

Expected: FAIL before the targets are added.

- [ ] **Step 2: Implement the lifecycle targets and guide**

`infra-init` runs bootstrap init/apply, reads `state_bucket_name`, and initializes
the runtime backend. `infra-up` requires `IMAGE_TAG`, builds and pushes
`asia-southeast1-docker.pkg.dev/foigoi/foigoi/foigoi-api:${IMAGE_TAG}`, then
applies runtime Terraform with that image reference. `infra-down` destroys only
the runtime module; it never calls destroy in `infra/bootstrap`.

Document these required manual and validation actions:

1. Authenticate as `poom@poom.dev` with Application Default Credentials.
2. Enable Compute Engine, Artifact Registry, and Cloud Storage APIs.
3. Request two standard L4 GPUs in `asia-southeast1` quota.
4. Point `foigoi-api.poom.dev` at `terraform output -raw static_ip`.
5. Check certificate issuance, `wss://foigoi-api.poom.dev/ws`, `nvidia-smi -L`,
   API startup GPU logs, and Jakarta WebSocket RTT/prompt-to-first-preview.

- [ ] **Step 3: Verify command expansion and repository checks**

Run:

```bash
make -n infra-init
make -n infra-up IMAGE_TAG=$(git rev-parse --short HEAD)
make -n infra-down
git diff --check
make infra-validate
cd api && uv run python -m unittest tests.test_gpu_devices -v
```

Expected: all make targets expand, Terraform validates, tests pass, and the
working tree has no whitespace errors.

- [ ] **Step 4: Commit the operator workflow**

```bash
git add infra/README.md Makefile README.md
git commit -m "docs: add Foigoi GPU deployment workflow"
```

## Plan Self-Review

- Spec coverage: Tasks 1–4 cover separate GPU placement, immutable container
  runtime, Terraform lifecycle, DNS/TLS, cache-disk handling, security, and
  Jakarta performance validation.
- Scope: Autoscaling, Kubernetes, load balancing, and public SSH are excluded.
- Type consistency: `require_pipeline_devices()` returns the exact device tuple
  consumed by `pipelines.py`; Terraform outputs are consumed by the Makefile
  and operator guide.
- Placeholder scan: no deferred implementation markers are present.
