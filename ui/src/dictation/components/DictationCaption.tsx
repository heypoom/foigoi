import { useStore } from "@nanostores/react";

import { $transcript } from "../../store/dictation";

export const DictationCaption = ({
  transcript: previewTranscript,
}: {
  transcript?: string;
}) => {
  const { transcript: liveTranscript } = useStore($transcript);
  const transcript = previewTranscript ?? liveTranscript;

  if (!transcript) return null;

  return (
    <div className="w-fit max-w-[1200px] mt-[50px] mx-auto mb-[110px] px-6 text-center text-[48px] leading-[92px] text-white">
      <span
        className="inline break-words bg-black/70 py-2 px-6 font-extralight"
        style={{
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {transcript}
      </span>
    </div>
  );
};
