import torch
from utils.chuamiatee_size import get_chuamiatee_size
from utils.pipeline_manager import denoise
from utils.pipelines import text2img


# Program 3 pipeline: chua mia tee painting
async def infer_program_3(prompt: str, strength: float, conn_id=None):
    width, height = get_chuamiatee_size()
    prompt = f"{prompt}, chua mia tee painting"

    def pipeline(on_step_end):
        with torch.inference_mode():
            return text2img(
                prompt=prompt,
                strength=strength,
                num_inference_steps=40,
                callback_on_step_end=on_step_end,
                callback_on_step_end_tensor_inputs=["latents"],
                width=width,
                height=height,
            )

    async for out in denoise(pipeline, is_chuamiatee=True, conn_id=conn_id):
        yield out
