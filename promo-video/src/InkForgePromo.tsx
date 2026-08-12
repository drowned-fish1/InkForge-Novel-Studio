import type { CSSProperties, ReactNode } from "react";
import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { ManboCaptionOverlay } from "./ManboCaptionOverlay";

const COLORS = {
  ink: "#061311",
  deep: "#0B1B18",
  green: "#69E3C2",
  teal: "#1D8F78",
  gold: "#E8B94F",
  cream: "#F8F3E8",
  muted: "#AEBDB7",
  red: "#FF6B68",
};

const FONT = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';
const DISPLAY = '"Arial Narrow", "Microsoft YaHei", "Segoe UI", sans-serif';

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const enter = (frame: number, start = 0, duration = 24) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const exit = (frame: number, start: number, duration = 16) =>
  interpolate(frame, [start, start + duration], [1, 0], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });

const NoiseGrid = ({ variant = 0 }: { variant?: number }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            variant % 2 === 0
              ? "radial-gradient(circle at 18% 22%, rgba(35,155,132,.24), transparent 33%), radial-gradient(circle at 82% 75%, rgba(232,185,79,.14), transparent 30%), linear-gradient(135deg, #061311 0%, #0A1917 55%, #07100F 100%)"
              : "radial-gradient(circle at 76% 18%, rgba(69,221,184,.18), transparent 31%), radial-gradient(circle at 15% 82%, rgba(232,185,79,.12), transparent 32%), linear-gradient(155deg, #07110F 0%, #0B1D1A 60%, #05100E 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.16,
          backgroundImage:
            "linear-gradient(rgba(105,227,194,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(105,227,194,.22) 1px, transparent 1px)",
          backgroundSize: "92px 92px",
          translate: `${-((frame * 0.5 + variant * 23) % 92)}px ${-((frame * 0.25) % 92)}px`,
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%)",
        }}
      />
      {Array.from({ length: 26 }).map((_, index) => {
        const size = 2 + (index % 4) * 1.5;
        const x = (index * 37 + variant * 17) % 100;
        const y = (index * 61 + variant * 11) % 100;
        const drift =
          Math.sin(frame / 24 + index * 1.7) * (8 + (index % 3) * 4);
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              borderRadius: 999,
              background: index % 5 === 0 ? COLORS.gold : COLORS.green,
              opacity: 0.18 + (index % 4) * 0.08,
              translate: `${drift}px ${Math.cos(frame / 28 + index) * 8}px`,
              boxShadow: `0 0 ${10 + size * 3}px currentColor`,
            }}
          />
        );
      })}
      <AbsoluteFill
        style={{
          opacity: 0.055,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,.45) 0px, rgba(255,255,255,.45) 1px, transparent 1px, transparent 4px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -280,
          left: interpolate(frame, [0, 160], [-580, 2100], clamp),
          width: 330,
          height: 1680,
          rotate: "24deg",
          background:
            "linear-gradient(90deg, transparent, rgba(105,227,194,.08), transparent)",
          filter: "blur(16px)",
        }}
      />
      <AbsoluteFill
        style={{
          boxShadow: "inset 0 0 190px rgba(0,0,0,.72)",
        }}
      />
    </AbsoluteFill>
  );
};

const BrandMark = ({ size = 72 }: { size?: number }) => (
  <Img
    src={staticFile("assets/inkforge-icon.png")}
    style={{
      width: size,
      height: size,
      filter: "drop-shadow(0 12px 30px rgba(0,0,0,.45))",
    }}
  />
);

const Eyebrow = ({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 16,
      color: COLORS.green,
      fontFamily: DISPLAY,
      fontSize: 26,
      fontWeight: 800,
      letterSpacing: 7,
      textTransform: "uppercase",
      ...style,
    }}
  >
    <span
      style={{
        width: 48,
        height: 3,
        background: COLORS.gold,
        boxShadow: `0 0 16px ${COLORS.gold}`,
      }}
    />
    {children}
  </div>
);

const Pill = ({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: "green" | "gold";
}) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: "13px 22px",
      borderRadius: 999,
      border: `1px solid ${tone === "green" ? "rgba(105,227,194,.45)" : "rgba(232,185,79,.46)"}`,
      color: tone === "green" ? COLORS.green : COLORS.gold,
      background:
        tone === "green" ? "rgba(105,227,194,.08)" : "rgba(232,185,79,.08)",
      fontFamily: DISPLAY,
      fontSize: 22,
      fontWeight: 800,
      letterSpacing: 2,
      whiteSpace: "nowrap",
    }}
  >
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 20,
        background: tone === "green" ? COLORS.green : COLORS.gold,
        boxShadow: `0 0 14px ${tone === "green" ? COLORS.green : COLORS.gold}`,
      }}
    />
    {children}
  </div>
);

const Screen = ({
  src,
  width,
  style,
}: {
  src: string;
  width: number;
  style?: CSSProperties;
}) => (
  <div
    style={{
      width,
      aspectRatio: "16 / 9",
      borderRadius: 24,
      overflow: "hidden",
      border: "1px solid rgba(248,243,232,.2)",
      background: "#0B1513",
      boxShadow:
        "0 50px 120px rgba(0,0,0,.58), 0 0 0 1px rgba(105,227,194,.08), 0 0 70px rgba(29,143,120,.15)",
      ...style,
    }}
  >
    <div
      style={{
        height: 34,
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(4,10,9,.96)",
        borderBottom: "1px solid rgba(255,255,255,.08)",
      }}
    >
      {[COLORS.red, COLORS.gold, COLORS.green].map((color) => (
        <span
          key={color}
          style={{ width: 9, height: 9, borderRadius: 9, background: color }}
        />
      ))}
      <span
        style={{
          marginLeft: "auto",
          color: "rgba(255,255,255,.34)",
          font: `600 13px ${DISPLAY}`,
          letterSpacing: 2,
        }}
      >
        INKFORGE / LOCAL WORKSPACE
      </span>
    </div>
    <Img
      src={staticFile(src)}
      style={{ width: "100%", height: "calc(100% - 34px)", objectFit: "cover" }}
    />
  </div>
);

const SceneFrame = ({
  children,
  variant = 0,
}: {
  children: ReactNode;
  variant?: number;
}) => (
  <AbsoluteFill
    style={{ background: COLORS.ink, color: COLORS.cream, overflow: "hidden" }}
  >
    <NoiseGrid variant={variant} />
    <div
      style={{
        position: "absolute",
        inset: "68px 82px",
        border: "1px solid rgba(248,243,232,.075)",
        borderRadius: 32,
      }}
    />
    {children}
    <div
      style={{
        position: "absolute",
        left: 86,
        bottom: 42,
        color: "rgba(248,243,232,.35)",
        font: `700 15px ${DISPLAY}`,
        letterSpacing: 4,
      }}
    >
      INKFORGE · LOCAL NOVEL STUDIO
    </div>
    <div
      style={{
        position: "absolute",
        right: 86,
        bottom: 42,
        color: "rgba(105,227,194,.42)",
        font: `700 15px ${DISPLAY}`,
        letterSpacing: 4,
      }}
    >
      OPEN SOURCE / MIT
    </div>
  </AbsoluteFill>
);

const HookScene = ({ longHold = false }: { longHold?: boolean }) => {
  const frame = useCurrentFrame();
  const title = enter(frame, 10, 28) * (longHold ? 1 : exit(frame, 92, 14));
  return (
    <SceneFrame>
      <div
        style={{
          position: "absolute",
          inset: "120px 150px 120px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 30,
          textAlign: "center",
        }}
      >
        <div
          style={{
            opacity: enter(frame, 0, 18),
            translate: `0 ${interpolate(enter(frame, 0, 18), [0, 1], [24, 0])}px`,
          }}
        >
          <Eyebrow>LOCAL-FIRST · AUTHOR-CONTROLLED</Eyebrow>
        </div>
        <div
          style={{
            position: "relative",
            opacity: title,
            scale: interpolate(title, [0, 1], [1.08, 1]),
            clipPath: `inset(0 ${interpolate(title, [0, 1], [100, 0])}% 0 0)`,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 146,
              fontWeight: 950,
              lineHeight: 1.05,
              letterSpacing: -8,
              color: COLORS.cream,
              textShadow: "0 18px 70px rgba(0,0,0,.5)",
            }}
          >
            长篇创作
            <br />
            <span style={{ color: COLORS.green }}>不该失去</span>
            <span style={{ color: COLORS.gold }}>控制</span>
          </div>
          <div
            style={{
              position: "absolute",
              left: interpolate(frame, [12, 52], [-260, 1120], clamp),
              top: 112,
              width: 270,
              height: 8,
              rotate: "-8deg",
              background: `linear-gradient(90deg, transparent, ${COLORS.cream}, transparent)`,
              filter: "blur(2px)",
              opacity: interpolate(
                frame,
                [12, 22, 46, 52],
                [0, 1, 1, 0],
                clamp,
              ),
              boxShadow: `0 0 34px ${COLORS.green}`,
            }}
          />
        </div>
        <div
          style={{
            opacity:
              enter(frame, 42, 22) * (longHold ? 1 : exit(frame, 92, 14)),
            translate: `0 ${interpolate(enter(frame, 42, 22), [0, 1], [22, 0])}px`,
            fontFamily: FONT,
            fontSize: 38,
            fontWeight: 650,
            color: COLORS.muted,
            letterSpacing: 8,
          }}
        >
          你的故事 · 你的硬盘 · 你的决定
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 118,
          top: 100,
          opacity: enter(frame, 58, 20),
          rotate: `${interpolate(frame, [58, 86], [-12, 0], clamp)}deg`,
          scale: interpolate(frame, [58, 86], [0.65, 1], clamp),
        }}
      >
        <BrandMark size={104} />
      </div>
    </SceneFrame>
  );
};

const ProductScene = () => {
  const frame = useCurrentFrame();
  const screenIn = enter(frame, 12, 34);
  return (
    <SceneFrame variant={1}>
      <div
        style={{
          position: "absolute",
          inset: "112px 118px 108px",
          display: "grid",
          gridTemplateColumns: "540px 1fr",
          alignItems: "center",
          gap: 92,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 22,
              opacity: enter(frame, 0, 18),
              translate: `${interpolate(enter(frame, 0, 18), [0, 1], [-42, 0])}px 0`,
            }}
          >
            <BrandMark size={84} />
            <Eyebrow>MEET INKFORGE</Eyebrow>
          </div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 110,
              fontWeight: 950,
              lineHeight: 0.92,
              letterSpacing: -7,
              opacity: enter(frame, 10, 24),
              translate: `${interpolate(enter(frame, 10, 24), [0, 1], [-62, 0])}px 0`,
            }}
          >
            INK
            <br />
            <span style={{ color: COLORS.green }}>FORGE</span>
          </div>
          <div
            style={{
              width: 480,
              fontFamily: FONT,
              fontSize: 42,
              fontWeight: 780,
              lineHeight: 1.4,
              color: COLORS.cream,
              opacity: enter(frame, 26, 24),
            }}
          >
            本地优先的
            <br />
            <span style={{ color: COLORS.gold }}>AI 小说创作驾驶舱</span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              opacity: enter(frame, 46, 20),
            }}
          >
            <Pill>LOCAL DATA</Pill>
            <Pill tone="gold">NO ACCOUNT</Pill>
          </div>
        </div>
        <div
          style={{
            position: "relative",
            height: 740,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            perspective: 1500,
          }}
        >
          <div
            style={{
              opacity: screenIn,
              transform: `rotateY(${interpolate(screenIn, [0, 1], [-14, -4])}deg) rotateX(${interpolate(screenIn, [0, 1], [8, 2])}deg) translateX(${interpolate(screenIn, [0, 1], [160, 0])}px)`,
            }}
          >
            <Screen src="assets/workspace-dark.png" width={1120} />
          </div>
          <div
            style={{
              position: "absolute",
              inset: "80px 0",
              background:
                "linear-gradient(112deg, transparent 36%, rgba(255,255,255,.16) 48%, transparent 60%)",
              translate: `${interpolate(frame, [30, 100], [-800, 950], clamp)}px 0`,
              opacity: 0.7,
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -10,
              bottom: 42,
              opacity: enter(frame, 66, 18),
              translate: `0 ${interpolate(enter(frame, 66, 18), [0, 1], [34, 0])}px`,
            }}
          >
            <Pill>WINDOWS · V1.0 RC</Pill>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const ApprovalCard = ({
  label,
  title,
  accent,
  progress,
}: {
  label: string;
  title: string;
  accent: string;
  progress: number;
}) => (
  <div
    style={{
      width: 350,
      height: 250,
      borderRadius: 28,
      border: `1px solid ${accent}55`,
      background:
        "linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.025))",
      boxShadow: `0 28px 70px rgba(0,0,0,.3), 0 0 45px ${accent}12`,
      padding: 28,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      opacity: progress,
      scale: interpolate(progress, [0, 1], [0.86, 1]),
      translate: `0 ${interpolate(progress, [0, 1], [38, 0])}px`,
    }}
  >
    <div
      style={{ color: accent, font: `800 18px ${DISPLAY}`, letterSpacing: 4 }}
    >
      {label}
    </div>
    <div style={{ font: `850 34px ${FONT}`, lineHeight: 1.25 }}>{title}</div>
    <div
      style={{
        width: "100%",
        height: 6,
        background: "rgba(255,255,255,.08)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${progress * 100}%`,
          height: "100%",
          background: accent,
        }}
      />
    </div>
  </div>
);

const ControlScene = () => {
  const frame = useCurrentFrame();
  const lineProgress = interpolate(frame, [35, 102], [0, 1], clamp);
  return (
    <SceneFrame variant={2}>
      <div
        style={{
          position: "absolute",
          inset: "110px 140px 105px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 34,
        }}
      >
        <Eyebrow style={{ opacity: enter(frame, 0, 18) }}>
          AI THAT ASKS BEFORE IT WRITES
        </Eyebrow>
        <div
          style={{
            font: `950 92px ${FONT}`,
            lineHeight: 1.08,
            letterSpacing: -5,
            textAlign: "center",
            opacity: enter(frame, 8, 24),
            translate: `0 ${interpolate(enter(frame, 8, 24), [0, 1], [32, 0])}px`,
          }}
        >
          AI 不直接改稿
          <br />
          <span style={{ color: COLORS.green }}>它只提交提案</span>
        </div>
        <div
          style={{
            position: "relative",
            width: 1280,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 30,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 160,
              right: 160,
              top: 122,
              height: 3,
              background: "rgba(255,255,255,.1)",
            }}
          >
            <div
              style={{
                width: `${lineProgress * 100}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${COLORS.green}, ${COLORS.gold})`,
                boxShadow: `0 0 18px ${COLORS.green}`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${lineProgress * 100}%`,
                top: -8,
                width: 18,
                height: 18,
                borderRadius: 18,
                background: COLORS.cream,
                boxShadow: `0 0 30px ${COLORS.green}`,
              }}
            />
          </div>
          <ApprovalCard
            label="01 · AGENT"
            title="读取批准的上下文"
            accent={COLORS.green}
            progress={enter(frame, 24, 22)}
          />
          <ApprovalCard
            label="02 · DIFF"
            title="生成可预览的提案"
            accent={COLORS.gold}
            progress={enter(frame, 48, 22)}
          />
          <ApprovalCard
            label="03 · AUTHOR"
            title="接受 · 拒绝 · 回滚"
            accent={COLORS.green}
            progress={enter(frame, 72, 22)}
          />
        </div>
        <div
          style={{
            font: `700 32px ${FONT}`,
            color: COLORS.muted,
            letterSpacing: 3,
            opacity: enter(frame, 94, 18),
          }}
        >
          AI 是助手。作者永远是最终编辑。
        </div>
      </div>
    </SceneFrame>
  );
};

const FlowScene = () => {
  const frame = useCurrentFrame();
  const steps = ["规划", "写作", "连续性检查", "修订", "导出"];
  const progress = interpolate(frame, [24, 118], [0, 1], clamp);
  return (
    <SceneFrame variant={3}>
      <div
        style={{
          position: "absolute",
          inset: "108px 126px 108px",
          display: "grid",
          gridTemplateRows: "auto 1fr",
          gap: 34,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "end",
            justifyContent: "space-between",
          }}
        >
          <div>
            <Eyebrow style={{ opacity: enter(frame, 0, 18) }}>
              ONE WORKSPACE · WHOLE NOVEL
            </Eyebrow>
            <div
              style={{
                marginTop: 24,
                font: `950 88px ${FONT}`,
                letterSpacing: -5,
                opacity: enter(frame, 8, 24),
              }}
            >
              一条工作流，写完整部长篇
            </div>
          </div>
          <div style={{ opacity: enter(frame, 24, 18) }}>
            <Pill tone="gold">FROM IDEA TO EPUB 3</Pill>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.1fr .9fr",
            gap: 58,
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 40,
              borderRadius: 34,
              border: "1px solid rgba(255,255,255,.1)",
              padding: "52px 52px 48px",
              background: "rgba(5,15,13,.62)",
              boxShadow: "0 35px 90px rgba(0,0,0,.34)",
              opacity: enter(frame, 20, 25),
            }}
          >
            {steps.map((step, index) => {
              const nodeProgress = Math.max(
                0,
                Math.min(1, progress * steps.length - index),
              );
              return (
                <div
                  key={step}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "58px 1fr 160px",
                    alignItems: "center",
                    gap: 24,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 16,
                      display: "grid",
                      placeItems: "center",
                      background:
                        nodeProgress > 0.1
                          ? COLORS.green
                          : "rgba(255,255,255,.07)",
                      color: nodeProgress > 0.1 ? COLORS.ink : COLORS.muted,
                      font: `900 20px ${DISPLAY}`,
                      boxShadow:
                        nodeProgress > 0.1
                          ? `0 0 24px ${COLORS.green}66`
                          : "none",
                      scale: interpolate(nodeProgress, [0, 1], [0.85, 1]),
                    }}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div
                    style={{
                      font: `850 39px ${FONT}`,
                      color: nodeProgress > 0.2 ? COLORS.cream : "#72807B",
                    }}
                  >
                    {step}
                  </div>
                  <div
                    style={{
                      height: 7,
                      borderRadius: 8,
                      background: "rgba(255,255,255,.08)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${nodeProgress * 100}%`,
                        height: "100%",
                        borderRadius: 8,
                        background: index === 4 ? COLORS.gold : COLORS.green,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              opacity: enter(frame, 46, 30),
              transform: `perspective(1400px) rotateY(${interpolate(enter(frame, 46, 30), [0, 1], [14, 4])}deg) translateX(${interpolate(enter(frame, 46, 30), [0, 1], [90, 0])}px)`,
            }}
          >
            <Screen src="assets/multi-agent.png" width={820} />
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const Stat = ({
  value,
  label,
  progress,
  accent,
}: {
  value: string;
  label: string;
  progress: number;
  accent?: boolean;
}) => (
  <div
    style={{
      minWidth: 204,
      padding: "26px 28px",
      borderRadius: 24,
      background: accent ? "rgba(105,227,194,.14)" : "rgba(255,255,255,.05)",
      border: `1px solid ${accent ? "rgba(105,227,194,.4)" : "rgba(255,255,255,.1)"}`,
      opacity: progress,
      translate: `0 ${interpolate(progress, [0, 1], [28, 0])}px`,
    }}
  >
    <div
      style={{
        color: accent ? COLORS.green : COLORS.cream,
        font: `950 54px ${DISPLAY}`,
        letterSpacing: -2,
      }}
    >
      {value}
    </div>
    <div
      style={{
        marginTop: 8,
        color: COLORS.muted,
        font: `750 20px ${FONT}`,
        letterSpacing: 2,
      }}
    >
      {label}
    </div>
  </div>
);

const ProofScene = () => {
  const frame = useCurrentFrame();
  return (
    <SceneFrame variant={4}>
      <div
        style={{
          position: "absolute",
          inset: "105px 118px 105px",
          display: "grid",
          gridTemplateColumns: "1fr 640px",
          gap: 80,
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            height: 760,
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            style={{
              opacity: enter(frame, 8, 30),
              transform: `perspective(1600px) rotateY(${interpolate(enter(frame, 8, 30), [0, 1], [-11, -3])}deg) rotateX(2deg) translateX(${interpolate(enter(frame, 8, 30), [0, 1], [-120, 0])}px)`,
            }}
          >
            <Screen src="assets/quality-review.png" width={1080} />
          </div>
          <div
            style={{
              position: "absolute",
              left: -10,
              bottom: 18,
              width: 240,
              height: 240,
              borderRadius: 40,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: `linear-gradient(145deg, ${COLORS.green}, ${COLORS.teal})`,
              color: COLORS.ink,
              boxShadow: `0 32px 90px rgba(0,0,0,.45), 0 0 60px ${COLORS.green}44`,
              opacity: enter(frame, 48, 22),
              scale: interpolate(enter(frame, 48, 22), [0, 1], [0.72, 1]),
            }}
          >
            <div style={{ font: `950 92px ${DISPLAY}`, lineHeight: 1 }}>
              {Math.round(interpolate(frame, [50, 84], [0, 78], clamp))}
            </div>
            <div
              style={{
                marginTop: 10,
                font: `850 22px ${FONT}`,
                letterSpacing: 3,
              }}
            >
              质量基线
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <Eyebrow style={{ opacity: enter(frame, 0, 18) }}>
            SEE THE WHOLE MANUSCRIPT
          </Eyebrow>
          <div
            style={{
              font: `950 84px ${FONT}`,
              lineHeight: 1.12,
              letterSpacing: -5,
              opacity: enter(frame, 14, 26),
            }}
          >
            不只看当前页
            <br />
            <span style={{ color: COLORS.gold }}>看见整部小说</span>
          </div>
          <div
            style={{
              font: `650 31px ${FONT}`,
              color: COLORS.muted,
              lineHeight: 1.6,
              opacity: enter(frame, 34, 22),
            }}
          >
            连续性、角色、节奏、文风与伏笔
            <br />
            在同一个修订工作流里完成。
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              marginTop: 12,
            }}
          >
            <Stat
              value="LOCAL"
              label="本地存储"
              progress={enter(frame, 58, 18)}
              accent
            />
            <Stat
              value="DIFF"
              label="提案预览"
              progress={enter(frame, 68, 18)}
            />
            <Stat
              value="EPUB 3"
              label="出版级导出"
              progress={enter(frame, 78, 18)}
            />
            <Stat
              value="MIT"
              label="开放源代码"
              progress={enter(frame, 88, 18)}
              accent
            />
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};

const GitHubMark = ({ size = 70 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-label="GitHub"
  >
    <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A10.98 10.98 0 0 1 12 6.2c.98 0 1.95.13 2.86.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.7 5.39-5.28 5.68.42.36.78 1.07.78 2.16v3.16c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
  </svg>
);

const CtaScene = () => {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 7) * 0.025;
  const slash = interpolate(frame, [4, 44], [0, 100], clamp);
  return (
    <SceneFrame variant={5}>
      <div
        style={{
          position: "absolute",
          inset: "104px 140px 104px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            opacity: enter(frame, 0, 18),
            scale: interpolate(enter(frame, 0, 18), [0, 1], [0.72, 1]),
          }}
        >
          <BrandMark size={112} />
          <span
            style={{
              color: COLORS.cream,
              font: `950 76px ${DISPLAY}`,
              letterSpacing: -3,
            }}
          >
            INKFORGE
          </span>
        </div>
        <div
          style={{
            marginTop: 12,
            font: `950 102px ${FONT}`,
            lineHeight: 1.08,
            letterSpacing: -6,
            opacity: enter(frame, 10, 24),
            clipPath: `inset(0 ${100 - slash}% 0 0)`,
          }}
        >
          把作品留在
          <span style={{ color: COLORS.green }}>自己手里</span>
        </div>
        <div
          style={{
            marginTop: 18,
            display: "flex",
            alignItems: "center",
            gap: 22,
            padding: "24px 38px",
            borderRadius: 22,
            background: COLORS.cream,
            color: COLORS.ink,
            boxShadow: `0 30px 90px rgba(0,0,0,.5), 0 0 80px ${COLORS.green}38`,
            opacity: enter(frame, 34, 20),
            scale: pulse * interpolate(enter(frame, 34, 20), [0, 1], [0.86, 1]),
          }}
        >
          <GitHubMark size={62} />
          <span style={{ font: `950 44px ${FONT}`, letterSpacing: -1 }}>
            去 GitHub · Star InkForge
          </span>
          <span style={{ color: COLORS.gold, fontSize: 54, lineHeight: 1 }}>
            ★
          </span>
        </div>
        <div
          style={{
            marginTop: 10,
            font: `750 32px ${DISPLAY}`,
            letterSpacing: 2,
            color: COLORS.muted,
            opacity: enter(frame, 54, 18),
          }}
        >
          github.com/drowned-fish1/InkForge-Novel-Studio
        </div>
        <div
          style={{
            display: "flex",
            gap: 18,
            marginTop: 16,
            opacity: enter(frame, 68, 16),
          }}
        >
          <Pill>OPEN SOURCE</Pill>
          <Pill tone="gold">MIT LICENSE</Pill>
          <Pill>BUILD IN PUBLIC</Pill>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          width: 2,
          height: `${interpolate(frame, [0, 80], [0, 1080], clamp)}px`,
          background: `linear-gradient(${COLORS.green}, transparent)`,
          boxShadow: `0 0 28px ${COLORS.green}`,
          opacity: 0.45,
        }}
      />
    </SceneFrame>
  );
};

const PromoSeries = ({
  durations,
  transitionDurationInFrames,
  longHook = false,
}: {
  durations: readonly [number, number, number, number, number, number];
  transitionDurationInFrames: number;
  longHook?: boolean;
}) => {
  const transition = linearTiming({
    durationInFrames: transitionDurationInFrames,
  });
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={durations[0]}>
        <HookScene longHold={longHook} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={transition} />
      <TransitionSeries.Sequence durationInFrames={durations[1]}>
        <ProductScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={transition}
      />
      <TransitionSeries.Sequence durationInFrames={durations[2]}>
        <ControlScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={transition} />
      <TransitionSeries.Sequence durationInFrames={durations[3]}>
        <FlowScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={transition}
      />
      <TransitionSeries.Sequence durationInFrames={durations[4]}>
        <ProofScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={transition} />
      <TransitionSeries.Sequence durationInFrames={durations[5]}>
        <CtaScene />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};

export const InkForgePromo = () => {
  return (
    <AbsoluteFill style={{ fontFamily: FONT, background: COLORS.ink }}>
      <Audio
        src={staticFile("audio/inkforge-promo.wav")}
        volume={(frame) =>
          interpolate(frame, [0, 18, 666, 719], [0, 0.92, 0.92, 0], clamp)
        }
      />
      <PromoSeries
        durations={[110, 130, 145, 145, 150, 110]}
        transitionDurationInFrames={14}
      />
    </AbsoluteFill>
  );
};

export type ManboVoiceoverTimeline = {
  fps: number;
  transitionDurationInFrames: number;
  playbackRate: number;
  totalDurationInFrames: number;
  durationSeconds: number;
  segments: Array<{
    id: string;
    text: string;
    src: string;
    durationSeconds: number;
    sceneDurationInFrames: number;
    sceneStartFrame: number;
    voiceStartFrame: number;
    voiceEndFrame: number;
  }>;
};

export type InkForgePromoVoiceoverProps = {
  timeline: ManboVoiceoverTimeline | null;
};

export const InkForgePromoVoiceover = ({
  timeline,
}: InkForgePromoVoiceoverProps) => {
  if (!timeline || timeline.segments.length !== 6) {
    return null;
  }

  const durations = timeline.segments.map(
    (segment) => segment.sceneDurationInFrames,
  ) as [number, number, number, number, number, number];

  return (
    <AbsoluteFill style={{ fontFamily: FONT, background: COLORS.ink }}>
      <Audio
        src={staticFile("audio/inkforge-promo-manbo-bed.wav")}
        volume={(frame) => {
          const isSpeaking = timeline.segments.some(
            (segment) =>
              frame >= segment.voiceStartFrame &&
              frame <= segment.voiceEndFrame,
          );
          const fadeVolume = interpolate(
            frame,
            [
              0,
              18,
              timeline.totalDurationInFrames - 46,
              timeline.totalDurationInFrames - 1,
            ],
            [0, 1, 1, 0],
            clamp,
          );
          return (isSpeaking ? 0.15 : 0.34) * fadeVolume;
        }}
      />
      {timeline.segments.map((segment) => (
        <Sequence
          key={segment.id}
          from={segment.voiceStartFrame}
          durationInFrames={segment.voiceEndFrame - segment.voiceStartFrame + 2}
          premountFor={timeline.fps}
        >
          <Audio
            src={staticFile(segment.src)}
            playbackRate={timeline.playbackRate}
            volume={1}
          />
        </Sequence>
      ))}
      <PromoSeries
        durations={durations}
        transitionDurationInFrames={timeline.transitionDurationInFrames}
        longHook
      />
      <ManboCaptionOverlay />
    </AbsoluteFill>
  );
};
