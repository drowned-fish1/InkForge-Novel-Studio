import { useCallback, useEffect, useState } from "react";
import type { Caption } from "@remotion/captions";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";

const FONT = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';
const ACCENT_PATTERN =
  /(InkForge|AI|GitHub|Star|本地优先|硬盘|提案|作者|作品)/g;
const ACCENT_TERMS = new Set([
  "InkForge",
  "AI",
  "GitHub",
  "Star",
  "本地优先",
  "硬盘",
  "提案",
  "作者",
  "作品",
]);

const CaptionCard = ({ caption }: { caption: Caption }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = Math.max(
    1,
    ((caption.endMs - caption.startMs) / 1000) * fps,
  );
  const opacity =
    interpolate(frame, [0, 7], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }) *
    interpolate(frame, [duration - 8, duration], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    });

  const parts = caption.text.split(ACCENT_PATTERN);
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 86,
      }}
    >
      <div
        style={{
          maxWidth: 1540,
          padding: "18px 34px 20px",
          borderRadius: 20,
          border: "1px solid rgba(248,243,232,.2)",
          background: "rgba(3,11,9,.86)",
          boxShadow:
            "0 18px 55px rgba(0,0,0,.46), 0 0 35px rgba(105,227,194,.1)",
          backdropFilter: "blur(18px)",
          color: "#F8F3E8",
          fontFamily: FONT,
          fontSize: 46,
          fontWeight: 850,
          lineHeight: 1.35,
          letterSpacing: 1,
          textAlign: "center",
          opacity,
          translate: `0 ${interpolate(opacity, [0, 1], [18, 0])}px`,
        }}
      >
        {parts.map((part, index) => (
          <span
            key={`${part}-${index}`}
            style={{
              color: ACCENT_TERMS.has(part) ? "#69E3C2" : "#F8F3E8",
            }}
          >
            {part}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const ManboCaptionOverlay = () => {
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const { fps } = useVideoConfig();
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading Manbo captions"));

  const loadCaptions = useCallback(async () => {
    try {
      const response = await fetch(staticFile("voiceover/manbo/captions.json"));
      if (!response.ok) {
        throw new Error(`Caption request failed with HTTP ${response.status}`);
      }
      const json = (await response.json()) as Caption[];
      setCaptions(json);
      continueRender(handle);
    } catch (error) {
      cancelRender(error instanceof Error ? error : new Error(String(error)));
    }
  }, [cancelRender, continueRender, handle]);

  useEffect(() => {
    loadCaptions();
  }, [loadCaptions]);

  if (!captions) {
    return null;
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {captions.map((caption, index) => {
        const startFrame = Math.round((caption.startMs / 1000) * fps);
        const durationInFrames = Math.max(
          1,
          Math.round(((caption.endMs - caption.startMs) / 1000) * fps),
        );
        return (
          <Sequence
            key={`${caption.startMs}-${index}`}
            from={startFrame}
            durationInFrames={durationInFrames}
            premountFor={fps}
          >
            <CaptionCard caption={caption} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
