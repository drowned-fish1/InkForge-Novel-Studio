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
import { LongformCaptionOverlay } from "./LongformCaptionOverlay";

const FONT = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';
const DISPLAY = '"Arial Narrow", "Microsoft YaHei", "Segoe UI", sans-serif';
const CREAM = "#FFF9EE";
const INK = "#07110F";
const GREEN = "#6FE6C4";
const GOLD = "#F0BC49";
const RED = "#FF766E";
const MUTED = "#AAB8B3";
const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export type LongformScene = {
  id: string;
  text: string;
  src: string;
  durationSeconds: number;
  sceneDurationInFrames: number;
  sceneStartFrame: number;
  voiceStartFrame: number;
  voiceEndFrame: number;
};

export type LongformTimeline = {
  fps: number;
  transitionDurationInFrames: number;
  playbackRate: number;
  totalDurationInFrames: number;
  durationSeconds: number;
  scenes: LongformScene[];
};

export type LongformSoftAdProps = {
  timeline: LongformTimeline | null;
};

const inProgress = (frame: number, start = 0, duration = 18) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const FeedBackground = ({ index }: { index: number }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: INK }}>
      <AbsoluteFill
        style={{
          background:
            index % 3 === 0
              ? "radial-gradient(circle at 18% 18%, rgba(111,230,196,.24), transparent 32%), radial-gradient(circle at 88% 78%, rgba(240,188,73,.12), transparent 34%), #07110F"
              : index % 3 === 1
                ? "radial-gradient(circle at 82% 12%, rgba(111,230,196,.18), transparent 30%), radial-gradient(circle at 12% 82%, rgba(255,118,110,.10), transparent 32%), #07110F"
                : "radial-gradient(circle at 50% 28%, rgba(240,188,73,.13), transparent 30%), radial-gradient(circle at 70% 82%, rgba(111,230,196,.16), transparent 35%), #07110F",
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.09,
          backgroundImage:
            "linear-gradient(rgba(111,230,196,.28) 1px, transparent 1px), linear-gradient(90deg, rgba(111,230,196,.28) 1px, transparent 1px)",
          backgroundSize: "76px 76px",
          translate: `${-((frame * 0.18) % 76)}px ${-((frame * 0.11) % 76)}px`,
          maskImage: "linear-gradient(to bottom, black, transparent 88%)",
        }}
      />
      {Array.from({ length: 8 }).map((_, dot) => (
        <div
          key={dot}
          style={{
            position: "absolute",
            left: `${(dot * 29 + index * 11) % 100}%`,
            top: `${(dot * 47 + index * 13) % 88}%`,
            width: 4 + (dot % 3) * 2,
            height: 4 + (dot % 3) * 2,
            borderRadius: 12,
            background: dot % 3 === 0 ? GOLD : GREEN,
            opacity: 0.28,
            translate: `${Math.sin(frame / 32 + dot) * 12}px ${Math.cos(frame / 40 + dot) * 12}px`,
            boxShadow: "0 0 16px currentColor",
          }}
        />
      ))}
      <AbsoluteFill style={{ boxShadow: "inset 0 0 150px rgba(0,0,0,.6)" }} />
    </AbsoluteFill>
  );
};

const TopChrome = ({ index }: { index: number }) => (
  <>
    <div
      style={{
        position: "absolute",
        top: 64,
        left: 60,
        right: 60,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        font: `800 24px ${DISPLAY}`,
        letterSpacing: 3,
        color: "rgba(255,249,238,.62)",
      }}
    >
      <span>我在 GITHUB 挖到了什么</span>
      <span style={{ color: GREEN }}>
        {String(index + 1).padStart(2, "0")} / 15
      </span>
    </div>
    <div
      style={{
        position: "absolute",
        top: 112,
        left: 60,
        right: 60,
        height: 4,
        borderRadius: 8,
        background: "rgba(255,255,255,.09)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${((index + 1) / 15) * 100}%`,
          height: "100%",
          background: `linear-gradient(90deg, ${GREEN}, ${GOLD})`,
        }}
      />
    </div>
  </>
);

const SceneShell = ({
  index,
  children,
}: {
  index: number;
  children: ReactNode;
}) => (
  <AbsoluteFill style={{ color: CREAM, fontFamily: FONT, overflow: "hidden" }}>
    <FeedBackground index={index} />
    <TopChrome index={index} />
    <div
      style={{
        position: "absolute",
        inset: "150px 58px 330px",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        gap: 34,
      }}
    >
      {children}
    </div>
    <div
      style={{
        position: "absolute",
        bottom: 54,
        left: 60,
        right: 60,
        display: "flex",
        justifyContent: "space-between",
        color: "rgba(255,249,238,.38)",
        font: `700 19px ${DISPLAY}`,
        letterSpacing: 3,
      }}
    >
      <span>OPEN-SOURCE FIND</span>
      <span>INKFORGE · LOCAL NOVEL STUDIO</span>
    </div>
  </AbsoluteFill>
);

const Title = ({
  eyebrow,
  children,
  accent,
  align = "left",
}: {
  eyebrow: string;
  children: ReactNode;
  accent?: ReactNode;
  align?: "left" | "center";
}) => {
  const frame = useCurrentFrame();
  const progress = inProgress(frame, 2, 22);
  return (
    <div
      style={{
        textAlign: align,
        opacity: progress,
        translate: `0 ${interpolate(progress, [0, 1], [32, 0])}px`,
      }}
    >
      <div
        style={{
          color: GREEN,
          font: `850 25px ${DISPLAY}`,
          letterSpacing: 5,
          marginBottom: 18,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          font: `950 88px ${FONT}`,
          lineHeight: 1.08,
          letterSpacing: -6,
          textShadow: "0 16px 45px rgba(0,0,0,.44)",
        }}
      >
        {children}
      </div>
      {accent ? (
        <div
          style={{
            marginTop: 16,
            color: GOLD,
            font: `900 46px ${FONT}`,
            lineHeight: 1.25,
          }}
        >
          {accent}
        </div>
      ) : null}
    </div>
  );
};

const Tag = ({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: "green" | "gold" | "red";
}) => {
  const color = tone === "green" ? GREEN : tone === "gold" ? GOLD : RED;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "flex-start",
        borderRadius: 999,
        border: `2px solid ${color}66`,
        background: `${color}13`,
        color,
        padding: "13px 22px",
        font: `900 27px ${DISPLAY}`,
        letterSpacing: 2,
      }}
    >
      {children}
    </div>
  );
};

const Card = ({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) => (
  <div
    style={{
      borderRadius: 28,
      border: "1px solid rgba(255,255,255,.14)",
      background:
        "linear-gradient(145deg, rgba(255,255,255,.085), rgba(255,255,255,.025))",
      boxShadow: "0 28px 75px rgba(0,0,0,.35)",
      ...style,
    }}
  >
    {children}
  </div>
);

const ProductShot = ({
  src,
  focusX = 0.5,
  zoom = 1.25,
  height = 650,
}: {
  src: string;
  focusX?: number;
  zoom?: number;
  height?: number;
}) => {
  const frame = useCurrentFrame();
  const progress = inProgress(frame, 18, 26);
  const containerWidth = 964;
  const imageWidth = 1280 * zoom;
  const imageHeight = 720 * zoom;
  const baseLeft = (containerWidth - imageWidth) * focusX;
  return (
    <div
      style={{
        position: "relative",
        width: containerWidth,
        height,
        alignSelf: "center",
        borderRadius: 28,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,.18)",
        background: "#0B1513",
        boxShadow:
          "0 40px 100px rgba(0,0,0,.5), 0 0 55px rgba(111,230,196,.12)",
        opacity: progress,
        scale: interpolate(progress, [0, 1], [0.94, 1]),
      }}
    >
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 16px",
          background: "rgba(2,8,7,.96)",
          borderBottom: "1px solid rgba(255,255,255,.08)",
        }}
      >
        {[RED, GOLD, GREEN].map((color) => (
          <span
            key={color}
            style={{
              width: 10,
              height: 10,
              borderRadius: 10,
              background: color,
            }}
          />
        ))}
        <span
          style={{
            marginLeft: "auto",
            color: "rgba(255,255,255,.35)",
            font: `700 15px ${DISPLAY}`,
            letterSpacing: 2,
          }}
        >
          REAL PRODUCT SCREEN
        </span>
      </div>
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          top: 40 + (height - 40 - imageHeight) / 2,
          left: baseLeft + Math.sin(frame / 50) * 16,
          width: imageWidth,
          height: imageHeight,
          objectFit: "cover",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(120deg, transparent 40%, rgba(255,255,255,.10) 50%, transparent 60%)",
          translate: `${interpolate(frame, [24, 115], [-900, 1000], clamp)}px 0`,
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
};

const GithubRepoCard = ({ showStar = false }: { showStar?: boolean }) => {
  const frame = useCurrentFrame();
  const p = inProgress(frame, 20, 24);
  return (
    <Card
      style={{
        padding: "36px 34px",
        opacity: p,
        translate: `0 ${interpolate(p, [0, 1], [38, 0])}px`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            display: "grid",
            placeItems: "center",
            background: CREAM,
            color: INK,
            font: `950 28px ${DISPLAY}`,
          }}
        >
          GH
        </div>
        <div>
          <div style={{ color: MUTED, font: `700 24px ${DISPLAY}` }}>
            drowned-fish1 /
          </div>
          <div style={{ font: `900 38px ${DISPLAY}`, marginTop: 4 }}>
            InkForge-Novel-Studio
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 26,
          color: MUTED,
          font: `650 27px ${FONT}`,
          lineHeight: 1.55,
        }}
      >
        Local-first AI writing cockpit for solo novelists.
      </div>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}
      >
        <Tag>MIT</Tag>
        <Tag tone="gold">WINDOWS</Tag>
        <Tag>V1.0 RC</Tag>
      </div>
      {showStar ? (
        <div
          style={{
            marginTop: 30,
            padding: "20px 28px",
            borderRadius: 18,
            background: CREAM,
            color: INK,
            display: "flex",
            justifyContent: "space-between",
            font: `900 32px ${FONT}`,
            scale: 1 + Math.sin(frame / 9) * 0.012,
          }}
        >
          <span>☆ Star</span>
          <span>先看看，好用再点</span>
        </div>
      ) : null}
    </Card>
  );
};

const FlowCard = ({
  number,
  title,
  detail,
  progress,
}: {
  number: string;
  title: string;
  detail: string;
  progress: number;
}) => (
  <Card
    style={{
      padding: "28px 30px",
      display: "grid",
      gridTemplateColumns: "72px 1fr",
      gap: 22,
      alignItems: "center",
      opacity: progress,
      translate: `${interpolate(progress, [0, 1], [-35, 0])}px 0`,
    }}
  >
    <div
      style={{
        width: 68,
        height: 68,
        borderRadius: 22,
        display: "grid",
        placeItems: "center",
        background: GREEN,
        color: INK,
        font: `950 26px ${DISPLAY}`,
      }}
    >
      {number}
    </div>
    <div>
      <div style={{ font: `900 38px ${FONT}` }}>{title}</div>
      <div style={{ marginTop: 8, color: MUTED, font: `650 25px ${FONT}` }}>
        {detail}
      </div>
    </div>
  </Card>
);

const SceneVisual = ({ index }: { index: number }) => {
  const frame = useCurrentFrame();
  const p = (start: number) => inProgress(frame, start, 20);

  if (index === 0) {
    return (
      <SceneShell index={index}>
        <Title eyebrow="偶然发现" accent="结果越看越不对劲">
          翻 GitHub 时
          <br />
          挖到个怪东西
        </Title>
        <GithubRepoCard />
        <div
          style={{
            alignSelf: "center",
            rotate: "-4deg",
            color: GOLD,
            font: `900 42px ${FONT}`,
            opacity: p(48),
          }}
        >
          “这个设计……有点意思” ↗
        </div>
      </SceneShell>
    );
  }

  if (index === 1) {
    const rewrite = interpolate(frame, [40, 100], [0, 100], clamp);
    return (
      <SceneShell index={index}>
        <Title eyebrow="先说问题" accent="到底谁改了我的稿？">
          点一下生成
          <br />
          正文直接被改
        </Title>
        <Card
          style={{
            padding: 34,
            position: "relative",
            height: 600,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              color: MUTED,
              font: `700 23px ${DISPLAY}`,
              letterSpacing: 3,
            }}
          >
            CHAPTER_07.MD
          </div>
          <div
            style={{
              marginTop: 28,
              font: `650 31px ${FONT}`,
              lineHeight: 1.8,
              color: "rgba(255,249,238,.74)",
            }}
          >
            雨从午夜开始落下。旧城区的灯一盏接一盏熄灭，林岑站在高架桥下，握紧了那封没有署名的信。
          </div>
          <div
            style={{
              position: "absolute",
              left: 34,
              right: 34,
              top: 156,
              height: `${rewrite * 3.3}px`,
              background: "rgba(255,118,110,.22)",
              borderLeft: `7px solid ${RED}`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: 22,
                color: CREAM,
                font: `750 30px ${FONT}`,
                lineHeight: 1.8,
              }}
            >
              AI 已重新组织本段内容，并替换角色行动与环境描写……
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              right: 36,
              bottom: 36,
              color: RED,
              font: `950 62px ${FONT}`,
              rotate: "-7deg",
              opacity: p(86),
            }}
          >
            原稿呢？
          </div>
        </Card>
      </SceneShell>
    );
  }

  if (index === 2) {
    return (
      <SceneShell index={index}>
        <Title eyebrow="反常识设计" accent="AI 想改字，先交提案">
          它不让 AI
          <br />
          直接动正文
        </Title>
        <ProductShot
          src="assets/multi-agent.png"
          focusX={0.8}
          zoom={1.42}
          height={690}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 16,
            opacity: p(58),
          }}
        >
          <Tag tone="gold">PREVIEW DIFF</Tag>
          <Tag>AUTHOR APPROVAL</Tag>
        </div>
      </SceneShell>
    );
  }

  if (index === 3) {
    return (
      <SceneShell index={index}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            opacity: p(0),
          }}
        >
          <Img
            src={staticFile("assets/inkforge-icon.png")}
            style={{ width: 126, height: 126 }}
          />
          <div style={{ font: `950 83px ${DISPLAY}`, letterSpacing: -4 }}>
            INKFORGE
          </div>
        </div>
        <Title
          eyebrow="本地 AI 小说工作台"
          accent="更像一个没最终决定权的实习编辑"
        >
          不是替你
          <br />
          写完整本书
        </Title>
        <ProductShot
          src="assets/workspace-dark.png"
          focusX={0.54}
          zoom={1.22}
          height={610}
        />
      </SceneShell>
    );
  }

  if (index === 4) {
    return (
      <SceneShell index={index}>
        <Title eyebrow="真实工作方式" accent="它先交作业，你再决定">
          AI 只能提议
          <br />
          作者负责拍板
        </Title>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <FlowCard
            number="01"
            title="读取批准的上下文"
            detail="章节 · 人物 · 世界观"
            progress={p(24)}
          />
          <FlowCard
            number="02"
            title="生成可预览的提案"
            detail="改动不会直接进入正文"
            progress={p(42)}
          />
          <FlowCard
            number="03"
            title="接受 · 拒绝 · 回滚"
            detail="最终决定权仍在作者手里"
            progress={p(60)}
          />
        </div>
      </SceneShell>
    );
  }

  if (index === 5) {
    return (
      <SceneShell index={index}>
        <Title eyebrow="我真正喜欢的地方" accent="主动限制 AI 权限">
          大家都在说
          <br />
          AI 能做多少事
        </Title>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            marginTop: 20,
          }}
        >
          <Card style={{ padding: 30, opacity: p(24) }}>
            <div style={{ color: MUTED, font: `800 25px ${DISPLAY}` }}>
              别人强调
            </div>
            <div
              style={{
                marginTop: 20,
                font: `900 46px ${FONT}`,
                lineHeight: 1.35,
              }}
            >
              自动生成
              <br />
              自动改写
              <br />
              自动完成
            </div>
          </Card>
          <Card
            style={{
              padding: 30,
              borderColor: "rgba(111,230,196,.45)",
              opacity: p(42),
            }}
          >
            <div style={{ color: GREEN, font: `800 25px ${DISPLAY}` }}>
              它反而强调
            </div>
            <div
              style={{
                marginTop: 20,
                color: GREEN,
                font: `950 47px ${FONT}`,
                lineHeight: 1.35,
              }}
            >
              不能替你
              <br />
              决定什么
            </div>
          </Card>
        </div>
        <div
          style={{
            marginTop: 22,
            alignSelf: "center",
            color: GOLD,
            font: `900 42px ${FONT}`,
            opacity: p(68),
          }}
        >
          这个边界，很少见。
        </div>
      </SceneShell>
    );
  }

  if (index === 6) {
    const modules = [
      "大纲",
      "分卷",
      "章节",
      "人物",
      "地点",
      "势力",
      "时间线",
      "伏笔",
      "冲突",
    ];
    return (
      <SceneShell index={index}>
        <Title eyebrow="不只管当前一页" accent="整部长篇，放在一个项目里">
          那堆最烦的资料
          <br />
          终于不用散着放
        </Title>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 14,
          }}
        >
          {modules.map((module, item) => (
            <Card
              key={module}
              style={{
                padding: "22px 10px",
                textAlign: "center",
                color: item === 7 ? GOLD : CREAM,
                font: `900 34px ${FONT}`,
                opacity: p(18 + item * 5),
                scale: interpolate(p(18 + item * 5), [0, 1], [0.86, 1]),
              }}
            >
              {module}
            </Card>
          ))}
        </div>
        <ProductShot
          src="assets/workspace-dark.png"
          focusX={0.05}
          zoom={1.58}
          height={460}
        />
      </SceneShell>
    );
  }

  if (index === 7) {
    return (
      <SceneShell index={index}>
        <Title eyebrow="整书质量检查" accent="不是只说一句“写得很好”">
          连续性、角色、节奏
          <br />
          分开检查
        </Title>
        <ProductShot
          src="assets/quality-review.png"
          focusX={0.42}
          zoom={1.32}
          height={660}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 14,
            opacity: p(60),
          }}
        >
          <Tag>保存基线</Tag>
          <Tag tone="gold">检查有没有写崩</Tag>
        </div>
      </SceneShell>
    );
  }

  if (index === 8) {
    const rows = [
      "chapters/",
      "outline.json",
      "characters.json",
      "history/",
      "backups/",
    ];
    return (
      <SceneShell index={index}>
        <Title eyebrow="我以为又要上云" accent="结果核心工作流不用账号">
          稿子留在
          <br />
          你自己的文件夹
        </Title>
        <Card style={{ padding: 34, opacity: p(22) }}>
          <div
            style={{
              color: GREEN,
              font: `850 24px ${DISPLAY}`,
              letterSpacing: 3,
            }}
          >
            D:\MY-NOVEL\
          </div>
          <div
            style={{
              marginTop: 22,
              display: "flex",
              flexDirection: "column",
              gap: 15,
            }}
          >
            {rows.map((row, item) => (
              <div
                key={row}
                style={{
                  color: item === 0 ? GOLD : CREAM,
                  font: `750 36px ${DISPLAY}`,
                  opacity: p(30 + item * 7),
                }}
              >
                {item < 3 ? "├─" : item === rows.length - 1 ? "└─" : "├─"} {row}
              </div>
            ))}
          </div>
        </Card>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 14, opacity: p(70) }}
        >
          <Tag tone="red">账号 ×</Tag>
          <Tag tone="red">会员 ×</Tag>
          <Tag tone="red">强制上云 ×</Tag>
        </div>
      </SceneShell>
    );
  }

  if (index === 9) {
    return (
      <SceneShell index={index}>
        <Title eyebrow="AI 不是强制项" accent="不开模型，核心功能照样能用">
          需要的时候
          <br />
          再把 AI 接进来
        </Title>
        <Card style={{ padding: 36, opacity: p(20) }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ color: MUTED, font: `750 25px ${FONT}` }}>
                AI PROVIDER
              </div>
              <div style={{ marginTop: 8, font: `900 44px ${FONT}` }}>
                可选，不绑死
              </div>
            </div>
            <div
              style={{
                width: 116,
                height: 58,
                borderRadius: 60,
                padding: 7,
                background: frame > 62 ? GREEN : "rgba(255,255,255,.16)",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 44,
                  background: CREAM,
                  translate: `${frame > 62 ? 58 : 0}px 0`,
                }}
              />
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              marginTop: 34,
            }}
          >
            {[
              "OpenAI-compatible",
              "Ollama / local model",
              "Gemini / DeepSeek / gateways",
            ].map((provider, item) => (
              <div
                key={provider}
                style={{
                  padding: "19px 22px",
                  borderRadius: 16,
                  background: "rgba(255,255,255,.055)",
                  font: `750 29px ${DISPLAY}`,
                  opacity: p(35 + item * 10),
                }}
              >
                {provider}
              </div>
            ))}
          </div>
        </Card>
        <div
          style={{
            color: GREEN,
            font: `900 39px ${FONT}`,
            textAlign: "center",
            opacity: p(74),
          }}
        >
          这个边界，我个人挺喜欢。
        </div>
      </SceneShell>
    );
  }

  if (index === 10) {
    const formats = ["MD", "TXT", "DOCX", "EPUB 3"];
    return (
      <SceneShell index={index}>
        <Title eyebrow="写完以后" accent="导出、备份、恢复也没落下">
          连交付都替你
          <br />
          想得挺细
        </Title>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          {formats.map((format, item) => (
            <Card
              key={format}
              style={{
                padding: "30px 22px",
                textAlign: "center",
                opacity: p(20 + item * 9),
              }}
            >
              <div
                style={{
                  color: item === 3 ? GOLD : GREEN,
                  font: `950 51px ${DISPLAY}`,
                }}
              >
                {format}
              </div>
              <div
                style={{ marginTop: 8, color: MUTED, font: `700 22px ${FONT}` }}
              >
                {item === 3 ? "目录 · 封面 · 排版" : "直接带走"}
              </div>
            </Card>
          ))}
        </div>
        <Card
          style={{
            padding: 28,
            display: "flex",
            justifyContent: "space-between",
            font: `850 31px ${FONT}`,
            opacity: p(62),
          }}
        >
          <span>自动快照</span>
          <span>完整性验证</span>
          <span>受保护恢复</span>
        </Card>
        <div
          style={{
            alignSelf: "center",
            color: GOLD,
            font: `900 38px ${FONT}`,
            rotate: "-3deg",
            opacity: p(84),
          }}
        >
          做它的人，明显被长篇折磨过 ☕
        </div>
      </SceneShell>
    );
  }

  if (index === 11) {
    return (
      <SceneShell index={index}>
        <Title eyebrow="先别急着夸" accent="这些限制必须说清楚">
          它现在
          <br />
          还不算完美
        </Title>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <FlowCard
            number="01"
            title="仍是发布候选版本"
            detail="V1.0 RC，不是成熟商业软件"
            progress={p(20)}
          />
          <FlowCard
            number="02"
            title="主要支持 Windows"
            detail="其他平台可以看浏览器预览"
            progress={p(38)}
          />
          <FlowCard
            number="03"
            title="公开安装包未签名"
            detail="第一次运行可能触发系统提示"
            progress={p(56)}
          />
          <FlowCard
            number="04"
            title="需要一点学习成本"
            detail="功能多，不是极简记事本"
            progress={p(74)}
          />
        </div>
      </SceneShell>
    );
  }

  if (index === 12) {
    return (
      <SceneShell index={index}>
        <Title eyebrow="它不适合所有人" accent="但目标用户非常明确">
          你到底需不需要
          <br />
          这种工具？
        </Title>
        <Card
          style={{
            padding: 34,
            opacity: p(24),
            borderColor: "rgba(255,118,110,.32)",
          }}
        >
          <div
            style={{
              color: RED,
              font: `900 28px ${DISPLAY}`,
              letterSpacing: 2,
            }}
          >
            可能有点重
          </div>
          <div style={{ marginTop: 14, font: `900 46px ${FONT}` }}>
            偶尔让 AI 写几百字
          </div>
        </Card>
        <Card
          style={{
            padding: 38,
            opacity: p(48),
            borderColor: "rgba(111,230,196,.52)",
            background: "rgba(111,230,196,.10)",
          }}
        >
          <div
            style={{
              color: GREEN,
              font: `900 28px ${DISPLAY}`,
              letterSpacing: 2,
            }}
          >
            值得认真看看
          </div>
          <div
            style={{
              marginTop: 14,
              font: `950 50px ${FONT}`,
              lineHeight: 1.35,
            }}
          >
            真正在写长篇
            <br />
            在意本地、追踪、回滚
          </div>
        </Card>
      </SceneShell>
    );
  }

  if (index === 13) {
    return (
      <SceneShell index={index}>
        <Title eyebrow="项目是开源的" accent="感兴趣，自己进去看看">
          名字叫
          <br />
          <span style={{ color: GREEN }}>InkForge</span>
        </Title>
        <GithubRepoCard showStar />
        <div
          style={{
            textAlign: "center",
            color: MUTED,
            font: `750 26px ${DISPLAY}`,
            lineHeight: 1.45,
            opacity: p(70),
          }}
        >
          github.com/drowned-fish1/
          <br />
          InkForge-Novel-Studio
        </div>
      </SceneShell>
    );
  }

  return (
    <SceneShell index={index}>
      <div style={{ display: "flex", justifyContent: "center", opacity: p(0) }}>
        <Img
          src={staticFile("assets/inkforge-icon.png")}
          style={{ width: 150, height: 150 }}
        />
      </div>
      <Title eyebrow="最后一个想法" align="center">
        让 AI 先问一句
        <br />
        <span style={{ color: GREEN }}>再动笔</span>
      </Title>
      <ProductShot
        src="assets/workspace-dark.png"
        focusX={0.5}
        zoom={1.48}
        height={600}
      />
      <div
        style={{
          alignSelf: "center",
          color: GOLD,
          font: `900 43px ${FONT}`,
          opacity: p(66),
        }}
      >
        我觉得，这个方向挺对。
      </div>
    </SceneShell>
  );
};

export const InkForgeLongformSoftAd = ({ timeline }: LongformSoftAdProps) => {
  if (!timeline || timeline.scenes.length !== 15) return null;
  const transitionTiming = linearTiming({
    durationInFrames: timeline.transitionDurationInFrames,
  });
  const visualChildren: ReactNode[] = [];
  timeline.scenes.forEach((scene, index) => {
    if (index > 0) {
      visualChildren.push(
        <TransitionSeries.Transition
          key={`transition-${scene.id}`}
          presentation={fade()}
          timing={transitionTiming}
        />,
      );
    }
    visualChildren.push(
      <TransitionSeries.Sequence
        key={scene.id}
        durationInFrames={scene.sceneDurationInFrames}
      >
        <SceneVisual index={index} />
      </TransitionSeries.Sequence>,
    );
  });

  return (
    <AbsoluteFill style={{ background: INK, fontFamily: FONT }}>
      {timeline.scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.voiceStartFrame}
          durationInFrames={scene.voiceEndFrame - scene.voiceStartFrame + 2}
          premountFor={timeline.fps}
        >
          <Audio src={staticFile(scene.src)} volume={1} playbackRate={1} />
        </Sequence>
      ))}
      <TransitionSeries>{visualChildren}</TransitionSeries>
      <LongformCaptionOverlay />
    </AbsoluteFill>
  );
};
