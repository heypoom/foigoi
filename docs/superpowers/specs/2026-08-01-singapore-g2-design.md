# Singapore G2 deployment design

## Goal

Provide repeatable creation and teardown of the `foigoi` inference API on GCP,
using one stable two-NVIDIA-L4 GPU instance. The public API hostname is
`foigoi-api.poom.dev`.

## Scope

- Provision the GCP infrastructure with Terraform.
- Build and run the API as a pinned CUDA container image.
- Serve the API over HTTPS and WebSockets through Caddy.
- Keep the text-to-image and image-to-image pipelines on separate GPUs.
- Provide one-command setup and teardown targets.

This design does not add autoscaling, a load balancer, a managed Kubernetes
cluster, or public SSH access.

## GCP environment

| Setting            | Value                         |
| ------------------ | ----------------------------- |
| Project            | `rui-an`                      |
| Region             | `asia-southeast1` (Singapore) |
| Zone               | `asia-southeast1-b`           |
| Machine type       | `g2-standard-24`              |
| GPUs               | Two NVIDIA L4 GPUs            |
| Provisioning model | Standard                      |
| Hostname           | `foigoi-api.poom.dev`         |

Jakarta does not currently offer G2, so the deployment uses Singapore. The
operator authenticates to GCP as `poom@poom.dev` with `gcloud auth login`; the
Make targets pass a short-lived access token to Terraform. Credentials are
never stored in this repository or Terraform state.

## Infrastructure layout

`infra/bootstrap` creates the GCS bucket used for Terraform state. It uses
local state only during this bootstrap operation. `infra/terraform` uses that
bucket as its remote state backend and creates:

- a static external IP address;
- a standard `g2-standard-24` VM;
- a `pd-ssd` model-cache disk mounted at `/var/lib/foigoi/models`;
- a dedicated VM service account with only logging and monitoring writer
  permissions;
- firewall rules that permit TCP 80 and 443 from the internet and deny public SSH;
- the Artifact Registry repository that stores the API image.

The VM uses an L4-compatible NVIDIA driver and container runtime. Its startup
script starts the application Compose stack only after the GPU runtime is ready.
Caddy terminates TLS for `foigoi-api.poom.dev` and proxies WebSockets to the API
container.

The DNS A record is configured by the operator to point at Terraform's static
IP output before Caddy can obtain a certificate.

## Application image and model cache

The API has a Dockerfile based on a pinned CUDA runtime image. It installs the
locked Python environment with `uv sync --frozen`, runs the API, and mounts the
model-cache disk read-write at the Hugging Face cache path.

Each `from_pretrained` call specifies an immutable model revision. This makes a
new VM reproduce the same model code and weights instead of following a mutable
model tag. The persistent cache reduces repeat startup time but is not required
for correctness.

## GPU placement

`api/utils/pipelines.py` defines separate device settings:

- `text2img` uses `cuda:0`.
- `img2img` uses `cuda:1`.

At startup, the module verifies that CUDA is available and that at least two
devices are visible. Otherwise startup fails with an error that reports the
detected device count. The service never silently falls back to loading both
pipelines on one GPU.

## Operator workflow

- `make infra-init` bootstraps remote Terraform state and initializes the main
  Terraform directory.
- `make infra-up` builds and pushes the versioned API image, then applies the
  Terraform configuration.
- The operator sets the DNS A record to the emitted static IP.
- `make infra-down` destroys the VM, static IP, firewall rules, and model-cache
  disk.

The Terraform state bucket and Artifact Registry repository remain after
`infra-down`, so later deployments use the same state and image history. They
are intentionally not runtime-cost drivers.

## Validation

Before declaring a deployment ready:

1. Terraform validates and plans successfully for `foigoi` and
   `asia-southeast1-b`.
2. The VM reports exactly two NVIDIA L4 GPUs through `nvidia-smi`.
3. API startup confirms `text2img=cuda:0` and `img2img=cuda:1`.
4. `https://foigoi-api.poom.dev` obtains a valid certificate and
   `wss://foigoi-api.poom.dev/ws` accepts a connection.
5. A Jakarta-network test records WebSocket RTT and prompt-to-first-preview
   timing.
