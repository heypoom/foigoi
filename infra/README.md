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

The public readiness endpoint reports the visible CUDA devices and the assigned
pipeline devices without generating an image:

```sh
curl --fail https://foigoi-api.poom.dev/healthz
```

Run the explicit GPU smoke check only when the service is idle. It reaches the
already-running API process through IAP and performs one 512x512, one-step
image generation through each resident pipeline. The smoke endpoint is not
available through the public proxy:

```sh
make infra-smoke
```

## October 2026 Kyoto performance schedule

The one-off Google Cloud Workflow starts the VM 15 minutes before and stops it
15 minutes after each artist-provided window in `Asia/Tokyo`. There is no recurring trigger.

| Date | Start (Tokyo) | Stop (Tokyo) |
| --- | --- | --- |
| October 8 | 17:45 | 22:15 |
| October 9 | 11:45 | October 10 00:14 |
| October 10 | 14:45 | October 11 00:14 |
| October 11 | 14:45 | October 12 00:14 |

Run `make infra-up IMAGE_TAG=<immutable-tag>` to deploy, update the DNS A record
with the emitted static IP, then run `make infra-schedule` exactly once.
The schedule target refuses to create another execution while one is active.
The VM runs immediately after provisioning so readiness can be verified before the show.
Terraform uploads the local Chua Mia Tee LoRA from `../local_lora/` into a private
GCS model-assets bucket. The startup script copies it onto the persistent model-cache
disk before starting the API. Override `TF_VAR_chuamiatee_lora_path` if the file is elsewhere.

The Terraform state bucket and GPU runtime use Singapore.
Make targets pass REGION and ZONE to Terraform as well as gcloud.

The GPU runtime currently uses Singapore because Tokyo's specific NVIDIA L4
quota increase was denied. The API image repository remains in Tokyo;
`ARTIFACT_REGION=asia-northeast1` is independent of the runtime `REGION` and `ZONE`.

## Venue network diagnostic

Open `https://foigoi-api.poom.dev/network-test` on the show device and connection.
Run the test with the tab visible, then copy the diagnostic. It records 20 warmed
HTTPS and WebSocket application round trips, median/p95 timing, failures, raw
samples, browser details, and optional location/connection notes. The probes
invoke no image generation. The page is available while the scheduled VM is on.
