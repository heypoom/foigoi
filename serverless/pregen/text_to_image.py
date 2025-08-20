import io
import json
import os
import random
import time
from typing import Optional

import modal

APP_NAME = "exhibition-pregen-text-to-image"
SDXL_MODEL_NAME = "stabilityai/stable-diffusion-xl-base-1.0"
app = modal.App(APP_NAME)

SUPPORTED_PROGRAMS = ["P0", "P3", "P3B", "P4"]
CHUAMIATEE_PROGRAMS = ["P3", "P3B"]
SD3_TURBO_CACHE_DIR = "/cache/sd3-turbo"

SD3_TURBO_MODEL_NAME = "stabilityai/stable-diffusion-3.5-large-turbo"

# Default generation parameters
DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1072
DEFAULT_GUIDANCE_SCALE = 0.0
DEFAULT_NUM_INFERENCE_STEPS = 10

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
    from diffusers.pipelines.stable_diffusion_3.pipeline_stable_diffusion_3 import StableDiffusion3Pipeline
    from valkey import Valkey
    import boto3

SDXL_CACHE_DIR = "/cache/sdxl"
cache_vol = modal.Volume.from_name("hf-hub-cache", create_if_missing=True)

# Constants for LORA (SDXL-compatible)
LORA_WEIGHTS = "heypoom/chuamiatee-1"
LORA_WEIGHT_NAME = "pytorch_lora_weights.safetensors"

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

def create_step_callback(program_key, cue_id, variant_id, step_timings, vae_decoder):
    """Creates callback to capture intermediate steps"""
    def on_step_end(pipeline, step, timestep, callback_kwargs):
        # Only capture for P1-P4, skip P0
        if program_key == "P0":
            return callback_kwargs
        
        # Record step timing
        current_time = time.time()
        step_timings[str(step)] = current_time
        
        # Extract latents
        latents = callback_kwargs["latents"]

        # More robust approach using the VAE decoder directly
        latents = 1 / vae_decoder.config.scaling_factor * latents
        image = vae_decoder.decode(latents).sample
        image = (image / 2 + 0.5).clamp(0, 1) # Normalize to [0, 1]
        image = image.cpu().permute(0, 2, 3, 1).float().numpy() # Convert to (batch, H, W, C) numpy array
        preview_image = PILImage.fromarray((image[0] * 255).astype("uint8")) # Take first image from batch
        
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


@app.cls(
    image=image,
    gpu="H100",
    volumes={SDXL_CACHE_DIR: cache_vol},
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
    lora_loaded: bool = modal.parameter(default=False, init=False)

    @modal.enter()
    def initialize(self):
        print("initializing pipeline...")

        self.pipe = StableDiffusion3Pipeline.from_pretrained(

            SD3_TURBO_MODEL_NAME,
            cache_dir=SD3_TURBO_CACHE_DIR,

            torch_dtype=torch.bfloat16,

            token=os.environ["HF_TOKEN"]

        )

        self.vk = Valkey("raya.poom.dev", username="default", password=os.environ["VALKEY_PASSWORD"])

        print("pipeline initialized.")

    @modal.enter()
    def move_to_gpu(self):
        if self.pipe:
            print("Moving pipeline to GPU...")
            self.pipe.to("cuda")
            print("Pipeline on GPU.")
        else:
            print("Pipeline not initialized, cannot move to GPU.")

    def _ensure_lora_state(self, use_lora: bool):
        if use_lora and not self.lora_loaded:
            print("Loading LORA weights...")
            self.pipe.load_lora_weights(LORA_WEIGHTS, weight_name=LORA_WEIGHT_NAME, token=os.environ["HF_TOKEN"])
            self.lora_loaded = True
        elif not use_lora and self.lora_loaded:
            print("Unloading LORA weights...")
            self.pipe.unload_lora_weights()
            self.lora_loaded = False

    @modal.method()
    def run(
        self,
        prompt: str,
        program_key: str,
        cue_id: str,
        variant_id: int,
        seed: Optional[int] = None,
        width: int = DEFAULT_WIDTH,
        height: int = DEFAULT_HEIGHT,
        guidance_scale: float = DEFAULT_GUIDANCE_SCALE,
        num_inference_steps: int = DEFAULT_NUM_INFERENCE_STEPS,
    ) -> str:
        if not self.pipe:
            raise RuntimeError("Pipeline not initialized or moved to GPU.")
        if self.pipe.device.type != "cuda":
            raise RuntimeError("Pipeline not on CUDA device.")

        # Determine if we should use LoRA based on program key
        use_lora = program_key in CHUAMIATEE_PROGRAMS
        
        # Ensure LORA is in the correct state
        self._ensure_lora_state(use_lora)

        # Modify prompt based on program key to match legacy system
        if program_key == "P0":
            modified_prompt = prompt
        elif program_key == "P3B":
            modified_prompt = prompt
        elif program_key == "P4":
            if prompt.strip() in ["data researcher", "crowdworker", "big tech ceo"]:
                modified_prompt = prompt
            else:
                modified_prompt = prompt
        else:
            modified_prompt = prompt

        seed = seed if seed is not None else random.randint(0, 2**32 - 1)
        print(f"running inference for program {program_key}: '{modified_prompt}' with seed {seed}")
        # generator = torch.Generator("cuda").manual_seed(seed)

        start_time = time.time()
        step_timings = {}

        # Run the pipeline with callback for P1-P4, without callback for P0
        if program_key != "P0":
            print(f"Running inference with intermediate steps for {program_key}")
            callback_fn = create_step_callback(program_key, cue_id, variant_id, step_timings, self.pipe.vae)

            print(f"callback param. prompt='{prompt}', g=7.0, steps={num_inference_steps}, w={width}, h={height}")

            images = self.pipe(
                prompt=prompt,
                num_images_per_prompt=1,
                num_inference_steps=num_inference_steps,
                guidance_scale=7.0,
                width=width,
                height=height,
                callback_on_step_end=callback_fn,
            ).images
        else:
            print(f"Running inference without intermediate steps for {program_key}")
            images = self.pipe(
                prompt=modified_prompt,
                num_images_per_prompt=1,
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale,
                generator=generator,
                width=width,
                height=height,
            ).images
        
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
        
        # Save timing metadata for P1-P4 programs
        if program_key != "P0" and step_timings:
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
    from fastapi.responses import Response
    from pydantic import BaseModel

    web_app = FastAPI()
    inference = Inference()

    class GenerateRequest(BaseModel):
        program_key: str
        prompt: str
        cue_id: str
        variant_id: int
        seed: Optional[int] = None
        width: int = DEFAULT_WIDTH
        height: int = DEFAULT_HEIGHT
        guidance_scale: float = DEFAULT_GUIDANCE_SCALE
        num_inference_steps: int = DEFAULT_NUM_INFERENCE_STEPS

    @web_app.get("/")
    async def get():
        return {
            "status": "ok",
            "service": "exhibition-pregen-text-to-image",
            "pregenVersion": PREGEN_VERSION_ID,
            "model": SDXL_MODEL_NAME,
            "timestamp": int(time.time()),
            "supportedPrograms": SUPPORTED_PROGRAMS,
        }

    @web_app.post("/generate")
    async def generate_image(request: GenerateRequest):
        if request.program_key not in SUPPORTED_PROGRAMS:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported program key: {request.program_key}. Supported: P0, P3, P3B, P4"
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
                seed=request.seed,
                variant_id=request.variant_id,
                width=request.width,
                height=request.height,
                guidance_scale=request.guidance_scale,
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