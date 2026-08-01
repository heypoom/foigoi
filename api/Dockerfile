FROM --platform=linux/amd64 ghcr.io/astral-sh/uv:0.5.24 AS uv

FROM --platform=linux/amd64 nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04@sha256:810756cab1c28ce693499a5c2ebb66f6d10a61d026998c8606bad449643a4c49

COPY --from=uv /uv /uvx /bin/

WORKDIR /app

ENV UV_PYTHON=3.11 \
    HF_HOME=/var/lib/foigoi/models

RUN uv python install 3.11

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .
RUN uv run python -c "import torch, xformers; print(f'torch={torch.__version__} xformers={xformers.__version__}')"

CMD ["uv", "run", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
