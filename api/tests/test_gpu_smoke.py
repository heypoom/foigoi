import unittest

from scripts.gpu_smoke import run_gpu_smoke


class FakeImage:
    width = 512
    height = 512


class FakeResult:
    images = [FakeImage()]


class FakePipeline:
    def __init__(self):
        self.calls = []
        self.result = FakeResult()

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return self.result


class GpuSmokeTest(unittest.TestCase):
    def test_runs_one_step_on_each_pipeline(self):
        text2img = FakePipeline()
        img2img = FakePipeline()

        result = run_gpu_smoke(text2img, img2img)

        self.assertEqual(
            result,
            {
                "status": "passed",
                "text2img_size": [512, 512],
                "img2img_size": [512, 512],
            },
        )
        self.assertEqual(text2img.calls[0]["num_inference_steps"], 1)
        self.assertEqual(img2img.calls[0]["num_inference_steps"], 1)
        self.assertEqual(img2img.calls[0]["strength"], 1)
        self.assertIs(img2img.calls[0]["image"], text2img.result.images[0])
