# Foigoi GPU deployment

This directory provisions the Foigoi API in GCP project `rui-an`, Singapore
(`asia-southeast1-b`). The VM is a standard `g2-standard-24` with two NVIDIA
L4 GPUs. It is intentionally not created until quota is available.

## Prerequisites

- Terraform 1.6 or newer, Docker, and the Google Cloud CLI.
- Authenticate as `poom@poom.dev` with `gcloud auth login` and select project
  `rui-an`. The Make targets pass a short-lived access token to Terraform; no
  credentials are stored in the repository or Terraform state.
- NVIDIA L4 regional quota of at least 2 in `asia-southeast1`.
- An A record for `foigoi-api.poom.dev` after `make infra-init` has created the
  static IP.

## Lifecycle

Initialize the remote state and create the non-GPU foundation:

```sh
make infra-init
terraform -chdir=infra/terraform output -raw static_ip
```

Point `foigoi-api.poom.dev` at that IP. After the DNS record resolves publicly
and the L4 quota is granted, build, push, and start the VM with an immutable
image tag:

```sh
make infra-up IMAGE_TAG=$(git rev-parse --short HEAD)
```

Tear down the billable runtime resources without deleting Terraform state,
Artifact Registry, the service account, or image history:

```sh
make infra-down
```

`infra-down` removes the G2 VM, 200 GB model-cache disk, static IP, and public
HTTP/HTTPS firewall rule. Run `make infra-up` again to recreate them.

## Post-deployment checks

From the VM console, confirm `nvidia-smi -L` reports exactly two NVIDIA L4
devices. Check the API startup logs for `text2img=cuda:0` and `img2img=cuda:1`.
Then verify HTTPS, `wss://foigoi-api.poom.dev/ws`, and Jakarta WebSocket RTT
and prompt-to-first-preview latency.
