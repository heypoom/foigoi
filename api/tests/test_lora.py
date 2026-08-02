import importlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock


class ChuaMiaTeeLoraTest(unittest.TestCase):
    def test_loads_the_pre_staged_weight_without_hugging_face(self):
        text2img = SimpleNamespace(load_lora_weights=Mock())
        previous_pipelines = sys.modules.get("utils.pipelines")
        sys.modules["utils.pipelines"] = SimpleNamespace(text2img=text2img)
        sys.modules.pop("utils.lora", None)

        try:
            lora = importlib.import_module("utils.lora")
            lora.load_chuamiatee_lora()
        finally:
            sys.modules.pop("utils.lora", None)
            if previous_pipelines is None:
                sys.modules.pop("utils.pipelines", None)
            else:
                sys.modules["utils.pipelines"] = previous_pipelines

        text2img.load_lora_weights.assert_called_once_with(
            "/var/lib/foigoi/models/chuamiatee-1",
            weight_name="pytorch_lora_weights.safetensors",
        )
