import hashlib
from functools import lru_cache
from pathlib import Path

from utils.pipelines import text2img


LORA_DIRECTORY = Path("/var/lib/foigoi/models/chuamiatee-1")
LORA_WEIGHT_NAME = "pytorch_lora_weights.safetensors"
LORA_ADAPTER_NAME = "chuamiatee"

lora_applied = False


def load_chuamiatee_lora():
    global lora_applied

    if lora_applied:
        return

    print("loading LoRA weight")

    text2img.load_lora_weights(
        str(LORA_DIRECTORY),
        weight_name=LORA_WEIGHT_NAME,
        adapter_name=LORA_ADAPTER_NAME,
    )

    lora_applied = True
    print(f"LoRA loaded: {LORA_ADAPTER_NAME}")


def unload_chuamiatee_lora():
    global lora_applied

    if not lora_applied:
        return

    print("unloading LoRA weight")

    text2img.unload_lora_weights()
    lora_applied = False


def init_chuamiatee(is_chuamiatee: bool):
    if is_chuamiatee:
        load_chuamiatee_lora()
    else:
        unload_chuamiatee_lora()


@lru_cache(maxsize=1)
def weight_checksum(path: Path, modified_ns: int, size: int) -> str:
    # Include file metadata in the cache key so a replaced weight is rechecked.
    with path.open("rb") as weight:
        return hashlib.file_digest(weight, "sha256").hexdigest()


def chuamiatee_readiness() -> dict:
    weight_path = LORA_DIRECTORY / LORA_WEIGHT_NAME
    file_status = {"exists": weight_path.is_file(), "sha256": None}
    if file_status["exists"]:
        stat = weight_path.stat()
        file_status["sha256"] = weight_checksum(
            weight_path, stat.st_mtime_ns, stat.st_size
        )

    loaded_adapters = text2img.get_list_adapters()
    active_adapters = text2img.get_active_adapters()
    layer_count = 0
    enabled_layer_count = 0
    scales = []

    for component_name in loaded_adapters:
        component = getattr(text2img, component_name)
        for layer in component.modules():
            if LORA_ADAPTER_NAME not in getattr(layer, "lora_A", {}):
                continue

            layer_count += 1
            scale = float(layer.scaling[LORA_ADAPTER_NAME])
            scales.append(scale)
            if (
                not layer.disable_adapters
                and LORA_ADAPTER_NAME in layer.active_adapters
                and scale != 0
            ):
                enabled_layer_count += 1

    applied = (
        LORA_ADAPTER_NAME in active_adapters
        and layer_count > 0
        and enabled_layer_count == layer_count
    )
    consistent = (
        applied
        if lora_applied
        else layer_count == 0 and LORA_ADAPTER_NAME not in active_adapters
    )

    return {
        "name": "chuamiatee-1",
        "programs": ["P3", "P3B"],
        "applied": applied,
        "expected_active": lora_applied,
        "consistent": consistent,
        "status": "mismatch" if not consistent else "active" if applied else "inactive",
        "weight_file": file_status,
        "loaded_adapters": loaded_adapters,
        "active_adapters": active_adapters,
        "layer_count": layer_count,
        "enabled_layer_count": enabled_layer_count,
        "scale_range": [min(scales), max(scales)] if scales else None,
    }
