import { describe, expect, it } from "vitest";
import { DEFAULT_PANE_WIDTHS, fitPaneWidths, PANE_LIMITS, resizePaneFromPointer } from "./paneLayout";

describe("paneLayout", () => {
  it("keeps the default layout when enough space is available", () => {
    expect(fitPaneWidths(DEFAULT_PANE_WIDTHS, 1440)).toEqual(DEFAULT_PANE_WIDTHS);
  });

  it("preserves the minimum editor width in a narrow window", () => {
    const fitted = fitPaneWidths({ navigation: 420, agent: 720 }, 1080);
    const editorWidth = 1080 - fitted.navigation - fitted.agent - PANE_LIMITS.handleWidth * 2;

    expect(fitted.navigation).toBeGreaterThanOrEqual(PANE_LIMITS.navigation.min);
    expect(fitted.agent).toBeGreaterThanOrEqual(PANE_LIMITS.agent.min);
    expect(editorWidth).toBeGreaterThanOrEqual(PANE_LIMITS.editorMin);
  });

  it("resizes each outer pane from its adjacent separator", () => {
    expect(resizePaneFromPointer("navigation", DEFAULT_PANE_WIDTHS, 1440, 320).navigation).toBe(320);
    expect(resizePaneFromPointer("agent", DEFAULT_PANE_WIDTHS, 1440, 940).agent).toBe(500);
  });

  it("clamps pointer resizing to safe pane bounds", () => {
    const navigation = resizePaneFromPointer("navigation", DEFAULT_PANE_WIDTHS, 1440, 20);
    const agent = resizePaneFromPointer("agent", DEFAULT_PANE_WIDTHS, 1440, 20);

    expect(navigation.navigation).toBe(PANE_LIMITS.navigation.min);
    expect(agent.agent).toBeLessThanOrEqual(PANE_LIMITS.agent.max);
  });
});
