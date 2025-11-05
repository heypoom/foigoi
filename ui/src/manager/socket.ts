import { $disconnected, $exhibitionMode } from "../store/exhibition";
import {
  $progress,
  $startTimestep,
  $timestep,
  resetProgress,
} from "../store/progress";
import { $apiReady, $generating, $inferencePreview } from "../store/prompt";

/** After 8 seconds of no activity, consider the connection dead */
const DISCONNECT_TIMEOUT = 8 * 1000;

/** After 15 seconds of no activity, consider the generation to be stuck */
const generationTimeouts: Record<string, number> = {
  // more timeout when there is no denoising
  P0: 30 * 1000,
  P2: 20 * 1000,
  P2B: 20 * 1000,
  P3B: 20 * 1000,
  P4: 20 * 1000,
};

const EXHIBITION_ENDPOINT = "wss://rui-an-api.vanguardgallery.com/ws";
const LIVE_LECTURE_ENDPOINT = "wss://rui-an-api.vanguardgallery.com/ws";

class SocketManager {
  sock: WebSocket;
  disconnectTimer?: number;
  generationStuckTimer?: number;

  currentInferenceMessage?: string;

  constructor() {
    this.sock = this.createWs();
  }

  get url(): string {
    if ($exhibitionMode.get()) {
      return EXHIBITION_ENDPOINT;
    } else {
      return LIVE_LECTURE_ENDPOINT;
    }
  }

  createWs() {
    const ws = new WebSocket(this.url);
    this.startDisconnectionTimer();

    this.sock = ws;
    this.addListeners();

    return ws;
  }

  markDisconnect() {
    if (this.sock) {
      this.removeListeners();
    }

    $apiReady.set(false);
    $generating.set(false);
    resetProgress();

    this.clearGenerationStuckTimer();
    this.startDisconnectionTimer();
  }

  isExhibition() {
    return $exhibitionMode.get();
  }

  startDisconnectionTimer() {
    if (this.disconnectTimer === undefined) {
      this.disconnectTimer = setTimeout(() => {
        // connection is dead
        console.log(`[ws] websocket connection dead`);
        $disconnected.set(true);
      }, DISCONNECT_TIMEOUT);
    }
  }

  isInProgress() {
    const progress = $progress.get();
    const isInProgress = progress > 0 && progress < 98;

    return isInProgress;
  }

  getProgramId(inferenceMessage?: string) {
    const pid = inferenceMessage?.split(":")?.[0];
    if (!pid || !pid.startsWith("P")) return;

    return pid;
  }

  startGenerationStuckTimer(inferenceMessage?: string) {
    // enable only when in exhibition, not in lecture
    if (!this.isExhibition()) return;

    // enable only for valid inference messages
    const programId = this.getProgramId(inferenceMessage);
    if (!programId) return;

    const message = inferenceMessage ?? this.currentInferenceMessage;

    if (inferenceMessage) {
      this.currentInferenceMessage = inferenceMessage;
    }

    if (this.generationStuckTimer !== undefined) {
      this.clearGenerationStuckTimer();
    }

    // skip if the timeout is not defined
    const stuckTimeout = generationTimeouts[programId];
    if (!stuckTimeout || stuckTimeout <= 0) return;

    console.log(`[watchdog] "${programId}" :: ${stuckTimeout}ms`);

    this.generationStuckTimer = setTimeout(() => {
      console.log(`[watchdog] "${message}" is stuck!`);

      this.handleGenerationStuck();
    }, stuckTimeout);
  }

  handleGenerationStuck() {
    $generating.set(false);
    $inferencePreview.set("");
    resetProgress();

    this.reconnectSoon("generation is stuck", 500, { shutup: true });
  }

  clearDisconnectionTimer() {
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
  }

  clearGenerationStuckTimer() {
    clearTimeout(this.generationStuckTimer);
    this.generationStuckTimer = undefined;
  }

  addListeners() {
    this.sock.addEventListener("error", this.onError);
    this.sock.addEventListener("open", this.onOpen);
    this.sock.addEventListener("close", this.onClose);
    this.sock.addEventListener("message", this.onMessage);
  }

  removeListeners() {
    this.sock.removeEventListener("error", this.onError);
    this.sock.removeEventListener("open", this.onOpen);
    this.sock.removeEventListener("close", this.onClose);
    this.sock.removeEventListener("message", this.onMessage);
  }

  onError = (event: Event) => {
    console.error("[ws] websocket error", event);

    this.markDisconnect();
    this.reconnectSoon("websocket error");
  };

  onOpen = () => {
    console.log(`[ws] websocket connected to "${this.sock.url}"`);

    this.markAlive();
  };

  generate = (message: string) => {
    console.log(`[gen] sent "${message}"`);

    this.sock.send(message);
    this.startGenerationStuckTimer(message);
  };

  onClose = () => {
    console.log("[ws] websocket closed");

    this.markDisconnect();
    this.reconnectSoon("websocket closed", 5000);
  };

  onMessage = (event: MessageEvent) => {
    this.markAlive();

    const data = event.data;

    // binary data received - assume JPEG-encoded image
    if (data instanceof Blob) {
      const blob = new Blob([data], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);

      $inferencePreview.set(url);

      this.startGenerationStuckTimer();
      console.log(`[ws] blob:`, blob.size);
    } else if (typeof data === "string") {
      const res = data.trim();

      // progress indicator
      if (res.startsWith("p:")) {
        const m = res.match(/p:s=(\d+):t=(\d+)/);

        if (m) {
          const s = parseInt(m[1], 10);
          const t = parseInt(m[2], 10);

          $timestep.set(t);

          if (s === 0) {
            $startTimestep.set(t);
          }
        }

        if (this.isInProgress()) {
          // continue to monitor the generation
          this.startGenerationStuckTimer();
        } else {
          this.clearGenerationStuckTimer();
        }
      } else if (res === "done") {
        // generation is done, stop monitoring the generation
        this.clearGenerationStuckTimer();

        $generating.set(false);
        resetProgress();
        console.log(`[ws] done!`);
      } else {
        console.log(`[ws] text: "${res.substring(0, 200)}"`);
      }
    } else {
      console.log(`[ws] unknown:`, event);
    }
  };

  markAlive() {
    $apiReady.set(true);
    $disconnected.set(false);

    this.clearDisconnectionTimer();
  }

  reconnectSoon(reason?: string, delay = 5000, flags?: { shutup?: boolean }) {
    if (!this.sock) return;

    $apiReady.set(false);

    // stop listening to inference events
    if (flags?.shutup) {
      this.removeListeners();
    }

    setTimeout(() => {
      console.log(`[ws] reconnecting due to "${reason}"`);

      this.sock = this.createWs();
    }, delay);
  }

  close() {
    this.sock.close();
    this.markDisconnect();
  }
}

export const socket = new SocketManager();

if (typeof window !== "undefined") {
  // @ts-expect-error - please
  window.socket = socket;
}
