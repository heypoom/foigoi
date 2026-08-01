import torch


TEXT2IMG_DEVICE = "cuda:0"
IMG2IMG_DEVICE = "cuda:1"


def require_pipeline_devices() -> tuple[str, str]:
    if not torch.cuda.is_available():
        raise RuntimeError("Foigoi requires CUDA, but CUDA is not available")

    device_count = torch.cuda.device_count()
    if device_count < 2:
        raise RuntimeError(
            f"Foigoi requires 2 CUDA devices, found {device_count}"
        )

    return TEXT2IMG_DEVICE, IMG2IMG_DEVICE
