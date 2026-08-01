import json
import urllib.request


SMOKE_URL = "http://localhost:8000/healthz/smoke"


def run() -> dict:
    request = urllib.request.Request(SMOKE_URL, method="POST")
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


if __name__ == "__main__":
    print(json.dumps(run()))
