import io
import json
import os
import random
import time
from pathlib import Path
from typing import Optional

import modal

APP_NAME = "exhibition-pregen-malaya"
SD15_MODEL_NAME = "runwayml/stable-diffusion-v1-5"
app = modal.App(APP_NAME)

SUPPORTED_PROGRAMS = ["P2", "P2B"]

# Default generation parameters
DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1080
DEFAULT_NUM_INFERENCE_STEPS = 40

# Static pregen version ID. Use in case of future changes to the generation.
# Example: different transcripts, model versions, or other significant changes.
PREGEN_VERSION_ID = 5

PREGEN_UPLOAD_STATUS_KEY = f"pregen/{PREGEN_VERSION_ID}/variant_upload_status"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "accelerate==0.33.0",
        "diffusers==0.31.0",
        "fastapi[standard]==0.115.4",
        "huggingface-hub[hf_transfer]==0.25.2",
        "sentencepiece==0.2.0",
        "torch==2.5.1",
        "torchvision==0.20.1",
        "transformers~=4.44.0",
        "peft",
        "numpy",
        "Pillow",
        "valkey[libvalkey]",
        "boto3"
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

with image.imports():
    import torch
    import PIL.Image as PILImage
    from diffusers.pipelines.stable_diffusion.pipeline_stable_diffusion_img2img import StableDiffusionImg2ImgPipeline
    from valkey import Valkey
    import boto3

SD15_CACHE_DIR = "/cache/sd15"
cache_vol = modal.Volume.from_name("hf-hub-cache", create_if_missing=True)

# R2 Configuration
R2_BUCKET_NAME = "poom-images"

# https://huggingface.co/docs/diffusers/en/using-diffusers/callback#display-image-after-each-generation-step
# https://huggingface.co/blog/TimothyAlexisVass/explaining-the-sdxl-latent-space
WEIGHTS = ((60, -60, 25, -70), (60, -5, 15, -50), (60, 10, -5, -35))

def latents_to_rgb(latents):
    weights_tensor = torch.t(
        torch.tensor(WEIGHTS, dtype=latents.dtype).to(latents.device)
    )
    biases_tensor = torch.tensor((150, 140, 130), dtype=latents.dtype).to(
        latents.device
    )
    weights_s = torch.einsum("...lxy,lr -> ...rxy", latents, weights_tensor)
    biases_s = biases_tensor.unsqueeze(-1).unsqueeze(-1)
    rgb_tensor = weights_s + biases_s
    image_array = rgb_tensor.clamp(0, 255)[0].byte().cpu().numpy()
    image_array = image_array.transpose(1, 2, 0)

    return PILImage.fromarray(image_array)

def upload_to_r2(file_data: bytes, key: str) -> bool:
    """
    Upload bytes to Cloudflare R2 bucket using the same configuration as upload.py
    
    Args:
        file_data: Binary data to upload
        key: Object key/path in the bucket
        
    Returns:
        bool: True if upload successful, False otherwise
    """
    
    # R2 credentials from environment variables
    account_id = os.getenv('CLOUDFLARE_ACCOUNT_ID')
    access_key = os.getenv('CLOUDFLARE_ACCESS_KEY_ID')
    secret_key = os.getenv('CLOUDFLARE_SECRET_ACCESS_KEY')
    
    if not all([account_id, access_key, secret_key]):
        print("Missing required environment variables:")
        print("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ACCESS_KEY_ID, CLOUDFLARE_SECRET_ACCESS_KEY")
        return False
    
    # R2 endpoint URL
    endpoint_url = f'https://{account_id}.r2.cloudflarestorage.com'
    
    # Create S3 client configured for R2
    s3_client = boto3.client(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name='auto'
    )
    
    try:
        # Upload the bytes
        s3_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=file_data,
            ContentType='image/png'
        )
        print(f"Successfully uploaded {len(file_data)} bytes to {R2_BUCKET_NAME}/{key}")
        return True
        
    except Exception as e:
        print(f"Upload failed: {e}")
        return False

def create_step_callback(program_key, cue_id, variant_id, step_timings):
    """Creates callback to capture intermediate steps for img2img pipeline"""
    def on_step_end(pipeline, step, timestep, callback_kwargs):
        # Record step timing
        current_time = time.time()
        step_timings[str(step)] = current_time
        
        # Extract latents
        latents = callback_kwargs["latents"]

        # Use latents_to_rgb for SD1.5 latent decoding (matches legacy system)
        preview_image = latents_to_rgb(latents)
        
        # Save intermediate image to R2
        with io.BytesIO() as buf:
            preview_image.convert("RGB").save(buf, format="PNG")
            image_bytes = buf.getvalue()
            
        step_key = f"foigoi/{PREGEN_VERSION_ID}/cues/{cue_id}/{variant_id}/{step}.png"
        upload_success = upload_to_r2(image_bytes, step_key)
        if upload_success:
            print(f"Uploaded intermediate step {step} to R2: {step_key}")
        else:
            print(f"Failed to upload intermediate step {step} to R2: {step_key}")

        return callback_kwargs
            
    return on_step_end


def save_timing_metadata(step_timings, start_time, final_time, cue_id, variant_id):
    """Generate and save timing.json with step durations"""
    durations = {}
    prev_time = start_time
    
    for step, timestamp in step_timings.items():
        durations[step] = int((timestamp - prev_time) * 1000)  # Convert to ms
        prev_time = timestamp
        
    # Add final processing time
    durations["final"] = int((final_time - prev_time) * 1000)
    
    metadata = {"stepDurations": durations}
    metadata_json = json.dumps(metadata)
    
    timing_key = f"foigoi/{PREGEN_VERSION_ID}/cues/{cue_id}/{variant_id}/timing.json"
    upload_success = upload_to_r2(metadata_json.encode(), timing_key)
    if upload_success:
        print(f"Uploaded timing metadata to R2: {timing_key}")
    else:
        print(f"Failed to upload timing metadata to R2: {timing_key}")

# Constants for image-to-image
POEM_OF_MALAYA_SIZE = (960, 800)
PROMPT_2 = "painting like an epic poem of malaya"
PROMPT_2B = "crowd of people in a public space"
GUIDANCE_SCALE_2B = 8.5


@app.cls(
    image=image,
    gpu="H100",
    volumes={
        SD15_CACHE_DIR: cache_vol,
        "/r2": modal.CloudBucketMount(
            bucket_name=R2_BUCKET_NAME,
            bucket_endpoint_url="https://160d4d33acd4258d2d67c59d7123a282.r2.cloudflarestorage.com",
            secret=modal.Secret.from_name("r2-secret", required_keys=["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]),
            read_only=True
        )
    },
    timeout=600,
    secrets=[
        modal.Secret.from_name("huggingface-secret"),
        modal.Secret.from_name("r2-secret"),
        modal.Secret.from_name("valkey-secret"),
    ],
    min_containers=0,
    max_containers=3,
)
class Inference:
    def __init__(self):
        self.malaya_image = None

    @modal.enter()
    def initialize(self):
        print("initializing pipeline...")

        self.pipe = StableDiffusionImg2ImgPipeline.from_pretrained(
            SD15_MODEL_NAME,
            cache_dir=SD15_CACHE_DIR,
            torch_dtype=torch.float16,
            token=os.environ["HF_TOKEN"]
        )
        
        self.vk = Valkey("raya.poom.dev", username="default", password=os.environ["VALKEY_PASSWORD"])
        
        print("pipeline initialized.")

        # Load and resize the Malaya image
        print("loading Malaya image...")
        malaya_path = Path("/r2/foigoi/malaya.png")
        if not malaya_path.exists():
            raise FileNotFoundError("malaya.png not found in r2 mount")
        self.malaya_image = (
            PILImage.open(malaya_path).resize(POEM_OF_MALAYA_SIZE).convert("RGB")
        )
        print("Malaya image loaded and resized.")

    @modal.enter()
    def move_to_gpu(self):
        if self.pipe:
            print("Moving pipeline to GPU...")
            self.pipe.to("cuda")
            print("Pipeline on GPU.")
        else:
            print("Pipeline not initialized, cannot move to GPU.")

    @modal.method()
    def run(
        self,
        prompt: str,
        program_key: str,
        cue_id: str,
        variant_id: int,
        seed: Optional[int] = None,
        strength: float = 0.75,
        guidance: Optional[float] = None,
        width: int = DEFAULT_WIDTH,
        height: int = DEFAULT_HEIGHT,
        num_inference_steps: int = DEFAULT_NUM_INFERENCE_STEPS,
    ) -> str:
        if not self.pipe:
            raise RuntimeError("Pipeline not initialized or moved to GPU.")
        if self.pipe.device.type != "cuda":
            raise RuntimeError("Pipeline not on CUDA device.")
        if not self.malaya_image:
            raise RuntimeError("Malaya image not loaded.")

        # Process prompt and guidance based on program key to match p2.py exactly
        if program_key == "P2":
            # P2 uses PROMPT_2 directly
            processed_prompt = PROMPT_2
            final_guidance_scale = guidance  # Use provided guidance or None (pipeline default)
        elif program_key == "P2B":
            # P2B uses PROMPT_2B with guidance_scale=8.5
            processed_prompt = PROMPT_2B
            final_guidance_scale = GUIDANCE_SCALE_2B  # Always use 8.5 for P2B
        else:
            processed_prompt = prompt
            final_guidance_scale = guidance

        seed = seed if seed is not None else random.randint(0, 2**32 - 1)
        print(f"running inference for program {program_key}: '{processed_prompt}' with seed {seed}, final_guidance: {final_guidance_scale}")
        generator = torch.Generator("cuda").manual_seed(seed)

        start_time = time.time()
        step_timings = {}

        # Run the pipeline with step callback
        print(f"Running img2img inference with intermediate steps for {program_key}")
        callback_fn = create_step_callback(program_key, cue_id, variant_id, step_timings)

        # Build pipeline arguments
        pipeline_args = {
            "prompt": processed_prompt,
            "image": self.malaya_image,
            "strength": strength,
            "num_inference_steps": num_inference_steps,
            "generator": generator,
            "callback_on_step_end": callback_fn,
            "width": width,
            "height": height,
        }
        
        # Only add guidance_scale if we have a value (SD3 has default)
        if final_guidance_scale is not None:
            pipeline_args["guidance_scale"] = final_guidance_scale

        images = self.pipe(**pipeline_args).images
        
        final_time = time.time()
        print("inference complete!")
        print(f"Time taken for inference: {final_time - start_time:.2f} seconds")

        # Convert final image to bytes
        image = images[0]
        with io.BytesIO() as buf:
            image.save(buf, format="PNG")
            image_bytes = buf.getvalue()

        print(f"Generated image for program {program_key}. Size: {len(image_bytes)} bytes.")

        # Save the final image
        r2_key = f"foigoi/{PREGEN_VERSION_ID}/cues/{cue_id}/{variant_id}/final.png"
        
        upload_success = upload_to_r2(image_bytes, r2_key)
        if upload_success:
            print(f"Image uploaded to R2: {r2_key}")
        else:
            print(f"Failed to upload image to R2: {r2_key}")
        
        # Save timing metadata
        if step_timings:
            save_timing_metadata(step_timings, start_time, final_time, cue_id, variant_id)
        
        # Mark whether the upload was successful in Valkey
        status_flag = "1" if upload_success else "0"
        self.vk.hset(PREGEN_UPLOAD_STATUS_KEY, f"{cue_id}_{variant_id}", status_flag)

        return r2_key


@app.function(
    timeout=650,
    min_containers=0,
    max_containers=3,
)
@modal.asgi_app()
def endpoint():
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel

    web_app = FastAPI()
    inference = Inference()

    class GenerateRequest(BaseModel):
        program_key: str
        prompt: str
        cue_id: str
        variant_id: int
        seed: Optional[int] = None
        strength: float = 0.75
        guidance: Optional[float] = None
        width: int = DEFAULT_WIDTH
        height: int = DEFAULT_HEIGHT
        num_inference_steps: int = DEFAULT_NUM_INFERENCE_STEPS

    @web_app.get("/")
    async def get():
        return {
            "status": "ok",
            "service": "exhibition-pregen-malaya",
            "pregenVersion": PREGEN_VERSION_ID,
            "model": SD15_MODEL_NAME,
            "timestamp": int(time.time()),
            "supportedPrograms": SUPPORTED_PROGRAMS,
            "baseImage": "Epic Poem of Malaya"
        }

    @web_app.post("/generate")
    async def generate_image(request: GenerateRequest):
        if request.program_key not in SUPPORTED_PROGRAMS:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported program key: {request.program_key}. Supported: {SUPPORTED_PROGRAMS}"
            )
        
        if not request.cue_id:
            raise HTTPException(
                status_code=400, 
                detail="cue_id is required for saving the image"
            )

        try:
            r2_key = inference.run.remote(
                prompt=request.prompt,
                program_key=request.program_key,
                cue_id=request.cue_id,
                variant_id=request.variant_id,
                seed=request.seed,
                strength=request.strength,
                guidance=request.guidance,
                width=request.width,
                height=request.height,
                num_inference_steps=request.num_inference_steps,
            )

            return {
                "status": "done",
                "r2_key": r2_key
            }

        except Exception as e:
            print(f"Error during inference: {e}")
            raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")

    return web_app