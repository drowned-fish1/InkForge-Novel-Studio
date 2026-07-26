export interface PaneWidths {
  navigation: number;
  agent: number;
}

export type ResizablePane = "navigation" | "agent";

export const DEFAULT_PANE_WIDTHS: PaneWidths = {
  navigation: 244,
  agent: 344
};

export const PANE_LIMITS = {
  navigation: {
    min: 216,
    max: 380
  },
  agent: {
    min: 320,
    max: 620
  },
  editorMin: 520,
  handleWidth: 6
} as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const fitPaneWidths = (widths: PaneWidths, containerWidth: number): PaneWidths => {
  let navigation = clamp(widths.navigation, PANE_LIMITS.navigation.min, PANE_LIMITS.navigation.max);
  let agent = clamp(widths.agent, PANE_LIMITS.agent.min, PANE_LIMITS.agent.max);
  const minimumSideWidth = PANE_LIMITS.navigation.min + PANE_LIMITS.agent.min;
  const availableSideWidth = Math.max(
    minimumSideWidth,
    containerWidth - PANE_LIMITS.editorMin - PANE_LIMITS.handleWidth * 2
  );

  if (navigation + agent <= availableSideWidth) {
    return { navigation: Math.floor(navigation), agent: Math.floor(agent) };
  }

  const navigationFlexible = navigation - PANE_LIMITS.navigation.min;
  const agentFlexible = agent - PANE_LIMITS.agent.min;
  const totalFlexible = navigationFlexible + agentFlexible;
  const allowedFlexible = Math.max(0, availableSideWidth - minimumSideWidth);
  const scale = totalFlexible > 0 ? allowedFlexible / totalFlexible : 0;

  navigation = PANE_LIMITS.navigation.min + navigationFlexible * scale;
  agent = PANE_LIMITS.agent.min + agentFlexible * scale;

  return { navigation: Math.floor(navigation), agent: Math.floor(agent) };
};

export const resizePaneFromPointer = (
  pane: ResizablePane,
  current: PaneWidths,
  containerWidth: number,
  pointerOffset: number
): PaneWidths => {
  const requested =
    pane === "navigation"
      ? { ...current, navigation: pointerOffset }
      : { ...current, agent: containerWidth - pointerOffset };

  return fitPaneWidths(requested, containerWidth);
};
