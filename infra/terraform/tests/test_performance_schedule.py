"""Exercise workflow recovery in Google Cloud without calling the show VM.

Run with: python3 infra/terraform/tests/test_performance_schedule.py
Requires gcloud authentication and permission to manage workflows in rui-an.
"""

import json
from pathlib import Path
import subprocess
import uuid


TEMPLATE = Path(__file__).resolve().parents[1] / "templates/performance-schedule.yaml.tftpl"
WORKFLOW = "foigoi-recovery-test-" + uuid.uuid4().hex[:8]
FLAGS = ["--project=rui-an", "--location=asia-southeast1"]
SERVICE_ACCOUNT = "foigoi-performance-scheduler@rui-an.iam.gserviceaccount.com"


def gcloud(*args):
    try:
        result = subprocess.run(
            ["gcloud", *args, *FLAGS], check=True, capture_output=True, text=True
        )
    except subprocess.CalledProcessError as error:
        print(error.stderr, flush=True)
        raise
    return result.stdout


def fixture_source(case):
    source = TEMPLATE.read_text().replace("$${", "${")
    source = source.replace("${project_id}", "rui-an")
    source = source.replace("${zone}", "asia-southeast1-b")
    source = source.replace("${instance_name}", "foigoi-api")

    source = source.replace("googleapis.compute.v1.instances.start", "fake_start")
    source = source.replace("googleapis.compute.v1.instances.stop", "fake_stop")
    source = source.replace("call: sys.log", "call: fake_log")
    source = source.replace("initial_delay: 10", "initial_delay: 0.1")
    source = source.replace("max_delay: 60", "max_delay: 0.1")

    if case == "exhausted_stop":
        # No waiting: all four sessions are eligible, and every stop fails.
        source = source.replace("2026-10-", "2099-10-")
        source = source.replace("call: sys.sleep_until", "call: fake_sleep_until")
        start_steps = "    - started:\n        return: true\n"
        stop_steps = '''    - fail_stop:
        raise:
          tags: [OperationError]
          message: "simulated exhausted stop"
'''
    else:
        begin = source.index("          in:\n")
        end = source.index("          steps:\n", begin)
        source = source[:begin] + '''          in:
            - start: ${time.format(sys.now() - 1)}
              stop: ${time.format(sys.now() + 1)}
''' + source[end:]
        # The start fails after its deadline; logging also fails. Recovery
        # must still reach the deadline check and stop the simulated VM.
        start_steps = '''    - cross_deadline:
        call: sys.sleep
        args:
          seconds: 2
    - fail_start:
        raise:
          tags: [OperationError]
          message: "simulated capacity failure"
'''
        stop_steps = "    - stopped:\n        return: true\n"

    source += "\nfake_start:\n  params: [project, zone, instance]\n  steps:\n" + start_steps
    source += "\nfake_stop:\n  params: [project, zone, instance]\n  steps:\n" + stop_steps
    source += '''
fake_log:
  params: [data, severity, timeout]
  steps:
    - fail_log:
        raise:
          tags: [TimeoutError]
          message: "simulated logging timeout"

fake_sleep_until:
  params: [time]
  steps:
    - no_wait:
        return: true
'''
    assert "call: googleapis.compute" not in source
    assert "call: sys.log" not in source
    return source


def main():
    fixture = Path("/private/tmp") / (WORKFLOW + ".yaml")
    try:
        for case in ["exhausted_stop", "failed_start_and_logging"]:
            fixture.write_text(fixture_source(case))
            gcloud(
                "workflows", "deploy", WORKFLOW,
                "--source=" + str(fixture),
                "--service-account=" + SERVICE_ACCOUNT, "--quiet",
            )
            execution = json.loads(gcloud("workflows", "run", WORKFLOW, "--format=json"))
            assert execution["state"] == "SUCCEEDED", execution
            result = json.loads(execution["result"])
            if case == "exhausted_stop":
                assert result["status"] == "completed_with_errors", result
                failures = result["failed_windows"]
                assert len(failures) == 4, result
                assert [item["start"] for item in failures] == [
                    "2099-10-08T08:00:00Z", "2099-10-09T02:00:00Z",
                    "2099-10-10T05:00:00Z", "2099-10-11T05:00:00Z",
                ], result
                assert all(
                    item["error"]["message"] == "simulated exhausted stop"
                    for item in failures
                ), result
            else:
                assert result == {"status": "completed", "failed_windows": []}, result
            print("PASS:", case, flush=True)
    finally:
        try:
            gcloud("workflows", "delete", WORKFLOW, "--quiet")
        except subprocess.CalledProcessError as error:
            if "NOT_FOUND" not in error.stderr:
                raise
        finally:
            fixture.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
