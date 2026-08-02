export interface ProseStyleMetrics {
  characterCount: number;
  sentenceCount: number;
  paragraphCount: number;
  dialogueCharacters: number;
  dialogueRatio: number;
  averageSentenceLength: number;
  sentenceLengthDeviation: number;
  averageParagraphLength: number;
  punctuation: Record<string, number>;
  connectorFrequency: Record<string, number>;
}

export interface StyleMetricDelta {
  metric: string;
  baseline: number;
  actual: number;
  relativeDelta: number;
  severity: "info" | "warning";
}

export interface StyleDriftReport {
  score: number;
  deltas: StyleMetricDelta[];
  warnings: string[];
}

const sentenceEndPattern = /[。！？!?]+/gu;
const dialoguePattern = /[“「『]([^”」』]*)[”」』]/gu;
const punctuationMarks = ["，", "。", "！", "？", "；", "：", "……", "——"] as const;
const commonConnectors = ["但是", "然而", "于是", "因此", "随后", "忽然", "然后", "与此同时"] as const;

const round = (value: number, digits = 3): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const visibleLength = (value: string): number => [...value.replace(/\s/gu, "")].length;

const occurrences = (value: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
};

export const analyzeProseStyle = (text: string): ProseStyleMetrics => {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  const paragraphs = normalized
    ? normalized
        .split(/\n\s*\n+/gu)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const sentences = normalized
    ? normalized
        .split(sentenceEndPattern)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const sentenceLengths = sentences.map(visibleLength);
  const averageSentenceLength = sentenceLengths.length
    ? sentenceLengths.reduce((total, value) => total + value, 0) / sentenceLengths.length
    : 0;
  const variance = sentenceLengths.length
    ? sentenceLengths.reduce((total, value) => total + (value - averageSentenceLength) ** 2, 0) / sentenceLengths.length
    : 0;
  const characterCount = visibleLength(normalized);
  const dialogueCharacters = [...normalized.matchAll(dialoguePattern)].reduce(
    (total, match) => total + visibleLength(match[1] ?? ""),
    0
  );
  const units = Math.max(1, characterCount / 1000);

  return {
    characterCount,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    dialogueCharacters,
    dialogueRatio: round(characterCount ? dialogueCharacters / characterCount : 0),
    averageSentenceLength: round(averageSentenceLength),
    sentenceLengthDeviation: round(Math.sqrt(variance)),
    averageParagraphLength: round(
      paragraphs.length ? paragraphs.reduce((total, value) => total + visibleLength(value), 0) / paragraphs.length : 0
    ),
    punctuation: Object.fromEntries(
      punctuationMarks.map((mark) => [mark, round(occurrences(normalized, mark) / units)])
    ),
    connectorFrequency: Object.fromEntries(
      commonConnectors.map((connector) => [connector, round(occurrences(normalized, connector) / units)])
    )
  };
};

/** Merge chapter-level measurements without retaining the full manuscript in memory. */
export const mergeProseStyleMetrics = (items: ProseStyleMetrics[]): ProseStyleMetrics => {
  if (!items.length) return analyzeProseStyle("");
  const characterCount = items.reduce((total, item) => total + item.characterCount, 0);
  const sentenceCount = items.reduce((total, item) => total + item.sentenceCount, 0);
  const paragraphCount = items.reduce((total, item) => total + item.paragraphCount, 0);
  const dialogueCharacters = items.reduce((total, item) => total + item.dialogueCharacters, 0);
  const averageSentenceLength = sentenceCount
    ? items.reduce((total, item) => total + item.averageSentenceLength * item.sentenceCount, 0) / sentenceCount
    : 0;
  const pooledVariance = sentenceCount
    ? items.reduce(
        (total, item) =>
          total +
          item.sentenceCount *
            (item.sentenceLengthDeviation ** 2 + (item.averageSentenceLength - averageSentenceLength) ** 2),
        0
      ) / sentenceCount
    : 0;
  const keys = (field: "punctuation" | "connectorFrequency") => [
    ...new Set(items.flatMap((item) => Object.keys(item[field])))
  ];
  const mergeFrequency = (field: "punctuation" | "connectorFrequency") =>
    Object.fromEntries(
      keys(field).map((key) => [
        key,
        round(
          characterCount
            ? items.reduce((total, item) => total + (item[field][key] ?? 0) * item.characterCount, 0) / characterCount
            : 0
        )
      ])
    );
  return {
    characterCount,
    sentenceCount,
    paragraphCount,
    dialogueCharacters,
    dialogueRatio: round(characterCount ? dialogueCharacters / characterCount : 0),
    averageSentenceLength: round(averageSentenceLength),
    sentenceLengthDeviation: round(Math.sqrt(pooledVariance)),
    averageParagraphLength: round(
      paragraphCount
        ? items.reduce((total, item) => total + item.averageParagraphLength * item.paragraphCount, 0) / paragraphCount
        : 0
    ),
    punctuation: mergeFrequency("punctuation"),
    connectorFrequency: mergeFrequency("connectorFrequency")
  };
};

interface DriftMetric {
  name: string;
  baseline: number;
  actual: number;
  warningThreshold: number;
  weight: number;
}

export const compareProseStyle = (
  baseline: ProseStyleMetrics,
  actual: ProseStyleMetrics,
  tolerance = 0.35
): StyleDriftReport => {
  const metrics: DriftMetric[] = [
    {
      name: "平均句长",
      baseline: baseline.averageSentenceLength,
      actual: actual.averageSentenceLength,
      warningThreshold: tolerance,
      weight: 0.25
    },
    {
      name: "句长波动",
      baseline: baseline.sentenceLengthDeviation,
      actual: actual.sentenceLengthDeviation,
      warningThreshold: tolerance + 0.1,
      weight: 0.15
    },
    {
      name: "平均段长",
      baseline: baseline.averageParagraphLength,
      actual: actual.averageParagraphLength,
      warningThreshold: tolerance + 0.15,
      weight: 0.2
    },
    {
      name: "对白占比",
      baseline: baseline.dialogueRatio,
      actual: actual.dialogueRatio,
      warningThreshold: tolerance + 0.1,
      weight: 0.25
    }
  ];

  for (const mark of punctuationMarks) {
    metrics.push({
      name: `标点 ${mark}`,
      baseline: baseline.punctuation[mark] ?? 0,
      actual: actual.punctuation[mark] ?? 0,
      warningThreshold: tolerance + 0.2,
      weight: 0.15 / punctuationMarks.length
    });
  }

  const deltas = metrics.map((metric): StyleMetricDelta => {
    const denominator = Math.max(Math.abs(metric.baseline), 0.05);
    const relativeDelta = Math.abs(metric.actual - metric.baseline) / denominator;
    return {
      metric: metric.name,
      baseline: round(metric.baseline),
      actual: round(metric.actual),
      relativeDelta: round(relativeDelta),
      severity: relativeDelta > metric.warningThreshold ? "warning" : "info"
    };
  });
  const weightedDrift = metrics.reduce((total, metric) => {
    const denominator = Math.max(Math.abs(metric.baseline), 0.05);
    return total + Math.min(1, Math.abs(metric.actual - metric.baseline) / denominator) * metric.weight;
  }, 0);
  const weightTotal = metrics.reduce((total, metric) => total + metric.weight, 0);
  const score = Math.max(0, Math.round(100 * (1 - weightedDrift / Math.max(weightTotal, 0.01))));
  const warnings = deltas
    .filter((delta) => delta.severity === "warning")
    .map(
      (delta) =>
        `${delta.metric}偏离基线 ${Math.round(delta.relativeDelta * 100)}%（基线 ${delta.baseline}，当前 ${delta.actual}）。`
    );
  return { score, deltas, warnings };
};
