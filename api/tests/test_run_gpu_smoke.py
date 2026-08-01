import unittest
from unittest.mock import patch

from scripts.run_gpu_smoke import run


class RunGpuSmokeTest(unittest.TestCase):
    @patch("scripts.run_gpu_smoke.urllib.request.urlopen")
    def test_posts_to_the_resident_api_process(self, urlopen):
        urlopen.return_value.__enter__.return_value.read.return_value = b'{"status":"passed"}'

        self.assertEqual(run(), {"status": "passed"})

        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "http://localhost:8000/healthz/smoke")
        self.assertEqual(request.get_method(), "POST")
