import unittest
import sys
from types import SimpleNamespace


class FakeCuda:
    def is_available(self):
        return True

    def device_count(self):
        return 2

    def get_device_name(self, index):
        return ["NVIDIA L4", "NVIDIA L4"][index]

    def memory_allocated(self, index):
        return [1024, 2048][index]


class FakeTorch:
    cuda = FakeCuda()


sys.modules["torch"] = SimpleNamespace(cuda=FakeTorch.cuda)

from utils.health import gpu_readiness


class GpuReadinessTest(unittest.TestCase):
    def test_reports_each_assigned_gpu(self):
        self.assertEqual(
            gpu_readiness(FakeTorch()),
            {
                "status": "ready",
                "cuda_available": True,
                "visible_device_count": 2,
                "pipelines": {
                    "text2img": {
                        "device": "cuda:0",
                        "name": "NVIDIA L4",
                        "memory_allocated_bytes": 1024,
                    },
                    "img2img": {
                        "device": "cuda:1",
                        "name": "NVIDIA L4",
                        "memory_allocated_bytes": 2048,
                    },
                },
            },
        )
