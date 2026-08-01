from __future__ import annotations

import starlette.websockets

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

print("starting server")

from programs.p0 import infer_program_0, infer_program_4
from programs.p2 import infer_program_2, infer_program_2_b
from programs.p3 import infer_program_3
from utils.ws import create_send, strip
from utils.connection_state import handle_socket_connect, handle_socket_disconnect
from utils.health import gpu_readiness
from utils.pipelines import img2img, text2img
from scripts.gpu_smoke import run_gpu_smoke

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz():
    return gpu_readiness()


@app.post("/healthz/smoke")
def healthz_smoke():
    return run_gpu_smoke(text2img, img2img)


@app.websocket("/ws")
async def websocket_endpoint(sock: WebSocket):
    await sock.accept()

    conn_id = handle_socket_connect(sock)

    # this is blocking!
    # pipelines cannot be interrupted at the moment, aside from disconnection
    send = create_send(sock)

    while True:
        try:
            command = await sock.receive_text()
            command = command.strip()

            if command.startswith("P0:"):
                prompt = strip(command, "P0")
                await send(infer_program_0(prompt, conn_id=conn_id))

            elif command.startswith("P2:"):
                strength = float(strip(command, "P2"))
                await send(infer_program_2(strength, conn_id=conn_id))

            elif command.startswith("P2B:"):
                strength = float(strip(command, "P2B"))
                await send(infer_program_2_b(strength, conn_id=conn_id))

            elif command == "P3":
                await send(infer_program_3(" ", 5.5, conn_id=conn_id))

            elif command.startswith("P3B:"):
                prompt = strip(command, "P3B")
                await send(
                    infer_program_3(f"{prompt}, photorealistic", 5.5, conn_id=conn_id)
                )

            elif command.startswith("P4:"):
                prompt = strip(command, "P4")
                await send(infer_program_4(prompt, conn_id=conn_id))

            else:
                await sock.send_text(f"unknown command: {command}")
        except starlette.websockets.WebSocketDisconnect:
            handle_socket_disconnect(sock)

            print("client disconnected.")
            break
