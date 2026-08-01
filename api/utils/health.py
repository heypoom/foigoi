import torch

from utils.gpu_devices import IMG2IMG_DEVICE, TEXT2IMG_DEVICE


def gpu_readiness(torch_module=torch) -> dict:
    devices = {
        "text2img": {"device": TEXT2IMG_DEVICE, "name": None},
        "img2img": {"device": IMG2IMG_DEVICE, "name": None},
    }
    cuda_available = torch_module.cuda.is_available()
    visible_device_count = torch_module.cuda.device_count() if cuda_available else 0

    for index, pipeline in enumerate(devices.values()):
        if visible_device_count > index:
            pipeline["name"] = torch_module.cuda.get_device_name(index)
            pipeline["memory_allocated_bytes"] = torch_module.cuda.memory_allocated(
                index
            )

    return {
        "status": "ready" if visible_device_count >= 2 else "unready",
        "cuda_available": cuda_available,
        "visible_device_count": visible_device_count,
        "pipelines": devices,
    }
