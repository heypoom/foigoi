import json


SMOKE_PROMPT = "A single red square on a white background"


def run_gpu_smoke(text2img, img2img) -> dict:
    text2img_result = text2img(
        prompt=SMOKE_PROMPT,
        num_inference_steps=1,
        guidance_scale=0,
        width=512,
        height=512,
    )
    text2img_image = text2img_result.images[0]

    img2img_result = img2img(
        prompt=SMOKE_PROMPT,
        image=text2img_image,
        strength=0.5,
        num_inference_steps=1,
        guidance_scale=0,
    )
    img2img_image = img2img_result.images[0]

    return {
        "status": "passed",
        "text2img_size": [text2img_image.width, text2img_image.height],
        "img2img_size": [img2img_image.width, img2img_image.height],
    }


def main():
    from utils.pipelines import img2img, text2img

    print(json.dumps(run_gpu_smoke(text2img, img2img)))


if __name__ == "__main__":
    main()
