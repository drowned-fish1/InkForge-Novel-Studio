import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, StateEffect, StateField, Compartment, RangeSetBuilder, Prec } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  type DecorationSet
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";

export interface EditorMark {
  id: string;
  start: number;
  end: number;
  kind: "comment" | "revision";
  resolved: boolean;
}

export interface FindHighlight {
  ranges: Array<{ from: number; to: number }>;
  activeIndex: number;
}

export interface MarkdownCodeEditorHandle {
  focus: () => void;
  getSelection: () => { from: number; to: number };
  setSelection: (from: number, to?: number, center?: boolean) => void;
  wrapSelection: (before: string, after?: string) => void;
  prefixLines: (prefix: string) => void;
}

interface MarkdownCodeEditorProps {
  chapterKey: string;
  value: string;
  placeholder?: string;
  marks: EditorMark[];
  find?: FindHighlight;
  typewriter: boolean;
  paragraphFocus: boolean;
  onChange: (value: string) => void;
  onSelectionChange: (from: number, to: number) => void;
  onOpenFind: () => void;
}

const setMarksEffect = StateEffect.define<EditorMark[]>();
const setFindEffect = StateEffect.define<FindHighlight | undefined>();

const clampRange = (from: number, to: number, docLength: number) => ({
  from: Math.max(0, Math.min(from, docLength)),
  to: Math.max(0, Math.min(to, docLength))
});

const buildMarkDecorations = (marks: EditorMark[], docLength: number): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...marks].sort((left, right) => left.start - right.start || left.end - right.end);
  for (const mark of sorted) {
    const { from, to } = clampRange(mark.start, mark.end, docLength);
    if (to <= from) {
      continue;
    }
    builder.add(
      from,
      to,
      Decoration.mark({
        class: `cm-anno cm-anno-${mark.kind}${mark.resolved ? " cm-anno-resolved" : ""}`,
        attributes: { title: mark.kind === "revision" ? "待修改标记" : "批注" }
      })
    );
  }
  return builder.finish();
};

const buildFindDecorations = (find: FindHighlight | undefined, docLength: number): DecorationSet => {
  if (!find?.ranges.length) {
    return Decoration.none;
  }
  const builder = new RangeSetBuilder<Decoration>();
  find.ranges.forEach((range, index) => {
    const { from, to } = clampRange(range.from, range.to, docLength);
    if (to <= from) {
      return;
    }
    builder.add(
      from,
      to,
      Decoration.mark({ class: index === find.activeIndex ? "cm-find cm-find-active" : "cm-find" })
    );
  });
  return builder.finish();
};

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setMarksEffect)) {
        next = buildMarkDecorations(effect.value, tr.newDoc.length);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const findField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFindEffect)) {
        next = buildFindDecorations(effect.value, tr.newDoc.length);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

/** Dims every line outside the paragraph (blank-line delimited) that holds the cursor. */
const paragraphFocusExtension = EditorView.decorations.compute(["doc", "selection"], (state) => {
  const doc = state.doc;
  const head = state.selection.main.head;
  const headLine = doc.lineAt(head).number;
  let start = headLine;
  while (start > 1 && doc.line(start - 1).text.trim() !== "") {
    start -= 1;
  }
  let end = headLine;
  while (end < doc.lines && doc.line(end + 1).text.trim() !== "") {
    end += 1;
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    if (lineNumber < start || lineNumber > end) {
      builder.add(doc.line(lineNumber).from, doc.line(lineNumber).from, Decoration.line({ class: "cm-para-dim" }));
    }
  }
  return builder.finish();
});

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--editor-font-size, 18px)",
    backgroundColor: "transparent"
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.9",
    overflow: "auto"
  },
  ".cm-content": {
    padding: "18px 20px 40vh",
    caretColor: "var(--text)"
  },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0 2px" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--text-secondary)",
    opacity: "0.55",
    fontSize: "12px"
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-selectionBackground": { backgroundColor: "var(--surface-hover) !important" }
});

export const MarkdownCodeEditor = forwardRef<MarkdownCodeEditorHandle, MarkdownCodeEditorProps>(
  function MarkdownCodeEditor(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    const paragraphFocusCompartment = useRef(new Compartment());

    useImperativeHandle(ref, () => ({
      focus: () => viewRef.current?.focus(),
      getSelection: () => {
        const main = viewRef.current?.state.selection.main;
        return main ? { from: main.from, to: main.to } : { from: 0, to: 0 };
      },
      setSelection: (from, to = from, center = false) => {
        const view = viewRef.current;
        if (!view) {
          return;
        }
        const clamped = clampRange(from, to, view.state.doc.length);
        view.focus();
        view.dispatch({
          selection: { anchor: clamped.from, head: clamped.to },
          effects: EditorView.scrollIntoView(clamped.from, center ? { y: "center" } : {})
        });
      },
      wrapSelection: (before, after = before) => {
        const view = viewRef.current;
        if (!view) {
          return;
        }
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: [
            { from, insert: before },
            { from: to, insert: after }
          ],
          selection: { anchor: from + before.length, head: to + before.length }
        });
        view.focus();
      },
      prefixLines: (prefix) => {
        const view = viewRef.current;
        if (!view) {
          return;
        }
        const { from, to } = view.state.selection.main;
        const startLine = view.state.doc.lineAt(from);
        const endLine = view.state.doc.lineAt(Math.max(from, to));
        const changes = [];
        for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
          changes.push({ from: view.state.doc.line(lineNumber).from, insert: prefix });
        }
        view.dispatch({ changes });
        view.focus();
      }
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const shortcutKeys = new Set(["b", "i", "f"]);
      const state = EditorState.create({
        doc: propsRef.current.value,
        extensions: [
          history(),
          lineNumbers(),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          editorTheme,
          marksField,
          findField,
          paragraphFocusCompartment.current.of(propsRef.current.paragraphFocus ? paragraphFocusExtension : []),
          cmPlaceholder(propsRef.current.placeholder ?? ""),
          EditorView.contentAttributes.of({ spellcheck: "true", lang: "zh-CN" }),
          Prec.high(
            keymap.of([
              {
                key: "Mod-b",
                run: (view) => {
                  const { from, to } = view.state.selection.main;
                  view.dispatch({
                    changes: [
                      { from, insert: "**" },
                      { from: to, insert: "**" }
                    ],
                    selection: { anchor: from + 2, head: to + 2 }
                  });
                  return true;
                }
              },
              {
                key: "Mod-i",
                run: (view) => {
                  const { from, to } = view.state.selection.main;
                  view.dispatch({
                    changes: [
                      { from, insert: "*" },
                      { from: to, insert: "*" }
                    ],
                    selection: { anchor: from + 1, head: to + 1 }
                  });
                  return true;
                }
              },
              {
                key: "Mod-f",
                run: () => {
                  propsRef.current.onOpenFind();
                  return true;
                }
              }
            ])
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              propsRef.current.onChange(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              const main = update.state.selection.main;
              propsRef.current.onSelectionChange(main.from, main.to);
              const userDriven = update.transactions.some(
                (tr) => tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("select")
              );
              if (propsRef.current.typewriter && userDriven) {
                const head = main.head;
                window.requestAnimationFrame(() => {
                  viewRef.current?.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
                });
              }
            }
          })
        ]
      });
      const view = new EditorView({ state, parent: container });
      viewRef.current = view;
      // Keep editor shortcuts from reaching the global window handler
      // (Ctrl+B outside the editor toggles focus mode). The container sits on
      // the bubble path between the editor content and window, so stopping
      // here is independent of CodeMirror's internal handler ordering.
      const stopEditorShortcuts = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && shortcutKeys.has(event.key.toLowerCase())) {
          event.stopPropagation();
        }
      };
      container.addEventListener("keydown", stopEditorShortcuts);
      view.dispatch({ effects: setMarksEffect.of(propsRef.current.marks) });
      if (propsRef.current.find) {
        view.dispatch({ effects: setFindEffect.of(propsRef.current.find) });
      }
      return () => {
        container.removeEventListener("keydown", stopEditorShortcuts);
        view.destroy();
        viewRef.current = null;
      };
      // The editor state is intentionally recreated per chapter so undo
      // history never crosses chapter boundaries.
    }, [props.chapterKey]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) {
        return;
      }
      const current = view.state.doc.toString();
      if (current !== props.value) {
        // External update (history restore, agent write, recovery draft).
        const selection = view.state.selection.main;
        const anchor = Math.min(selection.anchor, props.value.length);
        view.dispatch({
          changes: { from: 0, to: current.length, insert: props.value },
          selection: { anchor }
        });
      }
    }, [props.value]);

    useEffect(() => {
      viewRef.current?.dispatch({ effects: setMarksEffect.of(props.marks) });
    }, [props.marks]);

    useEffect(() => {
      viewRef.current?.dispatch({ effects: setFindEffect.of(props.find) });
    }, [props.find]);

    useEffect(() => {
      viewRef.current?.dispatch({
        effects: paragraphFocusCompartment.current.reconfigure(props.paragraphFocus ? paragraphFocusExtension : [])
      });
    }, [props.paragraphFocus]);

    return <div className="markdown-code-editor" ref={containerRef} />;
  }
);
