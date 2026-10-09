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
            adapter_name="chuamiatee",
        )


class ChuaMiaTeeReadinessTest(unittest.TestCase):
    def setUp(self):
        self.layer = SimpleNamespace(
            lora_A={"chuamiatee": object()},
            active_adapters=["chuamiatee"],
            disable_adapters=False,
            scaling={"chuamiatee": 1.0},
        )
        self.pipeline = SimpleNamespace(
            get_list_adapters=Mock(return_value={"unet": ["chuamiatee"]}),
            get_active_adapters=Mock(return_value=["chuamiatee"]),
            unet=SimpleNamespace(modules=lambda: [self.layer]),
        )
        previous_modules = {
            name: sys.modules.get(name) for name in ["utils.pipelines", "utils.lora"]
        }
        sys.modules["utils.pipelines"] = SimpleNamespace(text2img=self.pipeline)
        sys.modules.pop("utils.lora", None)
        self.lora = importlib.import_module("utils.lora")
        self.lora.lora_applied = True

        def restore_modules():
            for name, previous_module in previous_modules.items():
                if previous_module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = previous_module

        self.addCleanup(restore_modules)

    def test_confirms_enabled_adapter_layers(self):
        status = self.lora.chuamiatee_readiness()

        self.assertTrue(status["applied"])
        self.assertTrue(status["consistent"])
        self.assertEqual(status["status"], "active")
        self.assertEqual(status["layer_count"], 1)
        self.assertEqual(status["enabled_layer_count"], 1)
        self.assertEqual(status["scale_range"], [1.0, 1.0])

    def test_does_not_trust_the_loaded_flag_when_layers_are_disabled(self):
        self.layer.disable_adapters = True

        status = self.lora.chuamiatee_readiness()

        self.assertFalse(status["applied"])
        self.assertFalse(status["consistent"])
        self.assertEqual(status["status"], "mismatch")

    def test_zero_scale_is_not_applied(self):
        self.layer.scaling["chuamiatee"] = 0

        status = self.lora.chuamiatee_readiness()

        self.assertFalse(status["applied"])
        self.assertEqual(status["enabled_layer_count"], 0)
        self.assertEqual(status["status"], "mismatch")

    def test_other_programs_can_have_no_adapter(self):
        self.lora.lora_applied = False
        self.pipeline.get_list_adapters.return_value = {}
        self.pipeline.get_active_adapters.return_value = []

        status = self.lora.chuamiatee_readiness()

        self.assertFalse(status["applied"])
        self.assertTrue(status["consistent"])
        self.assertEqual(status["status"], "inactive")

    def test_detects_an_adapter_left_loaded_after_unloading(self):
        self.lora.lora_applied = False

        status = self.lora.chuamiatee_readiness()

        self.assertTrue(status["applied"])
        self.assertEqual(status["status"], "mismatch")

    def test_checksum_changes_when_weight_is_replaced(self):
        import hashlib
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            self.lora.LORA_DIRECTORY = Path(directory)
            weight = Path(directory) / self.lora.LORA_WEIGHT_NAME
            weight.write_bytes(b"first weight")
            first = self.lora.chuamiatee_readiness()["weight_file"]
            weight.write_bytes(b"replacement weight")
            second = self.lora.chuamiatee_readiness()["weight_file"]

        self.assertTrue(first["exists"])
        self.assertEqual(first["sha256"], hashlib.sha256(b"first weight").hexdigest())
        self.assertEqual(
            second["sha256"], hashlib.sha256(b"replacement weight").hexdigest()
        )
