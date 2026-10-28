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
  /(InkForge|AI|GitHub|Star|本地|硬盘|提案|作者|作品|Windows|EPUB|回滚|开源)/g;
const ACCENT_TERMS = new Set([
  "InkForge",
  "AI",
  "GitHub",
  "Star",
  "本地",
  "硬盘",
  "提案",
  "作者",
  "作品",
  "Windows",
  "EPUB",
  "回滚",
  "开源",
]);

const CaptionPage = ({ caption }: { caption: Caption }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = Math.max(
    1,
    ((caption.endMs - caption.startMs) / 1000) * fps,
  );
  const entrance = interpolate(frame, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const opacity =
    entrance *
    interpolate(frame, [duration - 6, duration], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "0 64px 118px",
      }}
    >
      <div
        style={{
          maxWidth: 944,
          padding: "20px 30px 23px",
          borderRadius: 18,
          background: "rgba(3,9,8,.88)",
          border: "1px solid rgba(255,255,255,.16)",
          boxShadow: "0 14px 42px rgba(0,0,0,.58)",
          color: "#FFF9EE",
          fontFamily: FONT,
          fontSize: 52,
          lineHeight: 1.38,
          fontWeight: 900,
          letterSpacing: -1,
          textAlign: "center",
          opacity,
          translate: `0 ${interpolate(entrance, [0, 1], [20, 0])}px`,
        }}
      >
        {caption.text.split(ACCENT_PATTERN).map((part, index) => (
          <span
            key={`${part}-${index}`}
            style={{ color: ACCENT_TERMS.has(part) ? "#6FE6C4" : "#FFF9EE" }}
          >
            {part}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const LongformCaptionOverlay = () => {
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const { fps } = useVideoConfig();
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading longform captions"));

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        staticFile("voiceover/manbo-longform/captions.json"),
      );
      if (!response.ok) throw new Error(`Captions HTTP ${response.status}`);
      setCaptions((await response.json()) as Caption[]);
      continueRender(handle);
    } catch (error) {
      cancelRender(error instanceof Error ? error : new Error(String(error)));
    }
  }, [cancelRender, continueRender, handle]);

  useEffect(() => {
    load();
  }, [load]);

  if (!captions) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {captions.map((caption, index) => {
        const from = Math.round((caption.startMs / 1000) * fps);
        const durationInFrames = Math.max(
          1,
          Math.round(((caption.endMs - caption.startMs) / 1000) * fps),
        );
        return (
          <Sequence
            key={`${caption.startMs}-${index}`}
            from={from}
            durationInFrames={durationInFrames}
            premountFor={fps}
          >
            <CaptionPage caption={caption} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
