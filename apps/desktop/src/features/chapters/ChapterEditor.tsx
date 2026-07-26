import {
  Bold,
  Bookmark,
  ChevronDown,
  CircleDot,
  Eye,
  Heading2,
  History,
  Italic,
  MessageSquareText,
  Minimize2,
  PencilLine,
  Replace,
  RotateCcw,
  Search,
  Trash2,
  Wand2
} from "lucide-react";
import { marked } from "marked";
import type { Character, Term, WritingWorkspace } from "@inkforge/schemas";
import type { MouseEvent } from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ScenePlanner } from "@/features/agent/ScenePlanner";
import { bridge } from "@/lib/browserBridge";
import { countCjkAwareWords } from "@/lib/textMetrics";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";

const chapterStatusLabels = {
  unplanned: "未规划",
  planned: "已规划",
  drafting: "草稿中",
  revising: "待修改",
  done: "完成"
} as const;

type EditorTab = "write" | "preview";
type SupportTab = "scenes" | "details" | "notes" | "history";

const MAX_RENDERED_LINE_NUMBERS = 3000;

interface ReferenceEntry {
  id: string;
  name: string;
  title: string;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const writingWorkspaceMutations = new Map<string, Promise<void>>();

const mutateWritingWorkspace = (
  projectPath: string,
  update: (workspace: WritingWorkspace) => WritingWorkspace
): Promise<WritingWorkspace> => {
  const previous = writingWorkspaceMutations.get(projectPath) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const latest = await bridge.loadWritingWorkspace(projectPath);
      return bridge.saveWritingWorkspace(projectPath, update(latest));
    });
  const settled = operation.then(
    () => undefined,
    () => undefined
  );
  writingWorkspaceMutations.set(projectPath, settled);
  void settled.finally(() => {
    if (writingWorkspaceMutations.get(projectPath) === settled) {
      writingWorkspaceMutations.delete(projectPath);
    }
  });
  return operation;
};

const slugifyHeading = (value: string, fallback: number) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return slug || `heading-${fallback}`;
};

const buildReferenceEntries = (characters: Character[], terms: Term[]): ReferenceEntry[] => {
  const seen = new Set<string>();
  const entries: ReferenceEntry[] = [];
  const push = (id: string, name: string, title: string) => {
    const normalized = name.trim();
    const key = normalized.toLocaleLowerCase("zh-CN");
    if (normalized.length < 2 || seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push({ id, name: normalized, title });
  };

  characters.forEach((character) => {
    const title = `人物：${character.name}`;
    push(`character-${character.id}`, character.name, title);
    character.aliases.forEach((alias) => push(`character-${character.id}`, alias, title));
  });
  terms.forEach((term) => {
    const title = term.definition ? `术语：${term.name} - ${term.definition}` : `术语：${term.name}`;
    push(`term-${term.id}`, term.name, title);
    term.aliases.forEach((alias) => push(`term-${term.id}`, alias, title));
  });

  return entries.sort((left, right) => right.name.length - left.name.length);
};

const enhancePreviewHtml = (markdown: string, references: ReferenceEntry[]) => {
  if (typeof document === "undefined") {
    return String(marked.parse(markdown, { async: false }));
  }

  const template = document.createElement("template");
  template.innerHTML = String(marked.parse(markdown, { async: false }));

  template.content
    .querySelectorAll("script, style, iframe, object, embed, meta, base, form, input, button, select, textarea")
    .forEach((node) => node.remove());
  template.content.querySelectorAll<HTMLElement>("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        name === "formaction" ||
        name === "action" ||
        name === "xlink:href" ||
        ((name === "href" || name === "src") && /^(?:javascript|vbscript|data:text\/html):/u.test(value))
      ) {
        element.removeAttribute(attribute.name);
      }
    });
    if (element.tagName === "A") {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noreferrer");
    }
  });

  const usedHeadingIds = new Set<string>();
  template.content.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    const base = slugifyHeading(heading.textContent ?? "", index + 1);
    let id = base;
    let suffix = 2;
    while (usedHeadingIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    usedHeadingIds.add(id);
    heading.id = id;
    heading.tabIndex = 0;
    heading.title = "点击跳转到这个标题";
  });

  if (references.length) {
    const referencePattern = new RegExp(references.map((item) => escapeRegExp(item.name)).join("|"), "gu");
    const referenceByName = new Map(references.map((item) => [item.name, item]));
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent || parent.closest("a, code, pre, textarea, script, style")) {
          return NodeFilter.FILTER_REJECT;
        }
        referencePattern.lastIndex = 0;
        return referencePattern.test(node.textContent ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }
    textNodes.forEach((node) => {
      const text = node.textContent ?? "";
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      referencePattern.lastIndex = 0;
      for (const match of text.matchAll(referencePattern)) {
        const index = match.index ?? 0;
        const entry = referenceByName.get(match[0]);
        if (!entry) {
          continue;
        }
        fragment.append(document.createTextNode(text.slice(cursor, index)));
        const link = document.createElement("a");
        link.className = "preview-reference";
        link.href = `#${entry.id}`;
        link.title = entry.title;
        link.textContent = match[0];
        fragment.append(link);
        cursor = index + match[0].length;
      }
      fragment.append(document.createTextNode(text.slice(cursor)));
      node.replaceWith(fragment);
    });
  }

  return template.innerHTML;
};

const countLines = (content: string): number => {
  if (!content) {
    return 1;
  }
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  return lines;
};

const formatHistoryTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
};

const formatBytes = (size: number): string => (size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`);

const buildParagraphSegments = (content: string, selectionStart: number) => {
  if (!content) {
    return [{ id: "empty", text: "\u00a0", active: true, breakOnly: false }];
  }
  const parts = content.split(/(\n+)/);
  let offset = 0;
  return parts.map((text, index) => {
    const start = offset;
    const end = start + text.length;
    offset = end;
    const active = selectionStart >= start && selectionStart <= end;
    return {
      id: `${index}-${start}`,
      text: text || "\u00a0",
      active,
      breakOnly: /^\n+$/.test(text)
    };
  });
};

export const ChapterEditor = () => {
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const error = useProjectStore((state) => state.error);
  const focusMode = useProjectStore((state) => state.focusMode);
  const setFocusMode = useProjectStore((state) => state.setFocusMode);
  const updateContent = useProjectStore((state) => state.updateContent);
  const updateChapterPlan = useProjectStore((state) => state.updateChapterPlan);
  const moveChapter = useProjectStore((state) => state.moveChapter);
  const chapterHistory = useProjectStore((state) => state.chapterHistory);
  const selectedHistoryId = useProjectStore((state) => state.selectedHistoryId);
  const historyPreview = useProjectStore((state) => state.historyPreview);
  const previewChapterHistory = useProjectStore((state) => state.previewChapterHistory);
  const restoreChapterHistory = useProjectStore((state) => state.restoreChapterHistory);
  const characters = useLibraryStore((state) => state.characters);
  const terms = useLibraryStore((state) => state.terms);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const caretMarkerRef = useRef<HTMLSpanElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("write");
  const [supportTab, setSupportTab] = useState<SupportTab>("scenes");
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [writingWorkspace, setWritingWorkspace] = useState<WritingWorkspace>({
    annotations: [],
    bookmarks: [],
    sessions: []
  });
  const sessionStartedRef = useRef({ chapterId: "", startedAt: Date.now(), initialWords: 0 });
  const [draftMeta, setDraftMeta] = useState({
    title: "",
    goal: "",
    notes: "",
    conflictPoints: "",
    targetWords: "3000"
  });

  useEffect(() => {
    if (!current) {
      return;
    }
    setDraftMeta({
      title: current.plan.title,
      goal: current.plan.goal,
      notes: current.plan.notes,
      conflictPoints: current.plan.conflictPoints,
      targetWords: String(current.plan.targetWords)
    });
    setSelectionStart(0);
  }, [
    current?.plan.id,
    current?.plan.title,
    current?.plan.goal,
    current?.plan.notes,
    current?.plan.conflictPoints,
    current?.plan.targetWords
  ]);

  useEffect(() => {
    if (!project) return;
    void bridge.loadWritingWorkspace(project.projectPath).then(setWritingWorkspace);
  }, [project?.projectPath]);

  useEffect(() => {
    if (!project || !current) return;
    const session = {
      chapterId: current.plan.id,
      startedAt: Date.now(),
      initialWords: countCjkAwareWords(current.content)
    };
    sessionStartedRef.current = session;
    return () => {
      const latest = useProjectStore.getState().current;
      const finalWords =
        latest?.plan.id === session.chapterId ? countCjkAwareWords(latest.content) : session.initialWords;
      const endedAt = Date.now();
      const durationSeconds = Math.round((endedAt - session.startedAt) / 1000);
      if (durationSeconds < 5 && finalWords === session.initialWords) return;
      void mutateWritingWorkspace(project.projectPath, (workspace) => ({
        ...workspace,
        sessions: [
          ...workspace.sessions,
          {
            id: `session-${session.chapterId}-${endedAt}`,
            chapterId: session.chapterId,
            startedAt: new Date(session.startedAt).toISOString(),
            endedAt: new Date(endedAt).toISOString(),
            wordsAdded: finalWords - session.initialWords,
            durationSeconds
          }
        ].slice(-500)
      }));
    };
  }, [project?.projectPath, current?.plan.id]);

  const previewSource = editorTab === "preview" ? (current?.content ?? "") : "";
  const deferredPreviewSource = useDeferredValue(previewSource);
  const references = useMemo(
    () => (editorTab === "preview" ? buildReferenceEntries(characters, terms) : []),
    [characters, editorTab, terms]
  );
  const previewHtml = useMemo(
    () => (editorTab === "preview" ? enhancePreviewHtml(deferredPreviewSource, references) : ""),
    [deferredPreviewSource, editorTab, references]
  );
  const lineCount = useMemo(() => countLines(current?.content ?? ""), [current?.content]);
  const shouldRenderLineNumbers = lineCount <= MAX_RENDERED_LINE_NUMBERS;
  const paragraphSegments = useMemo(
    () => (focusMode && editorTab === "write" ? buildParagraphSegments(current?.content ?? "", selectionStart) : []),
    [current?.content, editorTab, focusMode, selectionStart]
  );
  const caretBefore = focusMode ? (current?.content.slice(0, selectionStart) ?? "") : "";
  const caretAfter = focusMode ? current?.content.slice(selectionStart) || "\u200b" : "";
  const findMatches = useMemo(() => {
    const source = current?.content ?? "";
    const needle = findText.trim();
    if (!needle) return [] as number[];
    const result: number[] = [];
    let cursor = 0;
    const lowerSource = source.toLocaleLowerCase("zh-CN");
    const lowerNeedle = needle.toLocaleLowerCase("zh-CN");
    while ((cursor = lowerSource.indexOf(lowerNeedle, cursor)) >= 0) {
      result.push(cursor);
      cursor += Math.max(1, lowerNeedle.length);
    }
    return result;
  }, [current?.content, findText]);
  const chapterAnnotations = writingWorkspace.annotations.filter((item) => item.chapterId === current?.plan.id);
  const chapterBookmarks = writingWorkspace.bookmarks.filter((item) => item.chapterId === current?.plan.id);
  const todayKey = new Date().toLocaleDateString("zh-CN");
  const todaySessions = writingWorkspace.sessions.filter(
    (item) => new Date(item.startedAt).toLocaleDateString("zh-CN") === todayKey
  );

  const syncEditorScroll = () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = editor.scrollTop;
    }
    if (backdropRef.current) {
      backdropRef.current.scrollTop = editor.scrollTop;
    }
  };

  const updateSelectionFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    setSelectionStart(editor.selectionStart);
    setSelectionEnd(editor.selectionEnd);
  };

  const selectOffset = (start: number, end = start) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.setSelectionRange(start, end);
    setSelectionStart(start);
    setSelectionEnd(end);
  };

  const selectFindMatch = (index: number) => {
    if (!findMatches.length) return;
    const normalized = (index + findMatches.length) % findMatches.length;
    setMatchIndex(normalized);
    window.requestAnimationFrame(() =>
      selectOffset(findMatches[normalized], findMatches[normalized] + findText.trim().length)
    );
  };

  const replaceCurrentMatch = () => {
    if (!current || !findMatches.length) return;
    const start = findMatches[Math.min(matchIndex, findMatches.length - 1)];
    const next = `${current.content.slice(0, start)}${replaceText}${current.content.slice(start + findText.trim().length)}`;
    updateContent(next);
    window.requestAnimationFrame(() => selectOffset(start, start + replaceText.length));
  };

  const replaceAllMatches = () => {
    if (!current || !findText.trim()) return;
    const pattern = new RegExp(escapeRegExp(findText.trim()), "giu");
    updateContent(current.content.replace(pattern, () => replaceText));
    setMatchIndex(0);
  };

  const applyMarkdown = (before: string, after = before) => {
    if (!current) return;
    const start = selectionStart;
    const end = selectionEnd;
    const selected = current.content.slice(start, end);
    updateContent(`${current.content.slice(0, start)}${before}${selected}${after}${current.content.slice(end)}`);
    window.requestAnimationFrame(() => selectOffset(start + before.length, end + before.length));
  };

  const saveWritingWorkspace = async (update: (workspace: WritingWorkspace) => WritingWorkspace) => {
    if (!project) return;
    const projectPath = project.projectPath;
    const saved = await mutateWritingWorkspace(projectPath, update);
    if (useProjectStore.getState().project?.projectPath === projectPath) {
      setWritingWorkspace(saved);
    }
  };

  const addAnnotation = () => {
    if (!current || selectionEnd <= selectionStart) return;
    const note = window.prompt("为选中文字添加批注", "");
    if (note === null) return;
    const now = Date.now();
    void saveWritingWorkspace((workspace) => ({
      ...workspace,
      annotations: [
        ...workspace.annotations,
        {
          id: `annotation-${now}`,
          chapterId: current.plan.id,
          start: selectionStart,
          end: selectionEnd,
          quote: current.content.slice(selectionStart, selectionEnd),
          note,
          color: "green",
          createdAt: new Date(now).toISOString()
        }
      ]
    }));
  };

  const addBookmark = () => {
    if (!current) return;
    const line = current.content.slice(0, selectionStart).split(/\r?\n/u).length;
    const now = Date.now();
    void saveWritingWorkspace((workspace) => ({
      ...workspace,
      bookmarks: [
        ...workspace.bookmarks,
        {
          id: `bookmark-${now}`,
          chapterId: current.plan.id,
          offset: selectionStart,
          label: `第 ${line} 行`,
          createdAt: new Date(now).toISOString()
        }
      ]
    }));
  };

  const centerCaretInFocusMode = () => {
    const editor = editorRef.current;
    const marker = caretMarkerRef.current;
    if (!focusMode || !editor || !marker || document.activeElement !== editor) {
      return;
    }
    const lineHeight = Number.parseFloat(window.getComputedStyle(editor).lineHeight) || 32;
    const targetTop = marker.offsetTop - editor.clientHeight / 2 + lineHeight;
    editor.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    window.requestAnimationFrame(syncEditorScroll);
  };

  useEffect(() => {
    if (!focusMode) {
      return;
    }
    const handleSelectionChange = () => {
      if (document.activeElement === editorRef.current) {
        updateSelectionFromEditor();
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [focusMode]);

  useEffect(() => {
    if (!focusMode || editorTab !== "write") {
      return;
    }
    const frame = window.requestAnimationFrame(centerCaretInFocusMode);
    return () => window.cancelAnimationFrame(frame);
  }, [focusMode, editorTab, selectionStart, current?.content]);

  if (!current) {
    return (
      <section className="editor-empty">
        <CircleDot size={24} />
        <span>选择或创建一个章节开始写作。</span>
      </section>
    );
  }

  const words = countCjkAwareWords(current.content);
  const sessionWords = words - sessionStartedRef.current.initialWords;
  const todayWords = todaySessions.reduce((total, item) => total + item.wordsAdded, 0) + sessionWords;
  const todayMinutes = Math.round(todaySessions.reduce((total, item) => total + item.durationSeconds, 0) / 60);
  const volume = project?.outline.volumes.find((item) =>
    item.chapters.some((chapter) => chapter.id === current.plan.id)
  );
  const targetWords = Math.max(1, Number(draftMeta.targetWords) || current.plan.targetWords || 1);
  const completion = Math.min(999, Math.round((words / targetWords) * 100));
  const persistDraftMeta = () => {
    const parsedTargetWords = Number.parseInt(draftMeta.targetWords, 10);
    void updateChapterPlan(current.plan.id, {
      title: draftMeta.title.trim() || current.plan.title,
      goal: draftMeta.goal,
      notes: draftMeta.notes,
      conflictPoints: draftMeta.conflictPoints,
      targetWords:
        Number.isFinite(parsedTargetWords) && parsedTargetWords > 0 ? parsedTargetWords : current.plan.targetWords
    });
  };

  const handlePreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("a")) {
      return;
    }
    const heading = target.closest("h1, h2, h3, h4, h5, h6");
    if (!heading || !previewRef.current?.contains(heading) || !heading.id) {
      return;
    }
    heading.scrollIntoView({ block: "start", behavior: "smooth" });
    window.history.replaceState(null, "", `#${heading.id}`);
  };

  return (
    <section className={`chapter-editor ${focusMode ? "focus-editor" : ""}`}>
      {!focusMode ? (
        <>
          <div className="editor-header">
            <div>
              <div className="crumb">{volume?.title ?? "未归属分卷"}</div>
              <input
                className="chapter-title-input"
                value={draftMeta.title}
                onChange={(event) => setDraftMeta((draft) => ({ ...draft, title: event.target.value }))}
                onBlur={persistDraftMeta}
              />
            </div>
            <div className="chapter-meta">
              <div
                className="chapter-progress-inline"
                aria-label={`本章字数 ${words.toLocaleString("zh-CN")}，目标 ${targetWords.toLocaleString("zh-CN")}`}
              >
                <span>
                  {words.toLocaleString("zh-CN")} / {targetWords.toLocaleString("zh-CN")} 字
                </span>
                <i aria-hidden="true">
                  <b style={{ width: `${Math.min(100, completion)}%` }} />
                </i>
              </div>
              <span className="writing-session-stat">
                今日 {todayWords >= 0 ? "+" : ""}
                {todayWords} · {todayMinutes} 分钟
              </span>
              <span>{chapterStatusLabels[current.plan.status]}</span>
              <span>{completion}%</span>
              <button
                className="secondary-button compact quiet-toggle"
                type="button"
                onClick={() => setFocusMode(true)}
              >
                <Minimize2 size={15} />
                专注写作
              </button>
            </div>
          </div>

          <div className="chapter-goal">
            <Wand2 size={16} />
            <div>
              <strong>章节目标</strong>
              <span>{draftMeta.goal || "补充本章剧情目标，AI 续写时会优先读取这里。"}</span>
            </div>
          </div>
        </>
      ) : null}

      {!focusMode ? (
        <details className="chapter-support-details">
          <summary>
            <span>
              <Wand2 size={15} />
              章节辅助
            </span>
            <small>场景、资料与历史版本</small>
            <ChevronDown size={16} className="chapter-support-chevron" />
          </summary>

          <div className="chapter-support-tabs" role="tablist" aria-label="章节辅助内容">
            <button
              className={supportTab === "scenes" ? "active" : ""}
              type="button"
              onClick={() => setSupportTab("scenes")}
            >
              场景规划
            </button>
            <button
              className={supportTab === "details" ? "active" : ""}
              type="button"
              onClick={() => setSupportTab("details")}
            >
              章节资料
            </button>
            <button
              className={supportTab === "history" ? "active" : ""}
              type="button"
              onClick={() => setSupportTab("history")}
            >
              历史版本
            </button>
            <button
              className={supportTab === "notes" ? "active" : ""}
              type="button"
              onClick={() => setSupportTab("notes")}
            >
              批注书签
            </button>
          </div>

          <div className="chapter-support-content">
            {supportTab === "scenes" ? <ScenePlanner /> : null}

            {supportTab === "details" ? (
              <section className="chapter-planning-panel">
                <label>
                  所属卷
                  <select
                    value={volume?.id ?? ""}
                    onChange={(event) => void moveChapter(current.plan.id, event.target.value)}
                  >
                    {project?.outline.volumes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  状态
                  <select
                    value={current.plan.status}
                    onChange={(event) =>
                      void updateChapterPlan(current.plan.id, {
                        status: event.target.value as typeof current.plan.status
                      })
                    }
                  >
                    {Object.entries(chapterStatusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  目标字数
                  <input
                    type="number"
                    min={1}
                    value={draftMeta.targetWords}
                    onChange={(event) => setDraftMeta((draft) => ({ ...draft, targetWords: event.target.value }))}
                    onBlur={persistDraftMeta}
                  />
                </label>
                <label>
                  实际/完成率
                  <div className="progress-cell">
                    <span>
                      {words.toLocaleString("zh-CN")} / {targetWords.toLocaleString("zh-CN")}
                    </span>
                    <div className="progress-track">
                      <div style={{ width: `${Math.min(100, completion)}%` }} />
                    </div>
                  </div>
                </label>
                <label className="wide">
                  本章目标
                  <textarea
                    value={draftMeta.goal}
                    onChange={(event) => setDraftMeta((draft) => ({ ...draft, goal: event.target.value }))}
                    onBlur={persistDraftMeta}
                  />
                </label>
                <label>
                  备注
                  <textarea
                    value={draftMeta.notes}
                    onChange={(event) => setDraftMeta((draft) => ({ ...draft, notes: event.target.value }))}
                    onBlur={persistDraftMeta}
                  />
                </label>
                <label>
                  本章冲突点
                  <textarea
                    value={draftMeta.conflictPoints}
                    onChange={(event) => setDraftMeta((draft) => ({ ...draft, conflictPoints: event.target.value }))}
                    onBlur={persistDraftMeta}
                  />
                </label>
              </section>
            ) : null}

            {supportTab === "history" ? (
              <section className="chapter-history-panel">
                <div className="section-heading">
                  <span>历史版本</span>
                  <History size={15} />
                </div>
                {chapterHistory.length ? (
                  <div className="chapter-history-grid">
                    <div className="chapter-history-list">
                      {chapterHistory.map((entry) => (
                        <button
                          className={entry.id === selectedHistoryId ? "active" : ""}
                          key={entry.id}
                          type="button"
                          onClick={() => void previewChapterHistory(entry.id)}
                        >
                          <strong>{formatHistoryTime(entry.createdAt)}</strong>
                          <small>{formatBytes(entry.size)}</small>
                        </button>
                      ))}
                    </div>
                    <div className="chapter-history-preview">
                      {selectedHistoryId && historyPreview !== undefined ? (
                        <>
                          <pre>{historyPreview.slice(0, 2400)}</pre>
                          <button
                            className="secondary-button compact"
                            type="button"
                            onClick={() => void restoreChapterHistory(selectedHistoryId)}
                          >
                            <RotateCcw size={14} />
                            恢复此版本
                          </button>
                        </>
                      ) : (
                        <p className="muted">选择一个历史版本查看内容。恢复前会自动保留当前版本。</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="muted">保存覆盖章节后会自动生成历史版本。</p>
                )}
              </section>
            ) : null}

            {supportTab === "notes" ? (
              <section className="writing-notes-panel">
                <div className="writing-note-column">
                  <header>
                    <MessageSquareText size={15} />
                    <strong>批注</strong>
                    <span>{chapterAnnotations.length}</span>
                  </header>
                  {chapterAnnotations.map((annotation) => (
                    <article key={annotation.id}>
                      <button type="button" onClick={() => selectOffset(annotation.start, annotation.end)}>
                        <strong>“{annotation.quote.slice(0, 60)}”</strong>
                        <small>{annotation.note || "无附加说明"}</small>
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label="删除批注"
                        onClick={() =>
                          void saveWritingWorkspace((workspace) => ({
                            ...workspace,
                            annotations: workspace.annotations.filter((item) => item.id !== annotation.id)
                          }))
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </article>
                  ))}
                  {!chapterAnnotations.length ? (
                    <p className="muted">在正文中选中文字，然后点击工具栏中的“批注”。</p>
                  ) : null}
                </div>
                <div className="writing-note-column">
                  <header>
                    <Bookmark size={15} />
                    <strong>书签</strong>
                    <span>{chapterBookmarks.length}</span>
                  </header>
                  {chapterBookmarks.map((bookmark) => (
                    <article key={bookmark.id}>
                      <button type="button" onClick={() => selectOffset(bookmark.offset)}>
                        <strong>{bookmark.label}</strong>
                        <small>{new Date(bookmark.createdAt).toLocaleString("zh-CN")}</small>
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label="删除书签"
                        onClick={() =>
                          void saveWritingWorkspace((workspace) => ({
                            ...workspace,
                            bookmarks: workspace.bookmarks.filter((item) => item.id !== bookmark.id)
                          }))
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </article>
                  ))}
                  {!chapterBookmarks.length ? <p className="muted">把光标放到需要返回的位置，然后添加书签。</p> : null}
                </div>
              </section>
            ) : null}
          </div>
        </details>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="editor-workspace">
        <div className="editor-toolbar">
          <div className="editor-tabs editor-view-tabs" role="tablist" aria-label="章节编辑视图">
            <button
              className={editorTab === "write" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={editorTab === "write"}
              aria-controls="chapter-write-panel"
              onClick={() => setEditorTab("write")}
            >
              <PencilLine size={15} />
              正文写作
            </button>
            <button
              className={editorTab === "preview" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={editorTab === "preview"}
              aria-controls="chapter-preview-panel"
              onClick={() => setEditorTab("preview")}
            >
              <Eye size={15} />
              预览
            </button>
          </div>
          <div className="editor-format-actions" role="toolbar" aria-label="正文格式与标记">
            <button type="button" className={findOpen ? "active" : ""} onClick={() => setFindOpen((value) => !value)}>
              <Search size={14} />
              查找替换
            </button>
            <button
              type="button"
              aria-label="插入二级标题"
              title="插入二级标题"
              onClick={() => applyMarkdown("\n## ", "")}
            >
              <Heading2 size={14} />
            </button>
            <button type="button" aria-label="加粗" title="加粗" onClick={() => applyMarkdown("**")}>
              <Bold size={14} />
            </button>
            <button type="button" aria-label="斜体" title="斜体" onClick={() => applyMarkdown("*")}>
              <Italic size={14} />
            </button>
            <button
              type="button"
              disabled={selectionEnd <= selectionStart}
              title={selectionEnd <= selectionStart ? "请先选择需要批注的文字" : "添加批注"}
              onClick={addAnnotation}
            >
              <MessageSquareText size={14} />
              批注
            </button>
            <button type="button" onClick={addBookmark}>
              <Bookmark size={14} />
              书签
            </button>
          </div>
        </div>

        {findOpen ? (
          <div className="editor-findbar">
            <label>
              <Search size={14} />
              <input
                autoFocus
                value={findText}
                placeholder="查找"
                onChange={(event) => {
                  setFindText(event.target.value);
                  setMatchIndex(0);
                }}
              />
            </label>
            <span>{findMatches.length ? `${matchIndex + 1} / ${findMatches.length}` : "无匹配"}</span>
            <button type="button" disabled={!findMatches.length} onClick={() => selectFindMatch(matchIndex - 1)}>
              上一个
            </button>
            <button type="button" disabled={!findMatches.length} onClick={() => selectFindMatch(matchIndex + 1)}>
              下一个
            </button>
            <label>
              <Replace size={14} />
              <input
                value={replaceText}
                placeholder="替换为"
                onChange={(event) => setReplaceText(event.target.value)}
              />
            </label>
            <button type="button" disabled={!findMatches.length} onClick={replaceCurrentMatch}>
              替换
            </button>
            <button type="button" disabled={!findMatches.length} onClick={replaceAllMatches}>
              全部替换
            </button>
          </div>
        ) : null}

        {editorTab === "write" ? (
          <div className="markdown-editor-shell" id="chapter-write-panel" role="tabpanel">
            <div className="editor-line-gutter" ref={gutterRef} aria-hidden="true">
              {shouldRenderLineNumbers ? (
                Array.from({ length: lineCount }, (_, index) => <span className="line-number-row" key={index} />)
              ) : (
                <span className="line-gutter-large-file">{lineCount.toLocaleString("zh-CN")} 行</span>
              )}
            </div>
            <div className="editor-text-wrap">
              {focusMode ? (
                <div className="paragraph-backdrop" ref={backdropRef} aria-hidden="true">
                  {paragraphSegments.map((segment) => (
                    <span
                      className={`paragraph-segment ${segment.active ? "active" : ""} ${segment.breakOnly ? "break-only" : ""}`}
                      key={segment.id}
                    >
                      {segment.text}
                    </span>
                  ))}
                </div>
              ) : null}
              <textarea
                className="markdown-editor"
                ref={editorRef}
                value={current.content}
                placeholder="从这里开始写正文……"
                spellCheck={true}
                onChange={(event) => {
                  updateContent(event.target.value);
                  setSelectionStart(event.target.selectionStart);
                }}
                onClick={updateSelectionFromEditor}
                onKeyUp={updateSelectionFromEditor}
                onSelect={updateSelectionFromEditor}
                onScroll={syncEditorScroll}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "f") {
                    event.preventDefault();
                    setFindOpen(true);
                  }
                }}
              />
              {focusMode ? (
                <div className="caret-mirror" aria-hidden="true">
                  {caretBefore}
                  <span ref={caretMarkerRef} />
                  {caretAfter}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div
            className="markdown-preview"
            id="chapter-preview-panel"
            role="tabpanel"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
            onClick={handlePreviewClick}
            ref={previewRef}
          />
        )}
      </div>
    </section>
  );
};
