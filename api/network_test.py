from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter(prefix="/network-test")
NO_CACHE = {"Cache-Control": "no-store"}


@router.get("")
async def network_test_page():
    return FileResponse(
        Path(__file__).with_name("network_test.html"),
        media_type="text/html",
        headers=NO_CACHE,
    )


@router.get("/ping")
async def network_test_ping():
    return JSONResponse({"ok": True}, headers=NO_CACHE)


@router.websocket("/ws")
async def network_test_socket(socket: WebSocket):
    await socket.accept()

    try:
        while True:
            # Echo small probes without invoking an inference pipeline.
            message = await socket.receive_text()
            if len(message) > 128:
                await socket.close(code=1009)
                return

            await socket.send_text(message)
    except WebSocketDisconnect:
        return
