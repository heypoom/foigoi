import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { $exhibitionMode, $canPlay, $videoMode } from "../store/exhibition";
import { automator } from "../utils/exhibition/exhibition-automator";
import { useEffect } from "react";
import { resetAll } from "../utils/exhibition/reset";
import { fullscreen } from "../utils/commands";
import { $fadeStatus } from "../store/fader";
import { socket } from "../manager/socket";

export const Route = createLazyFileRoute("/")({
  component: SettingsRoute,
});

export function SettingsRoute() {
  const go = useNavigate();
  useEffect(() => {
    resetAll();
    $fadeStatus.set(false);
  }, []);

  // performance lecture mode
  function startLiveLecture() {
    $exhibitionMode.set(false);
    $videoMode.set(false);

    socket.clearDisconnectionTimer();
    socket.reconnectSoon("program change - lecture", 10);

    resetAll();

    $canPlay.set(true);
    automator.stopClock();

    // NOTE: do not use fullscreen() here, as it will show "To exit full screen"

    go({ to: "/zero" });
  }

  return (
    <div className="flex flex-col items-center justify-center h-full font-mono min-h-screen bg-black text-white gap-y-8">
      <h1 className="text-2xl">program manager</h1>

      <div className="flex flex-col sm:flex-row gap-x-4 gap-y-4">
        <button
          onClick={startLiveLecture}
          className="border border-yellow-300 text-yellow-300 px-3 py-2 text-xs"
        >
          start live lecture
        </button>

        <button
          onClick={fullscreen}
          className="border border-gray-300 text-gray-300 px-3 py-2 text-xs"
        >
          fullscreen
        </button>
      </div>

      <div className="space-y-4">
        <div>version: August 2, 2026</div>
      </div>
    </div>
  );
}
