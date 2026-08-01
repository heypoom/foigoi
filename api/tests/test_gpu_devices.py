import unittest
from unittest.mock import patch

from utils.gpu_devices import require_pipeline_devices


class PipelineDeviceTest(unittest.TestCase):
    @patch("utils.gpu_devices.torch.cuda.is_available", return_value=False)
    def test_requires_cuda(self, _is_available):
        with self.assertRaisesRegex(RuntimeError, "CUDA is not available"):
            require_pipeline_devices()

    @patch("utils.gpu_devices.torch.cuda.device_count", return_value=1)
    @patch("utils.gpu_devices.torch.cuda.is_available", return_value=True)
    def test_requires_two_visible_gpus(self, _is_available, _device_count):
        with self.assertRaisesRegex(
            RuntimeError, "requires 2 CUDA devices, found 1"
        ):
            require_pipeline_devices()

    @patch("utils.gpu_devices.torch.cuda.device_count", return_value=2)
    @patch("utils.gpu_devices.torch.cuda.is_available", return_value=True)
    def test_assigns_one_device_per_pipeline(self, _is_available, _device_count):
        self.assertEqual(
            require_pipeline_devices(), ("cuda:0", "cuda:1")
        )
