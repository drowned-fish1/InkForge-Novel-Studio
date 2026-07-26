export interface TextDiffLine {
  kind: "context" | "add" | "remove";
  text: string;
}

const maxLcsCells = 4_000_000;

/**
 * Line diff used by restore previews. Falls back to a prefix/suffix trimmed
 * replace-diff when the LCS matrix would exceed the memory guard.
 */
export const diffTextLines = (before: string, after: string): TextDiffLine[] => {
  const left = before.split(/\r?\n/u);
  const right = after.split(/\r?\n/u);

  if (left.length * right.length > maxLcsCells) {
    return fallbackDiff(left, right);
  }

  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = left[i] === right[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }
  const result: TextDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: "context", text: left[i] });
      i += 1;
      j += 1;
    } else if (j < right.length && (i === left.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      result.push({ kind: "add", text: right[j] });
      j += 1;
    } else {
      result.push({ kind: "remove", text: left[i] });
      i += 1;
    }
  }
  return result;
};

const fallbackDiff = (left: string[], right: string[]): TextDiffLine[] => {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return [
    ...left.slice(0, prefix).map((text): TextDiffLine => ({ kind: "context", text })),
    ...left.slice(prefix, left.length - suffix).map((text): TextDiffLine => ({ kind: "remove", text })),
    ...right.slice(prefix, right.length - suffix).map((text): TextDiffLine => ({ kind: "add", text })),
    ...left.slice(left.length - suffix).map((text): TextDiffLine => ({ kind: "context", text }))
  ];
};

export const summarizeDiff = (lines: TextDiffLine[]): { added: number; removed: number } => ({
  added: lines.filter((line) => line.kind === "add").length,
  removed: lines.filter((line) => line.kind === "remove").length
});
