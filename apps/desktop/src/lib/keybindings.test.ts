import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeybindingHandler } from "./keybindings";

const actions = () => ({
  save: vi.fn(),
  createChapter: vi.fn(),
  createVolume: vi.fn(),
  exportMarkdown: vi.fn(),
  toggleFocusMode: vi.fn(),
  exitFocusMode: vi.fn(),
  closeSettings: vi.fn(() => false),
  switchModule: vi.fn()
});
const keyEvent = (patch: Partial<KeyboardEvent> = {}) =>
  ({
    key: "n",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    target: null,
    preventDefault: vi.fn(),
    ...patch
  }) as unknown as KeyboardEvent;

describe("shortcuts respect local editors", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("does not create a chapter from a repeated or composing key event", () => {
    const handlers = actions();
    const handle = createKeybindingHandler(handlers);
    handle(keyEvent({ repeat: true }));
    handle(keyEvent({ isComposing: true }));
    expect(handlers.createChapter).not.toHaveBeenCalled();
  });
  it("does not handle shortcuts already consumed by an editor or modal", () => {
    const handlers = actions();
    const handle = createKeybindingHandler(handlers);
    handle(keyEvent({ key: "s", defaultPrevented: true }));
    handle(keyEvent({ key: "Escape", defaultPrevented: true }));
    expect(handlers.save).not.toHaveBeenCalled();
    expect(handlers.closeSettings).not.toHaveBeenCalled();
    expect(handlers.exitFocusMode).not.toHaveBeenCalled();
  });
  it("leaves Ctrl+B in a text field instead of switching the whole workspace", () => {
    class TextElement {
      closest() {
        return this;
      }
    }
    vi.stubGlobal("Element", TextElement);
    const handlers = actions();
    const event = keyEvent({ key: "b", target: new TextElement() as unknown as EventTarget });
    createKeybindingHandler(handlers)(event);
    expect(handlers.toggleFocusMode).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
