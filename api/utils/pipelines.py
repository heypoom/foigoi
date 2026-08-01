import time

import torch

from diffusers import StableDiffusionImg2ImgPipeline, AutoPipelineForText2Image
from utils.gpu_devices import require_pipeline_devices


SDXL_REVISION = "e4e60c65aa20ee60092c60ba197f541872cf9373"
SD15_REVISION = "451f4fe16113bff5a5d2269ed5ad43b0592e9a14"

start_time = time.time()
text2img_device, img2img_device = require_pipeline_devices()
print(
    "loading diffusion pipelines on "
    f"{text2img_device} ({torch.cuda.get_device_name(0)}) and "
    f"{img2img_device} ({torch.cuda.get_device_name(1)})"
)

text2img = AutoPipelineForText2Image.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    revision=SDXL_REVISION,
    torch_dtype=torch.float16,
).to(text2img_device)

text2img.enable_xformers_memory_efficient_attention()

# Program 2 pipeline: Epic Poem of Malaya, Image to Image
img2img = StableDiffusionImg2ImgPipeline.from_pretrained(
    "runwayml/stable-diffusion-v1-5",
    revision=SD15_REVISION,
).to(img2img_device)

img2img.enable_xformers_memory_efficient_attention()

print(f"two diffusion pipelines ready in {time.time() - start_time}s")
