import asyncio
import importlib
import sys
import unittest
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock


class Program3Test(unittest.TestCase):
    def test_appends_chua_mia_tee_style_to_the_prompt(self):
        text2img = Mock(return_value=SimpleNamespace(images=["image"]))

        async def denoise(run, **_kwargs):
            run(None)
            yield "image"

        stubs = {
            "torch": SimpleNamespace(inference_mode=nullcontext),
            "utils.chuamiatee_size": SimpleNamespace(
                get_chuamiatee_size=lambda: (960, 800)
            ),
            "utils.pipeline_manager": SimpleNamespace(denoise=denoise),
            "utils.pipelines": SimpleNamespace(text2img=text2img),
        }
        previous_modules = {name: sys.modules.get(name) for name in stubs}
        sys.modules.update(stubs)
        sys.modules.pop("programs.p3", None)

        try:
            program_3 = importlib.import_module("programs.p3")

            async def collect():
                return [output async for output in program_3.infer_program_3("audience prompt", 5.5)]

            self.assertEqual(asyncio.run(collect()), ["image"])
        finally:
            sys.modules.pop("programs.p3", None)
            for name, previous_module in previous_modules.items():
                if previous_module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = previous_module

        self.assertEqual(
            text2img.call_args.kwargs["prompt"],
            "audience prompt, chua mia tee painting",
        )
