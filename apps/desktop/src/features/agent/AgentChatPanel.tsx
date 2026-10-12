import { requireSavedChapter } from "@/lib/requireSavedChapter";
import {
  Activity,
  Ban,
  Bot,
  BookOpenText,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Download,
  FilePenLine,
  GitBranch,
  ListChecks,
  LoaderCircle,
  FileText,
  Paperclip,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wrench,
  Workflow,
  X,
  Zap
} from "lucide-react";
import {
  AgentExtensionConfigSchema,
  agentToolRegistry,
  defaultAgentMembers,
  type AgentExtensionConfig,
  type AgentMember,
  type AgentChangeProposal,
  type AgentDataProposal,
  type AgentSourceReference,
  type AgentToolName
} from "@inkforge/schemas";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "@/lib/browserBridge";
import { formatAgentError } from "@/lib/agentError";
import { composeAgentScopePrompt, toolsForAgentScope, type AgentScope } from "@/lib/agentScope";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ProviderSettings } from "@/features/agent/ProviderSettings";
import { AgentDataPreview } from "@/features/agent/AgentDataPreview";
import { AgentSelectionAttachments } from "@/features/agent/AgentSelectionAttachments";
import { composeAgentSelectionPrompt } from "@/lib/agentSelection";
import { useAgentSelectionStore } from "@/stores/useAgentSelectionStore";
import { useProjectAutomation } from "@/lib/useProjectAutomation";
import { PipelinePanel } from "@/features/agent/PipelinePanel";
import type { AgentChatSession } from "@/types/app";
import type { AgentRunEvent, AgentRunTrace } from "@/types/app";
import { useProjectStore } from "@/stores/useProjectStore";
import { useProviderStore } from "@/stores/useProviderStore";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useNarrativeStore } from "@/stores/useNarrativeStore";
import { useWritingSessionStore } from "@/stores/useWritingSessionStore";
import {
  agentMessageCharacterLimit,
  agentTextDocumentAccept,
  composeAgentDocumentPrompt,
  maxAgentTextDocuments,
  readAgentTextDocument,
  type AgentTextDocument
} from "@/lib/textDocument";

const quickPrompts = ["续写一段", "检查伏笔", "强化冲突"];
const promptTemplates = [
  { label: "续写场景", value: "承接当前章节结尾，续写一个完整场景。先确认人物目标与冲突，再生成可审阅的正文提案。" },
  { label: "一致性检查", value: "检查当前章节的人物动机、时间线、伏笔和世界观一致性，列出问题并给出修改建议。" },
  { label: "扩写章节", value: "在不改变现有剧情方向的前提下扩写当前章节，增强动作、感官和人物反应。" }
] as const;

// Labels and read/proposal classification come from the schema-level registry
// (single source of truth shared with the electron service).
const allTools = Object.keys(agentToolRegistry) as AgentToolName[];
const toolLabels = Object.fromEntries(allTools.map((name) => [name, agentToolRegistry[name].label])) as Record<
  AgentToolName,
  string
>;
const readOnlyTools = allTools.filter((tool) => agentToolRegistry[tool].kind === "read");

type AgentMode = "direct" | "plan";
type WritingApproach = "stable" | "inspiration" | "compare";
type SubmitOptions = {
  mode?: "direct" | "plan" | "execute-plan";
  planMessageId?: string;
};

type AgentConfirmation =
  | {
      kind: "rollback";
      proposalId: string;
    }
  | {
      kind: "approve";
      proposalIds: string[];
      dataProposalIds: string[];
      scopeLabel: string;
    };

const sourceKey = (source: AgentSourceReference) => `${source.kind}:${source.id}`;

export const mergeAgentMembers = (members: AgentMember[]): AgentMember[] => {
  const merged = new Map(defaultAgentMembers.map((member) => [member.id, member]));
  for (const member of members) {
    merged.set(member.id, member);
  }
  return [...merged.values()].filter((member) => member.enabled);
};

export const mentionedAgentIds = (message: string, members: AgentMember[]): string[] => {
  if (/(^|\s)@全体(?=\s|$|[，。！？、])/u.test(message)) {
    return members.filter((member) => member.enabled).map((member) => member.id);
  }
  return members
    .filter(
      (member) =>
        member.enabled &&
        new RegExp(`(^|\\s)@${member.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$|[，。！？、])`, "u").test(
          message
        )
    )
    .map((member) => member.id);
};

export const insertAgentMention = (message: string, handle: string): string => {
  const prefix = message.replace(/(^|\s)@[^\s@]*$/u, "$1");
  return `${prefix}@${handle} `;
};

const visibleSessionMessages = (
  session: AgentChatSession,
  branchId: string,
  visited = new Set<string>()
): AgentChatSession["messages"] => {
  if (branchId === "main" || visited.has(branchId)) {
    return session.messages.filter((item) => !item.branchId || item.branchId === "main");
  }
  visited.add(branchId);
  const branch = session.branches?.find((item) => item.id === branchId);
  if (!branch) {
    return visibleSessionMessages(session, "main", visited);
  }
  const parentMessages = visibleSessionMessages(session, branch.parentBranchId ?? "main", visited);
  const forkIndex = branch.forkedFromMessageId
    ? parentMessages.findIndex((item) => item.id === branch.forkedFromMessageId)
    : parentMessages.length - 1;
  return [
    ...parentMessages.slice(0, forkIndex >= 0 ? forkIndex + 1 : parentMessages.length),
    ...session.messages.filter((item) => item.branchId === branchId)
  ];
};

export const AgentChatPanel = () => {
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const selectChapter = useProjectStore((state) => state.selectChapter);
  const refreshProject = useProjectStore((state) => state.refreshProject);
  const storedProviderStatus = useProviderStore((state) => state.providerStatus);
  const providerStatus = storedProviderStatus?.taskProviders?.agent ?? storedProviderStatus;
  const loadLibraries = useLibraryStore((state) => state.loadLibraries);
  const hydrateScenePlans = useWritingSessionStore((state) => state.hydrateScenePlans);
  const [session, setSession] = useState<AgentChatSession>();
  const [message, setMessage] = useState("");
  const [textDocuments, setTextDocuments] = useState<AgentTextDocument[]>([]);
  const allSelectionReferences = useAgentSelectionStore((state) => state.references);
  const selectionReferences = useMemo(
    () =>
      allSelectionReferences.filter(
        (item) => item.projectPath === project?.projectPath && item.chapterId === current?.plan.id
      ),
    [allSelectionReferences, project?.projectPath, current?.plan.id]
  );
  const selectionPrompt = useMemo(
    () => composeAgentSelectionPrompt(message, selectionReferences),
    [message, selectionReferences]
  );
  const composerPrompt = useMemo(
    () => composeAgentDocumentPrompt(selectionPrompt, textDocuments),
    [selectionPrompt, textDocuments]
  );
  const [running, setRunning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);
  settingsOpenRef.current = settingsOpen;

  useEffect(() => {
    // Esc (AppShell keybinding) closes the provider settings before exiting
    // focus mode; preventDefault signals that something was closed.
    const closeSettings = (event: Event) => {
      if (settingsOpenRef.current) {
        event.preventDefault();
        setSettingsOpen(false);
      }
    };
    window.addEventListener("inkforge:close-settings", closeSettings);
    return () => window.removeEventListener("inkforge:close-settings", closeSettings);
  }, []);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [mode, setMode] = useState<AgentMode>("direct");
  const [agentScope, setAgentScope] = useState<AgentScope>("chapter");
  const [writingApproach, setWritingApproach] = useState<WritingApproach>("stable");
  const { settings: automation, update: updateAutomation } = useProjectAutomation(project?.projectPath);
  const yoloMode = automation.yolo;
  const [confirmation, setConfirmation] = useState<AgentConfirmation>();
  const [contextBudget, setContextBudget] = useState(6000);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [includeSemantic, setIncludeSemantic] = useState(true);
  const [pinnedSourceKeys, setPinnedSourceKeys] = useState<string[]>([]);
  const [excludedSourceKeys, setExcludedSourceKeys] = useState<string[]>([]);
  const [maxTurns, setMaxTurns] = useState(6);
  const [maxToolCalls, setMaxToolCalls] = useState(12);
  const [maxTotalTokens, setMaxTotalTokens] = useState(128000);
  const [allowedTools, setAllowedTools] = useState<AgentToolName[]>(allTools);
  const [extensions, setExtensions] = useState<AgentExtensionConfig>({
    promptPresets: [],
    toolProfiles: [],
    customTools: [],
    members: defaultAgentMembers,
    taskTemplates: [],
    workflowTemplates: []
  });
  const [askBeforeTools, setAskBeforeTools] = useState<AgentToolName[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{ callId: string; toolName: AgentToolName; args: string }>();
  const [runEstimate, setRunEstimate] = useState<import("@/types/app").AgentRunEstimate | undefined>();
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptValue, setNewPromptValue] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [newToolName, setNewToolName] = useState("");
  const [newToolInstruction, setNewToolInstruction] = useState("");
  const [newMemberHandle, setNewMemberHandle] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("");
  const [newMemberPrompt, setNewMemberPrompt] = useState("");
  const [newMemberModel, setNewMemberModel] = useState("");
  const [traces, setTraces] = useState<AgentRunTrace[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string>();
  const [liveEvents, setLiveEvents] = useState<AgentRunEvent[]>([]);
  const [streamText, setStreamText] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  const [expandedProposal, setExpandedProposal] = useState<string>();

  const abortRef = useRef<AbortController | undefined>(undefined);
  const activeRequestIdRef = useRef<string | undefined>(undefined);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const previousReferenceIdsRef = useRef<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const busy = running || resolving;
  const agentRoster = useMemo(() => mergeAgentMembers(extensions.members), [extensions.members]);
  const mentionQuery = useMemo(() => message.match(/(?:^|\s)@([^\s@]*)$/u)?.[1], [message]);
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === undefined) {
      return [];
    }
    const query = mentionQuery.toLowerCase();
    return [{ id: "all", handle: "全体", name: "全部成员", role: "群聊协作" }, ...agentRoster].filter(
      (member) => member.handle.toLowerCase().includes(query) || member.name.toLowerCase().includes(query)
    );
  }, [agentRoster, mentionQuery]);
  const scopedAllowedTools = useMemo(() => toolsForAgentScope(allowedTools, agentScope), [agentScope, allowedTools]);

  useEffect(() => {
    const added = selectionReferences.some((item) => !previousReferenceIdsRef.current.includes(item.id));
    previousReferenceIdsRef.current = selectionReferences.map((item) => item.id);
    if (!added) return;
    setAgentScope("chapter");
    const timer = window.setTimeout(() => composerRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [selectionReferences]);

  useEffect(() => {
    const receiveTask = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string; scope?: AgentScope; selectionAdded?: boolean }>).detail;
      if (!detail?.prompt && !detail?.selectionAdded) {
        return;
      }
      setAgentScope(detail.scope ?? "chapter");
      if (detail.prompt) setMessage(detail.prompt);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    };
    window.addEventListener("inkforge:agent-task-ready", receiveTask);
    return () => window.removeEventListener("inkforge:agent-task-ready", receiveTask);
  }, []);

  useEffect(() => {
    if (!project || !current) {
      setSession(undefined);
      setTraces([]);
      return;
    }
    let active = true;
    setError(undefined);
    void bridge
      .loadAgentChat(project.projectPath, current.plan.id)
      .then((next) => {
        if (active) {
          setSession(next);
        }
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "无法加载 Agent 会话。");
        }
      });
    return () => {
      active = false;
    };
  }, [current?.plan.id, project?.projectPath]);

  useEffect(() => {
    if (!project || !current) {
      return;
    }
    const projectPath = project.projectPath;
    const chapterId = current.plan.id;
    const refreshChangedSession = (event: Event) => {
      const detail = (event as CustomEvent<{ chapterId?: string }>).detail;
      if (detail?.chapterId !== chapterId) {
        return;
      }
      void bridge
        .loadAgentChat(projectPath, chapterId)
        .then(setSession)
        .catch((reason) => setError(reason instanceof Error ? reason.message : "无法刷新 Agent 会话。"));
    };
    window.addEventListener("inkforge:agent-session-changed", refreshChangedSession);
    return () => window.removeEventListener("inkforge:agent-session-changed", refreshChangedSession);
  }, [current?.plan.id, project?.projectPath]);

  useEffect(() => {
    if (!project) {
      setExtensions({
        promptPresets: [],
        toolProfiles: [],
        customTools: [],
        members: defaultAgentMembers,
        taskTemplates: [],
        workflowTemplates: []
      });
      return;
    }
    void bridge
      .loadAgentExtensions(project.projectPath)
      .then(setExtensions)
      .catch(() => undefined);
  }, [project?.projectPath]);

  useEffect(() => {
    if (!project || !current || !composerPrompt.trim()) {
      setRunEstimate(undefined);
      return;
    }
    const projectPath = project.projectPath;
    const chapterId = current.plan.id;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void bridge
        .estimateAgentRun({
          projectPath,
          chapterId,
          message: composeAgentScopePrompt(composerPrompt, agentScope),
          context: {
            tokenBudget: contextBudget,
            includeMemories,
            includeSemantic,
            excludedSourceKeys
          },
          limits: { maxTurns, maxToolCalls, maxTotalTokens }
        })
        .then((estimate) => {
          if (
            !cancelled &&
            useProjectStore.getState().project?.projectPath === projectPath &&
            useProjectStore.getState().current?.plan.id === chapterId
          ) {
            setRunEstimate(estimate);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRunEstimate(undefined);
          }
        });
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    project?.projectPath,
    current?.plan.id,
    composerPrompt,
    agentScope,
    contextBudget,
    includeMemories,
    includeSemantic,
    excludedSourceKeys,
    maxTurns,
    maxToolCalls,
    maxTotalTokens
  ]);

  useEffect(() => {
    if (!project || !current) {
      return;
    }
    let active = true;
    void bridge
      .listAgentTraces(project.projectPath, current.plan.id)
      .then((items) => {
        if (active) {
          setTraces(items);
          setSelectedTraceId((value) => value ?? items[0]?.id);
        }
      })
      .catch(() => {
        if (active) {
          setTraces([]);
        }
      });
    return () => {
      active = false;
    };
  }, [current?.plan.id, project?.projectPath, traceOpen]);

  useEffect(() => {
    const node = logRef.current;
    if (node && shouldAutoScrollRef.current) {
      requestAnimationFrame(() => {
        node.scrollTop = node.scrollHeight;
      });
    }
  }, [session?.dataProposals.length, session?.messages.length, session?.proposals.length]);

  useEffect(() => {
    if (!confirmation) {
      return;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setConfirmation(undefined);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [confirmation]);

  const pendingProposals = useMemo(
    () => session?.proposals.filter((proposal) => proposal.status === "pending") ?? [],
    [session?.proposals]
  );
  const latestAppliedProposal = useMemo(
    () => session?.proposals.filter((proposal) => proposal.status === "applied" && proposal.snapshotId).at(-1),
    [session?.proposals]
  );
  const pendingDataProposals = useMemo(
    () => session?.dataProposals.filter((proposal) => proposal.status === "pending") ?? [],
    [session?.dataProposals]
  );
  const pendingApprovalCount = pendingProposals.length + pendingDataProposals.length;
  const composerCharacterCount = useMemo(
    () => composeAgentScopePrompt(composerPrompt, agentScope).length,
    [composerPrompt, agentScope]
  );
  const selectedTrace = useMemo(
    () => traces.find((trace) => trace.id === selectedTraceId) ?? traces[0],
    [selectedTraceId, traces]
  );
  const activeBranchId = session?.activeBranchId ?? "main";
  const visibleMessages = useMemo(() => {
    if (!session) {
      return [];
    }
    return visibleSessionMessages(session, activeBranchId);
  }, [activeBranchId, session]);
  const knownSources = useMemo(() => {
    const byKey = new Map<string, AgentSourceReference>();
    for (const item of session?.messages ?? []) {
      for (const source of item.sources ?? []) {
        byKey.set(sourceKey(source), source);
      }
    }
    return [...byKey.values()];
  }, [session?.messages]);
  const pinnedSources = useMemo(
    () => knownSources.filter((source) => pinnedSourceKeys.includes(sourceKey(source))),
    [knownSources, pinnedSourceKeys]
  );
  const traceReasoning = useMemo(
    () =>
      selectedTrace?.events
        .filter((event) => event.type === "reasoning_delta")
        .map((event) => event.detail)
        .join("") ?? "",
    [selectedTrace]
  );
  const traceToolEvents = useMemo(
    () => selectedTrace?.events.filter((event) => event.type.startsWith("tool_")) ?? [],
    [selectedTrace]
  );

  const setSessionPreservingScroll = (next: AgentChatSession) => {
    const node = logRef.current;
    const scrollTop = node?.scrollTop ?? 0;
    shouldAutoScrollRef.current = false;
    setSession(next);
    requestAnimationFrame(() => {
      const currentNode = logRef.current;
      if (!currentNode) {
        return;
      }
      currentNode.scrollTop = scrollTop;
      shouldAutoScrollRef.current = currentNode.scrollHeight - currentNode.scrollTop - currentNode.clientHeight < 72;
    });
  };

  const ensureChapterSaved = async () => {
    if (project && current) await requireSavedChapter(project.projectPath, current.plan.id, useProjectStore.getState);
  };

  const applyPendingApprovals = async (
    sourceSession: AgentChatSession,
    proposalIds: string[],
    dataProposalIds: string[]
  ): Promise<AgentChatSession> => {
    if (!project || !current) {
      return sourceSession;
    }
    let next = sourceSession;
    const proposalIdSet = new Set(proposalIds);
    const dataProposalIdSet = new Set(dataProposalIds);
    const chapterProposals = sourceSession.proposals.filter(
      (proposal) => proposal.status === "pending" && proposalIdSet.has(proposal.id)
    );
    if (chapterProposals.length) {
      await ensureChapterSaved();
    }
    let chapterChanged = false;
    for (const sourceProposal of chapterProposals) {
      let proposal = next.proposals.find((item) => item.id === sourceProposal.id);
      if (!proposal || proposal.status !== "pending") {
        continue;
      }
      for (const block of proposal.blocks.filter((item) => item.status === "pending")) {
        next = await bridge.resolveAgentChange({
          projectPath: project.projectPath,
          chapterId: current.plan.id,
          proposalId: proposal.id,
          blockId: block.id,
          action: "accept-block"
        });
        proposal = next.proposals.find((item) => item.id === sourceProposal.id);
        if (!proposal || proposal.status !== "pending") {
          break;
        }
      }
      proposal = next.proposals.find((item) => item.id === sourceProposal.id);
      const hasAcceptedBlocks = proposal?.blocks.some((block) => block.status === "accepted") ?? false;
      if (proposal?.status === "pending") {
        if (proposal.blocks.length && !hasAcceptedBlocks) {
          next = await bridge.resolveAgentChange({
            projectPath: project.projectPath,
            chapterId: current.plan.id,
            proposalId: proposal.id,
            action: "reject"
          });
        } else {
          next = await bridge.resolveAgentChange({
            projectPath: project.projectPath,
            chapterId: current.plan.id,
            proposalId: proposal.id,
            action: "apply"
          });
          chapterChanged = true;
        }
      }
    }

    const dataProposals = sourceSession.dataProposals.filter(
      (proposal) => proposal.status === "pending" && dataProposalIdSet.has(proposal.id)
    );
    let refreshScenes = false;
    let refreshLibraries = false;
    let refreshOutline = false;
    const refreshNarrative = dataProposals.some((proposal) => proposal.entityType === "beat");
    if (refreshNarrative) {
      await useNarrativeStore.getState().flushBoard();
    }
    for (const sourceProposal of dataProposals) {
      const proposal = next.dataProposals.find((item) => item.id === sourceProposal.id);
      if (!proposal || proposal.status !== "pending") {
        continue;
      }
      next = await bridge.resolveAgentDataChange({
        projectPath: project.projectPath,
        chapterId: current.plan.id,
        proposalId: proposal.id,
        action: "apply"
      });
      refreshScenes ||= proposal.entityType === "scene";
      refreshOutline ||= proposal.entityType === "outline";
      refreshLibraries ||=
        proposal.entityType !== "scene" && proposal.entityType !== "outline" && proposal.entityType !== "beat";
    }
    if (chapterChanged) {
      await selectChapter(current.plan);
    }
    if (refreshScenes) {
      await hydrateScenePlans();
    }
    if (refreshLibraries) {
      await loadLibraries();
    }
    if (refreshOutline) {
      await refreshProject();
    }
    if (refreshNarrative) {
      await useNarrativeStore.getState().reloadBoard();
    }
    return next;
  };

  const approvePending = async (proposalIds: string[], dataProposalIds: string[]) => {
    if (!session || busy || (!proposalIds.length && !dataProposalIds.length)) {
      return;
    }
    setResolving(true);
    setError(undefined);
    try {
      const next = await applyPendingApprovals(session, proposalIds, dataProposalIds);
      setSessionPreservingScroll(next);
    } catch (reason) {
      if (project && current) {
        const latest = await bridge.loadAgentChat(project.projectPath, current.plan.id).catch(() => undefined);
        if (latest) {
          setSessionPreservingScroll(latest);
        }
      }
      setError(reason instanceof Error ? reason.message : "无法批量确认 Agent 提案。");
    } finally {
      setResolving(false);
    }
  };

  const submit = async (value?: string, replayOfTraceId?: string, options?: SubmitOptions) => {
    const composerSubmission = value === undefined;
    const submittedDocuments = composerSubmission ? textDocuments : [];
    const submittedReferences = composerSubmission ? selectionReferences : [];
    const rawPrompt = composerSubmission ? composerPrompt.trim() : (value ?? "").trim();
    const prompt = composeAgentScopePrompt(rawPrompt, agentScope);
    if (!project || !current || !rawPrompt || busy) {
      return;
    }
    if (prompt.length > agentMessageCharacterLimit) {
      setError(
        `消息、正文引用和文档合计 ${prompt.length.toLocaleString("zh-CN")} 字符，超过 ${agentMessageCharacterLimit.toLocaleString("zh-CN")} 字符上限。请移除部分引用或文档，或分两轮发送。`
      );
      return;
    }
    if (!providerStatus?.configured) {
      setSettingsOpen(true);
      setError("请先配置可用的模型 Provider。");
      return;
    }
    try {
      await requireSavedChapter(project.projectPath, current.plan.id, useProjectStore.getState);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "章节保存失败");
      return;
    }
    const requestId = `agent_chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    activeRequestIdRef.current = requestId;
    const targetAgentIds = mentionedAgentIds(composerSubmission ? message : rawPrompt, agentRoster);
    const abortController = new AbortController();
    abortRef.current = abortController;
    shouldAutoScrollRef.current = true;
    setMessage("");
    if (composerSubmission) {
      setTextDocuments([]);
      useAgentSelectionStore.getState().removeReferences(submittedReferences.map((item) => item.id));
    }
    setRunning(true);
    setStopping(false);
    setError(undefined);
    setLiveEvents([]);
    setStreamText("");
    setStreamReasoning("");
    try {
      const next = await bridge.runAgentChat(
        {
          requestId,
          projectPath: project.projectPath,
          chapterId: current.plan.id,
          message: prompt,
          replayOfTraceId,
          mode: options?.mode ?? mode,
          writingApproach,
          yolo: yoloMode,
          updateProjectData: automation.updateProjectData,
          branchId: activeBranchId,
          planMessageId: options?.planMessageId,
          context: {
            tokenBudget: contextBudget,
            includeMemories,
            includeSemantic,
            pinnedSources,
            excludedSourceKeys
          },
          limits: {
            maxTurns,
            maxToolCalls,
            maxTotalTokens
          },
          allowedTools: scopedAllowedTools,
          askBeforeTools: yoloMode ? [] : askBeforeTools,
          targetAgentIds
        },
        abortController.signal,
        (event) => {
          setLiveEvents((items) => [...items, event].slice(-24));
          if (event.type === "model_started") {
            setStreamText("");
            setStreamReasoning("");
          } else if (event.type === "text_delta") {
            setStreamText((text) => text + event.detail);
          } else if (event.type === "reasoning_delta") {
            setStreamReasoning((text) => text + event.detail);
          } else if (event.type === "tool_approval_requested" && event.toolName) {
            try {
              const payload = JSON.parse(event.detail || "{}") as { callId?: string; arguments?: string };
              if (payload.callId) {
                setPendingApproval({
                  callId: payload.callId,
                  toolName: event.toolName,
                  args: payload.arguments ?? ""
                });
              }
            } catch {
              // Malformed approval payload: leave the run to time out safely.
            }
          } else if (event.type === "tool_approval_resolved") {
            setPendingApproval(undefined);
          }
        }
      );
      setPendingApproval(undefined);
      if (yoloMode) {
        await useProjectStore.getState().reloadCurrentChapterFromDisk(current.plan.id);
        await loadLibraries();
        await refreshProject();
        await hydrateScenePlans();
        await useNarrativeStore.getState().reloadBoard();
      }
      setSession(next);
      if (options?.mode === "execute-plan") {
        setMode("direct");
      }
      const nextTraces = await bridge.listAgentTraces(project.projectPath, current.plan.id);
      setTraces(nextTraces);
      setSelectedTraceId(nextTraces[0]?.id);
    } catch (reason) {
      if (yoloMode) {
        await bridge
          .loadAgentChat(project.projectPath, current.plan.id)
          .then(setSession)
          .catch(() => undefined);
        await useProjectStore
          .getState()
          .reloadCurrentChapterFromDisk(current.plan.id)
          .catch(() => undefined);
      }
      if (!abortController.signal.aborted) {
        setError(formatAgentError(reason));
      }
      if (composerSubmission) {
        setMessage(message);
        setTextDocuments(submittedDocuments);
        useAgentSelectionStore.getState().restoreReferences(submittedReferences);
      } else if (!abortController.signal.aborted) {
        setMessage(composerSubmission ? message : prompt);
      }
    } finally {
      setRunning(false);
      setStopping(false);
      abortRef.current = undefined;
      void bridge
        .listAgentTraces(project.projectPath, current.plan.id)
        .then((items) => setTraces(items))
        .catch(() => undefined);
    }
  };

  const importTextDocuments = async (files?: FileList | null) => {
    if (!files?.length || busy) {
      return;
    }
    setError(undefined);
    try {
      const candidates = Array.from(files);
      if (textDocuments.length + candidates.length > maxAgentTextDocuments) {
        throw new Error(`一次最多导入 ${maxAgentTextDocuments} 份文本文档。`);
      }
      const parsed = await Promise.all(candidates.map(readAgentTextDocument));
      const next = [...textDocuments, ...parsed];
      const characters = composeAgentScopePrompt(composeAgentDocumentPrompt(selectionPrompt, next), agentScope).length;
      if (characters > agentMessageCharacterLimit) {
        throw new Error(
          `导入后合计 ${characters.toLocaleString("zh-CN")} 字符，超过 ${agentMessageCharacterLimit.toLocaleString("zh-CN")} 字符上限。`
        );
      }
      setTextDocuments(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文本文档解析失败。");
    } finally {
      if (documentInputRef.current) {
        documentInputRef.current.value = "";
      }
    }
  };

  const manageSession = async (
    action: "create-branch" | "select-branch" | "toggle-favorite",
    value?: { branchId?: string; messageId?: string }
  ) => {
    if (!project || !current || busy) {
      return;
    }
    setError(undefined);
    try {
      const next = await bridge.manageAgentSession({
        projectPath: project.projectPath,
        chapterId: current.plan.id,
        action,
        branchId: value?.branchId,
        messageId: value?.messageId,
        title: action === "create-branch" ? `分支 ${(session?.branches?.length ?? 1) + 1}` : undefined
      });
      setSession(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法更新 Agent 会话。");
    }
  };

  const toggleTool = (tool: AgentToolName) => {
    setAllowedTools((items) => (items.includes(tool) ? items.filter((item) => item !== tool) : [...items, tool]));
  };

  const applyPermissionPreset = (preset: "read" | "proposal") => {
    setAllowedTools(preset === "read" ? readOnlyTools : allTools);
  };

  const persistExtensions = async (next: AgentExtensionConfig) => {
    if (!project) return;
    const saved = await bridge.saveAgentExtensions(project.projectPath, next);
    setExtensions(saved);
  };

  const saveTaskTemplate = async () => {
    const trimmed = message.trim();
    if (!trimmed || !project) return;
    const name = window.prompt("任务模板名称", trimmed.slice(0, 16));
    if (!name?.trim()) return;
    await persistExtensions({
      ...extensions,
      taskTemplates: [
        ...extensions.taskTemplates,
        {
          id: `task-${Date.now()}`,
          name: name.trim(),
          message: trimmed,
          mode: mode === "plan" ? "plan" : "direct",
          description: ""
        }
      ]
    });
  };

  const addPromptPreset = () => {
    if (!newPromptName.trim() || !newPromptValue.trim()) return;
    void persistExtensions({
      ...extensions,
      promptPresets: [
        ...extensions.promptPresets,
        {
          id: `prompt-${Date.now()}`,
          name: newPromptName.trim(),
          prompt: newPromptValue.trim(),
          builtIn: false
        }
      ]
    });
    setNewPromptName("");
    setNewPromptValue("");
  };

  const addToolProfile = () => {
    if (!newProfileName.trim()) return;
    void persistExtensions({
      ...extensions,
      toolProfiles: [
        ...extensions.toolProfiles,
        {
          id: `profile-${Date.now()}`,
          name: newProfileName.trim(),
          allowedTools,
          maxTurns: Math.max(1, maxTurns),
          maxToolCalls: Math.max(1, maxToolCalls),
          maxTotalTokens: Math.max(1, maxTotalTokens)
        }
      ]
    });
    setNewProfileName("");
  };

  const addCustomTool = () => {
    if (!newToolName.trim() || !newToolInstruction.trim()) return;
    void persistExtensions({
      ...extensions,
      customTools: [
        ...extensions.customTools,
        {
          id: `custom-tool-${Date.now()}`,
          name: newToolName.trim(),
          description: `可调用 ${allowedTools.length} 个已注册工具`,
          instruction: newToolInstruction.trim(),
          allowedTools
        }
      ]
    });
    setNewToolName("");
    setNewToolInstruction("");
  };

  const addAgentMember = () => {
    const handle = newMemberHandle.trim().replace(/^@/, "");
    if (!handle || !newMemberRole.trim() || !newMemberPrompt.trim()) return;
    const member: AgentMember = {
      id: `member-${Date.now()}`,
      handle,
      name: `${handle} Agent`,
      role: newMemberRole.trim(),
      prompt: newMemberPrompt.trim(),
      model: newMemberModel.trim(),
      allowedTools: [...allowedTools],
      color: "slate",
      builtIn: false,
      enabled: true
    };
    void persistExtensions({ ...extensions, members: [...extensions.members, member] });
    setNewMemberHandle("");
    setNewMemberRole("");
    setNewMemberPrompt("");
    setNewMemberModel("");
  };

  const applyToolProfile = (profileId: string) => {
    const profile = extensions.toolProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    setAllowedTools(profile.allowedTools);
    setMaxTurns(profile.maxTurns);
    setMaxToolCalls(profile.maxToolCalls);
    setMaxTotalTokens(profile.maxTotalTokens);
  };

  const applyCustomTool = (toolId: string) => {
    const customTool = extensions.customTools.find((item) => item.id === toolId);
    if (!customTool) return;
    setMessage(customTool.instruction);
    setAllowedTools(customTool.allowedTools);
  };

  const exportExtensions = () => {
    const blob = new Blob([`${JSON.stringify(extensions, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "inkforge-agent-extensions.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importExtensions = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = AgentExtensionConfigSchema.parse(JSON.parse(await file.text()));
      await persistExtensions(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? `扩展配置导入失败：${reason.message}` : "扩展配置导入失败。");
    }
  };

  const cycleSource = (source: AgentSourceReference) => {
    const key = sourceKey(source);
    if (pinnedSourceKeys.includes(key)) {
      setPinnedSourceKeys((items) => items.filter((item) => item !== key));
      setExcludedSourceKeys((items) => [...new Set([...items, key])]);
    } else if (excludedSourceKeys.includes(key)) {
      setExcludedSourceKeys((items) => items.filter((item) => item !== key));
    } else {
      setPinnedSourceKeys((items) => [...new Set([...items, key])]);
    }
  };

  const cancel = () => {
    if (stopping) {
      return;
    }
    setStopping(true);
    abortRef.current?.abort();
    setLiveEvents((items) => [
      ...items,
      {
        id: `cancel_${Date.now()}`,
        type: "run_cancelled",
        timestamp: new Date().toISOString(),
        label: "已请求停止",
        detail: ""
      }
    ]);
  };

  const resolveProposal = async (
    proposal: AgentChangeProposal,
    action: "accept-block" | "reject-block" | "apply" | "reject" | "rollback",
    blockId?: string
  ) => {
    if (!project || !current || busy) {
      return;
    }
    setResolving(true);
    setError(undefined);
    try {
      if (action === "apply") {
        await ensureChapterSaved();
      }
      const next = await bridge.resolveAgentChange({
        projectPath: project.projectPath,
        chapterId: current.plan.id,
        proposalId: proposal.id,
        blockId,
        action
      });
      setSessionPreservingScroll(next);
      if (action === "apply" || action === "rollback") {
        await selectChapter(current.plan);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法处理修改提案。");
    } finally {
      setResolving(false);
    }
  };

  const resolveDataProposal = async (proposal: AgentDataProposal, action: "apply" | "reject") => {
    if (!project || !current || busy) {
      return;
    }
    setResolving(true);
    setError(undefined);
    try {
      if (action === "apply" && proposal.entityType === "beat") {
        await useNarrativeStore.getState().flushBoard();
      }
      const next = await bridge.resolveAgentDataChange({
        projectPath: project.projectPath,
        chapterId: current.plan.id,
        proposalId: proposal.id,
        action
      });
      setSessionPreservingScroll(next);
      if (action === "apply") {
        if (proposal.entityType === "scene") {
          await hydrateScenePlans();
        } else if (proposal.entityType === "outline") {
          await refreshProject();
        } else if (proposal.entityType === "beat") {
          await useNarrativeStore.getState().reloadBoard();
        } else {
          await loadLibraries();
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法处理资料修改提案。");
    } finally {
      setResolving(false);
    }
  };

  const confirmPendingAction = async () => {
    const action = confirmation;
    setConfirmation(undefined);
    if (!action) {
      return;
    }
    if (action.kind === "rollback") {
      const proposal = session?.proposals.find((item) => item.id === action.proposalId);
      if (proposal) {
        await resolveProposal(proposal, "rollback");
      }
      return;
    }
    await approvePending(action.proposalIds, action.dataProposalIds);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <aside className="agent-chat-panel" id="agent-chat-pane" aria-label="小说创作 Agent">
      <header className="agent-chat-header">
        <div className="agent-avatar" aria-hidden="true">
          <Bot size={18} />
        </div>
        <div>
          <strong>创作 Agent</strong>
          <span>
            <i className={providerStatus?.configured ? "agent-online" : "agent-offline"} />
            {providerStatus?.configured ? providerStatus.model : "等待配置模型"}
          </span>
        </div>
        <div className="agent-header-actions">
          <button
            className={controlsOpen ? "agent-icon-button active" : "agent-icon-button"}
            type="button"
            aria-label="上下文、权限与预算"
            title="上下文、权限与预算"
            onClick={() => {
              setControlsOpen((value) => !value);
              setTraceOpen(false);
              setWorkflowOpen(false);
              setSettingsOpen(false);
            }}
          >
            <SlidersHorizontal size={17} />
          </button>
          <button
            className={traceOpen ? "agent-icon-button active" : "agent-icon-button"}
            type="button"
            aria-label="Agent 运行追踪"
            title="Agent 运行追踪"
            onClick={() => {
              setTraceOpen((value) => !value);
              setControlsOpen(false);
              setWorkflowOpen(false);
              setSettingsOpen(false);
            }}
          >
            <Activity size={17} />
          </button>
          <button
            className={workflowOpen ? "agent-icon-button active" : "agent-icon-button"}
            type="button"
            aria-label="多 Agent 工作流"
            title="多 Agent 工作流"
            onClick={() => {
              setWorkflowOpen((value) => !value);
              setControlsOpen(false);
              setTraceOpen(false);
              setSettingsOpen(false);
            }}
          >
            <Workflow size={17} />
          </button>
          <button
            className="agent-icon-button"
            type="button"
            aria-label="模型设置"
            title="模型设置"
            onClick={() => {
              setSettingsOpen((value) => !value);
              setControlsOpen(false);
              setTraceOpen(false);
              setWorkflowOpen(false);
            }}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>

      {workflowOpen ? <PipelinePanel /> : null}

      {traceOpen ? (
        <section className="agent-trace-panel" aria-label="Agent 运行追踪">
          <header>
            <span>
              <Activity size={14} />
              运行追踪
            </span>
            <small>{traces.length} 次运行</small>
          </header>
          {selectedTrace ? (
            <>
              <select
                aria-label="选择 Agent 运行记录"
                value={selectedTrace.id}
                onChange={(event) => setSelectedTraceId(event.target.value)}
              >
                {traces.map((trace) => (
                  <option value={trace.id} key={trace.id}>
                    {new Date(trace.startedAt).toLocaleString("zh-CN")} ·{" "}
                    {trace.status === "completed"
                      ? "完成"
                      : trace.status === "cancelled"
                        ? "已停止"
                        : trace.status === "failed"
                          ? "失败"
                          : "运行中"}
                  </option>
                ))}
              </select>
              <div className="agent-trace-metrics">
                <span>
                  <b>{selectedTrace.durationMs}</b>
                  <small>毫秒</small>
                </span>
                <span>
                  <b>{selectedTrace.usage.totalTokens}</b>
                  <small>{selectedTrace.usage.estimated ? "Token（含估算）" : "Token"}</small>
                </span>
                <span>
                  <b>{selectedTrace.context?.semanticHits ?? 0}</b>
                  <small>语义命中</small>
                </span>
                <span>
                  <b>
                    {selectedTrace.context?.estimatedTokens ?? 0}/{selectedTrace.context?.tokenBudget ?? 0}
                  </b>
                  <small>上下文</small>
                </span>
              </div>
              <div className="agent-trace-events">
                {selectedTrace.events
                  .filter((event) => event.type !== "text_delta" && event.type !== "reasoning_delta")
                  .slice(-12)
                  .map((event) => (
                    <div className={event.type.includes("failed") ? "failed" : ""} key={event.id}>
                      <i />
                      <span>
                        <b>{event.label || event.type}</b>
                        {event.detail ? <small>{event.detail}</small> : null}
                      </span>
                      {event.durationMs !== undefined ? <time>{event.durationMs}ms</time> : null}
                    </div>
                  ))}
              </div>
              {traceReasoning ? (
                <details className="agent-disclosure">
                  <summary>模型思考过程</summary>
                  <pre>{traceReasoning}</pre>
                </details>
              ) : null}
              {traceToolEvents.length ? (
                <details className="agent-disclosure">
                  <summary>工具调用 · {traceToolEvents.length} 条事件</summary>
                  <div className="agent-disclosure-events">
                    {traceToolEvents.map((event) => (
                      <p className={event.type === "tool_failed" ? "failed" : ""} key={event.id}>
                        <b>{event.label || event.toolName}</b>
                        <span>{event.detail || "无附加信息"}</span>
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}
              <button
                className="agent-trace-replay"
                type="button"
                disabled={busy}
                onClick={() => void submit(selectedTrace.userMessage, selectedTrace.id)}
              >
                <Play size={13} />
                重放本次请求
              </button>
            </>
          ) : (
            <p className="agent-trace-empty">发送一条消息后，这里会记录模型、工具、耗时与 Token。</p>
          )}
        </section>
      ) : null}

      {settingsOpen ? <ProviderSettings onClose={() => setSettingsOpen(false)} /> : null}

      {controlsOpen ? (
        <section className="agent-control-panel" aria-label="Agent 上下文、权限与预算">
          <header>
            <span>
              <SlidersHorizontal size={14} />
              运行控制台
            </span>
            <small>这些设置只影响后续请求</small>
          </header>
          <div className="agent-control-grid">
            <section>
              <h4>上下文</h4>
              <label className="agent-range-field">
                <span>预算</span>
                <input
                  type="range"
                  min="800"
                  max="16000"
                  step="200"
                  value={contextBudget}
                  onChange={(event) => setContextBudget(Number(event.target.value))}
                />
                <b>{contextBudget}</b>
              </label>
              <label className="agent-check-field">
                <input
                  type="checkbox"
                  checked={includeMemories}
                  onChange={(event) => setIncludeMemories(event.target.checked)}
                />
                长期记忆
              </label>
              <label className="agent-check-field">
                <input
                  type="checkbox"
                  checked={includeSemantic}
                  onChange={(event) => setIncludeSemantic(event.target.checked)}
                />
                语义检索
              </label>
            </section>
            <section>
              <h4>安全边界</h4>
              <div className="agent-preset-buttons">
                <button type="button" onClick={() => applyPermissionPreset("read")}>
                  只读
                </button>
                <button type="button" onClick={() => applyPermissionPreset("proposal")}>
                  可生成提案
                </button>
              </div>
              <div className="agent-limit-grid">
                <label>
                  轮次
                  <input
                    type="number"
                    min="1"
                    max="8"
                    value={maxTurns}
                    onChange={(event) => setMaxTurns(Number(event.target.value))}
                  />
                </label>
                <label>
                  工具
                  <input
                    type="number"
                    min="0"
                    max="32"
                    value={maxToolCalls}
                    onChange={(event) => setMaxToolCalls(Number(event.target.value))}
                  />
                </label>
                <label>
                  Token
                  <input
                    type="number"
                    min="4096"
                    step="4096"
                    value={maxTotalTokens}
                    onChange={(event) => setMaxTotalTokens(Number(event.target.value))}
                  />
                </label>
              </div>
            </section>
          </div>
          <details className="agent-control-details">
            <summary>
              <ShieldCheck size={13} />
              工具权限 · {allowedTools.length}/{allTools.length}
              {askBeforeTools.length ? ` · ${askBeforeTools.length} 个逐次询问` : ""}
            </summary>
            <p className="agent-permission-hint">
              第一列允许 Agent 使用该工具；第二列「每次询问」会在每次调用前暂停并等待你授权，决策会记录在运行追踪里。
              propose_* 工具只生成提案，写入始终需要你确认。
            </p>
            <div className="agent-tool-permissions ask-columns">
              {allTools.map((tool) => (
                <div className="agent-tool-permission-row" key={tool}>
                  <label>
                    <input type="checkbox" checked={allowedTools.includes(tool)} onChange={() => toggleTool(tool)} />
                    {toolLabels[tool]}
                  </label>
                  <label className="ask-every-time" title="每次调用前询问">
                    <input
                      type="checkbox"
                      checked={askBeforeTools.includes(tool)}
                      onChange={() =>
                        setAskBeforeTools((state) =>
                          state.includes(tool) ? state.filter((item) => item !== tool) : [...state, tool]
                        )
                      }
                    />
                    每次询问
                  </label>
                </div>
              ))}
            </div>
          </details>
          <details className="agent-control-details agent-extension-manager">
            <summary>
              <Workflow size={13} />
              扩展模板 · 提示词 {extensions.promptPresets.length} / 权限包 {extensions.toolProfiles.length} / 工具方案{" "}
              {extensions.customTools.length}
            </summary>
            <div className="agent-extension-io">
              <button type="button" onClick={exportExtensions}>
                <Download size={12} />
                导出 JSON
              </button>
              <label>
                <Upload size={12} />
                导入 JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void importExtensions(event.target.files?.[0])}
                />
              </label>
            </div>
            <div className="agent-extension-section">
              <h4>群聊成员</h4>
              {agentRoster.map((member) => (
                <div className="agent-extension-row" key={member.id}>
                  <button
                    type="button"
                    title={member.prompt}
                    onClick={() => setMessage((value) => insertAgentMention(value, member.handle))}
                  >
                    <Bot size={12} />@{member.handle}
                    <small>
                      {member.role}
                      {member.model ? ` · ${member.model}` : ""} · {member.allowedTools.length} 个工具
                    </small>
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`把当前工具权限应用给 ${member.handle}`}
                    title="把当前勾选的工具权限应用给此 Agent"
                    onClick={() =>
                      void persistExtensions({
                        ...extensions,
                        members: extensions.members.map((item) =>
                          item.id === member.id ? { ...item, allowedTools: [...allowedTools] } : item
                        )
                      })
                    }
                  >
                    <ShieldCheck size={12} />
                  </button>
                  {!member.builtIn ? (
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`删除 ${member.handle}`}
                      onClick={() =>
                        void persistExtensions({
                          ...extensions,
                          members: extensions.members.filter((item) => item.id !== member.id)
                        })
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                </div>
              ))}
              <div className="agent-extension-create prompt agent-member-create">
                <input
                  value={newMemberHandle}
                  placeholder="@名称"
                  aria-label="自定义 Agent 名称"
                  onChange={(event) => setNewMemberHandle(event.target.value)}
                />
                <input
                  value={newMemberRole}
                  placeholder="职责，例如：对白顾问"
                  aria-label="自定义 Agent 职责"
                  onChange={(event) => setNewMemberRole(event.target.value)}
                />
                <input
                  value={newMemberModel}
                  placeholder="专用模型（可选）"
                  aria-label="自定义 Agent 专用模型"
                  onChange={(event) => setNewMemberModel(event.target.value)}
                />
                <textarea
                  value={newMemberPrompt}
                  placeholder="该成员的职责边界与工作要求"
                  aria-label="自定义 Agent 工作要求"
                  onChange={(event) => setNewMemberPrompt(event.target.value)}
                />
                <button
                  type="button"
                  disabled={!newMemberHandle.trim() || !newMemberRole.trim() || !newMemberPrompt.trim()}
                  onClick={addAgentMember}
                >
                  <Plus size={12} />
                  添加成员
                </button>
              </div>
            </div>
            <div className="agent-extension-section">
              <h4>提示词模板</h4>
              {extensions.promptPresets.map((preset) => (
                <div className="agent-extension-row" key={preset.id}>
                  <button type="button" title={preset.prompt} onClick={() => setMessage(preset.prompt)}>
                    <Sparkles size={12} />
                    {preset.name}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="删除提示词模板"
                    onClick={() =>
                      void persistExtensions({
                        ...extensions,
                        promptPresets: extensions.promptPresets.filter((item) => item.id !== preset.id)
                      })
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="agent-extension-create prompt">
                <input
                  value={newPromptName}
                  placeholder="模板名称"
                  aria-label="提示模板名称"
                  onChange={(event) => setNewPromptName(event.target.value)}
                />
                <textarea
                  value={newPromptValue}
                  placeholder="提示词正文"
                  aria-label="提示模板正文"
                  onChange={(event) => setNewPromptValue(event.target.value)}
                />
                <button
                  type="button"
                  disabled={!newPromptName.trim() || !newPromptValue.trim()}
                  onClick={addPromptPreset}
                >
                  <Plus size={12} />
                  保存模板
                </button>
              </div>
            </div>
            <div className="agent-extension-section">
              <h4>工具权限包</h4>
              {extensions.toolProfiles.map((profile) => (
                <div className="agent-extension-row" key={profile.id}>
                  <button type="button" onClick={() => applyToolProfile(profile.id)}>
                    <ShieldCheck size={12} />
                    {profile.name}
                    <small>{profile.allowedTools.length} 个工具</small>
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="删除工具权限包"
                    onClick={() =>
                      void persistExtensions({
                        ...extensions,
                        toolProfiles: extensions.toolProfiles.filter((item) => item.id !== profile.id)
                      })
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="agent-extension-create">
                <input
                  value={newProfileName}
                  placeholder="权限包名称"
                  aria-label="权限包名称"
                  onChange={(event) => setNewProfileName(event.target.value)}
                />
                <button type="button" disabled={!newProfileName.trim()} onClick={addToolProfile}>
                  <Plus size={12} />
                  保存当前权限
                </button>
              </div>
            </div>
            <div className="agent-extension-section">
              <h4>自定义工具方案</h4>
              {extensions.customTools.map((customTool) => (
                <div className="agent-extension-row" key={customTool.id}>
                  <button type="button" title={customTool.instruction} onClick={() => applyCustomTool(customTool.id)}>
                    <Wrench size={12} />
                    {customTool.name}
                    <small>{customTool.allowedTools.length} 个工具</small>
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="删除自定义工具方案"
                    onClick={() =>
                      void persistExtensions({
                        ...extensions,
                        customTools: extensions.customTools.filter((item) => item.id !== customTool.id)
                      })
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="agent-extension-create prompt">
                <input
                  value={newToolName}
                  placeholder="工具方案名称"
                  aria-label="工具方案名称"
                  onChange={(event) => setNewToolName(event.target.value)}
                />
                <textarea
                  value={newToolInstruction}
                  placeholder="执行时填入的任务说明"
                  aria-label="工具方案任务说明"
                  onChange={(event) => setNewToolInstruction(event.target.value)}
                />
                <button
                  type="button"
                  disabled={!newToolName.trim() || !newToolInstruction.trim()}
                  onClick={addCustomTool}
                >
                  <Plus size={12} />
                  保存工具方案
                </button>
              </div>
            </div>
          </details>
          {knownSources.length ? (
            <details className="agent-control-details">
              <summary>
                <BookOpenText size={13} />
                上下文资料 · 固定 {pinnedSourceKeys.length} / 排除 {excludedSourceKeys.length}
              </summary>
              <div className="agent-context-sources">
                {knownSources.map((source) => {
                  const key = sourceKey(source);
                  const pinned = pinnedSourceKeys.includes(key);
                  const excluded = excludedSourceKeys.includes(key);
                  return (
                    <button
                      className={pinned ? "pinned" : excluded ? "excluded" : ""}
                      type="button"
                      key={key}
                      title={`${source.title}：${source.snippet}`}
                      onClick={() => cycleSource(source)}
                    >
                      {pinned ? <Pin size={11} /> : excluded ? <Ban size={11} /> : <BookOpenText size={11} />}
                      <span>{source.title}</span>
                    </button>
                  );
                })}
              </div>
              <small>点击依次切换：普通 → 固定 → 排除。</small>
            </details>
          ) : null}
        </section>
      ) : null}

      <div className="agent-context-strip">
        <FilePenLine size={14} />
        <div className="agent-scope-switch" role="group" aria-label="Agent 作用域">
          <button
            className={agentScope === "chapter" ? "active" : ""}
            type="button"
            disabled={busy}
            aria-pressed={agentScope === "chapter"}
            onClick={() => setAgentScope("chapter")}
          >
            本章
          </button>
          <button
            className={agentScope === "project" ? "active" : ""}
            type="button"
            disabled={busy}
            aria-pressed={agentScope === "project"}
            title="跨大纲、资料与全项目检索；章节正文写入请切回本章"
            onClick={() => setAgentScope("project")}
          >
            全书
          </button>
        </div>
        <span title={agentScope === "project" ? "当前章节仅作为全书会话的锚点" : undefined}>
          {agentScope === "project" ? "项目全局" : (current?.plan.title ?? "尚未选择章节")}
        </span>
        <select
          aria-label="选择 Agent 会话分支"
          value={activeBranchId}
          disabled={busy}
          onChange={(event) => void manageSession("select-branch", { branchId: event.target.value })}
        >
          {(session?.branches ?? [{ id: "main", title: "主会话", createdAt: "" }]).map((branch) => (
            <option value={branch.id} key={branch.id}>
              {branch.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          title="从当前位置创建对话分支"
          aria-label="创建对话分支"
          onClick={() => void manageSession("create-branch")}
        >
          <GitBranch size={13} />
        </button>
        {pendingApprovalCount ? <b>{pendingApprovalCount} 待确认</b> : null}
      </div>
      <details className="agent-room-strip">
        <summary>
          <Bot size={13} />
          创作群聊 · {agentRoster.length} 位成员
        </summary>
        <div className="agent-room-members">
          <button type="button" onClick={() => setMessage((value) => insertAgentMention(value, "全体"))}>
            @全体
          </button>
          {agentRoster.map((member) => (
            <button
              className={`agent-member-${member.color}`}
              type="button"
              key={member.id}
              title={`${member.role}：${member.prompt}`}
              onClick={() => setMessage((value) => insertAgentMention(value, member.handle))}
            >
              @{member.handle}
              <small>{member.role}</small>
            </button>
          ))}
        </div>
      </details>

      {pendingApprovalCount ? (
        <div className="agent-bulk-approval-bar">
          <span>
            {resolving ? <LoaderCircle className="spinning" size={13} /> : <CheckCheck size={13} />}
            {resolving ? "正在写入已确认提案…" : `${pendingApprovalCount} 项提案等待处理`}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setConfirmation({
                kind: "approve",
                proposalIds: pendingProposals.map((proposal) => proposal.id),
                dataProposalIds: pendingDataProposals.map((proposal) => proposal.id),
                scopeLabel: `全部 ${pendingApprovalCount} 项待确认提案`
              })
            }
          >
            {resolving ? "处理中" : "一键确认全部"}
          </button>
        </div>
      ) : null}

      <div
        className="agent-chat-log"
        ref={logRef}
        aria-live="polite"
        onScroll={(event) => {
          const node = event.currentTarget;
          shouldAutoScrollRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 72;
        }}
      >
        {visibleMessages.map((item) =>
          item.role === "tool" ? (
            <details className={`agent-tool-event ${item.toolStatus === "failed" ? "failed" : ""}`} key={item.id}>
              <summary>
                <Wrench size={13} />
                <span>{item.toolName ? toolLabels[item.toolName] : "Agent 工具"}</span>
                <small>{item.toolStatus === "failed" ? "调用失败" : "调用完成"}</small>
                {item.toolStatus === "failed" ? <X size={13} /> : <Check size={13} />}
              </summary>
              <p>{item.content}</p>
              {item.reasoning ? (
                <details className="agent-disclosure nested">
                  <summary>调用前思考</summary>
                  <pre>{item.reasoning}</pre>
                </details>
              ) : null}
            </details>
          ) : (
            <article className={`agent-message ${item.role} ${item.kind === "plan" ? "plan" : ""}`} key={item.id}>
              <div className="agent-message-meta">
                <span>
                  {item.role === "assistant"
                    ? `${item.agentName ?? "Agent"}${item.kind === "plan" ? " · 执行计划" : ""}`
                    : "你"}
                </span>
                {item.role === "assistant" ? (
                  <button
                    className={item.favorite ? "active" : ""}
                    type="button"
                    disabled={busy}
                    aria-label={item.favorite ? "取消收藏" : "收藏回答"}
                    title={item.favorite ? "取消收藏" : "收藏回答"}
                    onClick={() => void manageSession("toggle-favorite", { messageId: item.id })}
                  >
                    <Star size={12} fill={item.favorite ? "currentColor" : "none"} />
                  </button>
                ) : null}
              </div>
              {item.reasoning ? (
                <details className="agent-disclosure agent-message-reasoning">
                  <summary>模型思考过程</summary>
                  <pre>{item.reasoning}</pre>
                </details>
              ) : null}
              {item.role === "user" && item.content.length > 6_000 ? (
                <details className="agent-long-user-message">
                  <summary>
                    <FileText size={13} />
                    长资料 · {item.content.length.toLocaleString("zh-CN")} 字符（点击展开）
                  </summary>
                  <MarkdownContent className="agent-message-body" content={item.content} />
                </details>
              ) : (
                <MarkdownContent className="agent-message-body" content={item.content} />
              )}
              {item.kind === "plan" && item.planStatus === "pending" ? (
                <div className="agent-plan-actions">
                  <span>确认后才会调用工具或生成修改提案。</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void submit("按已确认计划执行。", undefined, { mode: "execute-plan", planMessageId: item.id })
                    }
                  >
                    <Play size={13} />
                    执行此计划
                  </button>
                </div>
              ) : null}
              {item.sources?.length ? (
                <div className="agent-source-list" aria-label="本次回答引用来源">
                  <BookOpenText size={12} />
                  {item.sources.map((source) => (
                    <span key={`${source.kind}-${source.id}`} title={source.snippet}>
                      {source.title}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          )
        )}

        {session?.collaborationRuns.slice(-3).map((run) => (
          <details className={`agent-collaboration-run ${run.status}`} key={run.id} open={run.status === "running"}>
            <summary>
              <Workflow size={14} />
              <span>
                <b>多 Agent 协作</b>
                <small>
                  {run.participantIds.length} 位成员 · {run.tasks.filter((task) => task.status === "approved").length}/
                  {run.tasks.length} 项通过
                </small>
              </span>
              <em>
                {run.status === "completed"
                  ? "已完成"
                  : run.status === "failed"
                    ? "失败"
                    : run.status === "cancelled"
                      ? "已停止"
                      : "协作中"}
              </em>
            </summary>
            <div className="agent-collaboration-body">
              <div className="agent-collaboration-roster">
                {run.agents.map((state) => {
                  const member = agentRoster.find((item) => item.id === state.agentId);
                  return (
                    <span className={state.status} key={state.agentId}>
                      <i />@{member?.handle ?? state.agentId}
                      <small>{state.allowedTools.length} 个工具</small>
                    </span>
                  );
                })}
              </div>
              <div className="agent-collaboration-tasks">
                {run.tasks.map((task) => {
                  const assignee = agentRoster.find((item) => item.id === task.assignedTo);
                  return (
                    <details key={task.id}>
                      <summary>
                        <span>
                          @{assignee?.handle ?? task.assignedTo} · {task.title}
                        </span>
                        <small>
                          {task.status === "approved"
                            ? "已通过"
                            : task.status === "submitted"
                              ? "待验收"
                              : task.status === "rework"
                                ? `返工 ${task.attempt}/${task.maxAttempts}`
                                : task.status === "running"
                                  ? "执行中"
                                  : task.status === "failed"
                                    ? "失败"
                                    : "等待"}
                        </small>
                      </summary>
                      <p>{task.instruction}</p>
                      {task.feedback ? <blockquote>{task.feedback}</blockquote> : null}
                      {task.result ? <MarkdownContent content={task.result} /> : null}
                    </details>
                  );
                })}
              </div>
              {run.messages.length ? (
                <details className="agent-peer-messages">
                  <summary>Agent 间交接 · {run.messages.length} 条</summary>
                  {run.messages.map((message) => {
                    const from = agentRoster.find((item) => item.id === message.fromAgentId);
                    const recipients = message.toAgentIds
                      .map((id) => agentRoster.find((item) => item.id === id)?.handle ?? id)
                      .join("、");
                    return (
                      <p key={message.id}>
                        <b>@{from?.handle ?? message.fromAgentId}</b>
                        <span>→ {recipients || "协作组"}</span>
                        <small>{message.content}</small>
                      </p>
                    );
                  })}
                </details>
              ) : null}
            </div>
          </details>
        ))}

        {pendingProposals.map((proposal) => {
          const expanded = expandedProposal === proposal.id;
          const acceptedBlocks = proposal.blocks.filter((block) => block.status === "accepted");
          const proposedCharacters = proposal.blocks.reduce((total, block) => total + block.proposedText.length, 0);
          return (
            <section className="agent-proposal" key={proposal.id}>
              <div className="agent-proposal-heading">
                <FilePenLine size={15} />
                <div>
                  <strong>
                    {proposal.mode === "patch"
                      ? "结构化改稿"
                      : proposal.mode === "append"
                        ? "续写提案"
                        : "正文替换提案"}
                  </strong>
                  <span>
                    {proposal.blocks.length
                      ? `${proposal.blocks.length} 块 · ${proposedCharacters} 字符`
                      : `${proposal.content.length} 字符`}{" "}
                    · 尚未写入
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={expanded ? "收起提案" : "展开提案"}
                  onClick={() => setExpandedProposal(expanded ? undefined : proposal.id)}
                >
                  {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
              </div>
              {proposal.explanation ? <p className="agent-proposal-reason">{proposal.explanation}</p> : null}
              {proposal.review ? (
                <div className={`agent-editor-review ${proposal.review.warnings.length ? "warning" : "passed"}`}>
                  <strong>编辑完整性 {proposal.review.warnings.length ? "已回退/需关注" : "通过"}</strong>
                  <span>
                    {proposal.review.sceneCount} 场 · 编辑前 {proposal.review.sourceCharacters} / 编辑后{" "}
                    {proposal.review.finalCharacters} 字符 · 保留率 {Math.round(proposal.review.retainedRatio * 100)}%
                  </span>
                  {proposal.review.warnings.map((warning) => (
                    <small key={warning}>{warning}</small>
                  ))}
                </div>
              ) : null}
              {proposal.sourceContent ? (
                <details className="agent-editor-diff">
                  <summary>查看编辑前后对照</summary>
                  <div>
                    <section>
                      <b>编辑前 · 分场作家稿</b>
                      <pre>{proposal.sourceContent}</pre>
                    </section>
                    <section>
                      <b>编辑后 · 待确认稿</b>
                      <pre>{proposal.content}</pre>
                    </section>
                  </div>
                </details>
              ) : null}
              {proposal.blocks.length ? (
                <div className="agent-diff-blocks">
                  {proposal.blocks.map((block, index) => (
                    <article className={`agent-diff-block ${block.status}`} key={block.id}>
                      <header>
                        <strong>修改块 {index + 1}</strong>
                        <span>
                          {block.operation === "insert_after" ? "插入" : block.operation === "delete" ? "删除" : "替换"}
                        </span>
                        <small>
                          {block.status === "accepted" ? "已接受" : block.status === "rejected" ? "已拒绝" : "待审阅"}
                        </small>
                      </header>
                      {block.explanation ? <p>{block.explanation}</p> : null}
                      {block.originalText ? (
                        <pre className="agent-diff-before">
                          <b>−</b>
                          {block.originalText}
                        </pre>
                      ) : null}
                      {block.proposedText ? (
                        <pre className="agent-diff-after">
                          <b>+</b>
                          {block.proposedText}
                        </pre>
                      ) : null}
                      <footer>
                        <button
                          type="button"
                          disabled={busy}
                          className={block.status === "rejected" ? "selected" : ""}
                          onClick={() => void resolveProposal(proposal, "reject-block", block.id)}
                        >
                          拒绝此块
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={block.status === "accepted" ? "selected accept" : ""}
                          onClick={() => void resolveProposal(proposal, "accept-block", block.id)}
                        >
                          <Check size={13} />
                          接受此块
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
              ) : (
                <pre className={expanded ? "expanded" : ""}>{proposal.content}</pre>
              )}
              <div className="agent-proposal-actions">
                <button type="button" disabled={busy} onClick={() => void resolveProposal(proposal, "reject")}>
                  放弃
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={busy || (proposal.blocks.length > 0 && acceptedBlocks.length === 0)}
                  onClick={() => void resolveProposal(proposal, "apply")}
                >
                  <Check size={14} />
                  {proposal.blocks.length ? `写入已接受的 ${acceptedBlocks.length} 块` : "确认写入"}
                </button>
              </div>
            </section>
          );
        })}

        {latestAppliedProposal ? (
          <div className="agent-rollback">
            <span>最近一次 Agent 修改已写入，并保留了写入前快照。</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmation({ kind: "rollback", proposalId: latestAppliedProposal.id })}
            >
              <RotateCcw size={13} />
              撤销写入
            </button>
          </div>
        ) : null}

        {pendingDataProposals.map((proposal) => (
          <section className="agent-data-proposal" key={proposal.id}>
            <header>
              <Wrench size={14} />
              <span>
                <strong>
                  {
                    {
                      outline: "作品大纲",
                      scene: "场景计划",
                      character: "人物卡",
                      world: "世界观",
                      clue: "伏笔",
                      term: "术语",
                      timeline: "时间线",
                      conflict: "冲突",
                      beat: "叙事节拍",
                      project_data: "项目专属资料"
                    }[proposal.entityType]
                  }{" "}
                  提案
                </strong>
                <small>{proposal.title}</small>
              </span>
            </header>
            {proposal.explanation ? <p>{proposal.explanation}</p> : null}
            <AgentDataPreview proposal={proposal} />
            <footer>
              <button type="button" disabled={busy} onClick={() => void resolveDataProposal(proposal, "reject")}>
                放弃
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={() => void resolveDataProposal(proposal, "apply")}
              >
                <Check size={13} />
                确认更新资料
              </button>
            </footer>
          </section>
        ))}

        {running ? (
          <div className="agent-live-run">
            {streamReasoning ? (
              <details className="agent-disclosure">
                <summary>模型正在思考</summary>
                <pre>{streamReasoning}</pre>
              </details>
            ) : null}
            {streamText ? (
              <article className="agent-message assistant streaming">
                <span>Agent · 实时输出</span>
                <MarkdownContent className="agent-message-body" content={streamText} />
              </article>
            ) : null}
            <div className="agent-running">
              <LoaderCircle size={15} />
              <span>{stopping ? "正在停止 Agent" : liveEvents.at(-1)?.label || "Agent 正在准备上下文"}</span>
            </div>
            {liveEvents.some((event) => event.type.startsWith("tool_")) ? (
              <details className="agent-disclosure">
                <summary>工具调用</summary>
                <div className="agent-live-events" aria-label="实时工具状态">
                  {liveEvents
                    .filter((event) => event.type.startsWith("tool_"))
                    .slice(-6)
                    .map((event) => (
                      <span className={event.type.includes("failed") ? "failed" : ""} key={event.id}>
                        {event.type === "tool_started" ? <LoaderCircle size={12} /> : <Check size={12} />}
                        {event.label}
                      </span>
                    ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
        {error ? <div className="agent-error">{error}</div> : null}
      </div>

      {!session || session.messages.length <= 1 ? (
        <div className="agent-quick-prompts">
          {quickPrompts.map((prompt) => (
            <button type="button" key={prompt} onClick={() => void submit(prompt)}>
              <Sparkles size={13} />
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <details className="agent-focus-panel" open>
        <summary>本章关注</summary>
        <div>
          <span>节奏</span>
          <span>克制语气</span>
          <span>旧线索回收</span>
        </div>
      </details>

      <form
        className="agent-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="agent-composer-toolbar">
          <div className="agent-mode-switch" aria-label="Agent 运行模式">
            <button
              className={mode === "direct" ? "active" : ""}
              type="button"
              aria-pressed={mode === "direct"}
              onClick={() => setMode("direct")}
            >
              <Sparkles size={12} />
              直接
            </button>
            <button
              className={mode === "plan" ? "active" : ""}
              type="button"
              aria-pressed={mode === "plan"}
              onClick={() => setMode("plan")}
            >
              <ListChecks size={12} />
              Plan
            </button>
          </div>
          <div className="agent-mode-switch" aria-label="写作策略">
            <button
              className={writingApproach === "stable" ? "active" : ""}
              type="button"
              aria-pressed={writingApproach === "stable"}
              title="保持现有稳定、连贯的写作方式"
              onClick={() => setWritingApproach("stable")}
            >
              稳定
            </button>
            <button
              className={writingApproach === "inspiration" ? "active" : ""}
              type="button"
              aria-pressed={writingApproach === "inspiration"}
              title="有限视角、私人目标与延迟解释"
              onClick={() => setWritingApproach("inspiration")}
            >
              灵感
            </button>
            <button
              className={writingApproach === "compare" ? "active" : ""}
              type="button"
              aria-pressed={writingApproach === "compare"}
              title="生成稳定版和灵感版，仅供比较，不产生写入提案"
              onClick={() => setWritingApproach("compare")}
            >
              A/B
            </button>
          </div>
          <button
            className={yoloMode ? "agent-yolo-toggle active" : "agent-yolo-toggle"}
            type="button"
            disabled={busy}
            aria-pressed={yoloMode}
            title="本项目免审批执行工具并自动写入本轮修改，保留备份与冲突检查"
            onClick={() => updateAutomation({ yolo: !yoloMode })}
          >
            <Zap size={12} />
            YOLO
          </button>
          <label className="agent-automation-option" title="接受正文后提取有原句依据的本书资料；YOLO 中自动应用">
            <input
              type="checkbox"
              checked={automation.updateProjectData}
              disabled={busy}
              onChange={(event) => updateAutomation({ updateProjectData: event.target.checked })}
            />
            更新资料
          </label>
          <label className="agent-document-import" title="导入 TXT、Markdown、JSON、CSV 或 YAML 文档">
            <Paperclip size={12} />
            资料
            <input
              ref={documentInputRef}
              type="file"
              multiple
              disabled={busy}
              accept={agentTextDocumentAccept}
              onChange={(event) => void importTextDocuments(event.target.files)}
            />
          </label>
          <select
            aria-label="插入提示模板"
            defaultValue=""
            onChange={(event) => {
              const selected = event.target.value;
              if (selected.startsWith("custom-tool:")) {
                applyCustomTool(selected.slice("custom-tool:".length));
                event.currentTarget.value = "";
                return;
              }
              if (selected.startsWith("task-template:")) {
                const task = extensions.taskTemplates.find(
                  (item) => item.id === selected.slice("task-template:".length)
                );
                if (task) {
                  setMessage(task.message);
                  setMode(task.mode);
                }
                event.currentTarget.value = "";
                return;
              }
              const template = selected.startsWith("custom-prompt:")
                ? extensions.promptPresets.find((item) => item.id === selected.slice("custom-prompt:".length))
                : promptTemplates.find((item) => item.label === selected);
              if (template) {
                setMessage("value" in template ? template.value : template.prompt);
              }
              event.currentTarget.value = "";
            }}
          >
            <option value="">使用模板…</option>
            {promptTemplates.map((template) => (
              <option value={template.label} key={template.label}>
                {template.label}
              </option>
            ))}
            {extensions.promptPresets.length ? (
              <optgroup label="项目模板">
                {extensions.promptPresets.map((template) => (
                  <option value={`custom-prompt:${template.id}`} key={template.id}>
                    {template.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {extensions.customTools.length ? (
              <optgroup label="工具方案">
                {extensions.customTools.map((customTool) => (
                  <option value={`custom-tool:${customTool.id}`} key={customTool.id}>
                    {customTool.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {extensions.taskTemplates.length ? (
              <optgroup label="任务模板">
                {extensions.taskTemplates.map((task) => (
                  <option value={`task-template:${task.id}`} key={task.id}>
                    {task.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <button
            type="button"
            className="agent-save-task-template"
            disabled={!message.trim() || !project}
            title="把当前输入保存为任务模板（含模式），可随扩展 JSON 导入导出"
            onClick={() => void saveTaskTemplate()}
          >
            存为模板
          </button>
        </div>
        {textDocuments.length ? (
          <div className="agent-document-list" aria-label="待发送的文本文档">
            {textDocuments.map((document) => (
              <span key={document.id} title={`${document.name} · ${document.characters.toLocaleString("zh-CN")} 字符`}>
                <FileText size={11} />
                <b>{document.name}</b>
                <small>{document.characters.toLocaleString("zh-CN")} 字</small>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`移除 ${document.name}`}
                  onClick={() => setTextDocuments((items) => items.filter((item) => item.id !== document.id))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <AgentSelectionAttachments
          references={selectionReferences}
          disabled={busy}
          onCommentChange={useAgentSelectionStore.getState().updateComment}
          onRemove={useAgentSelectionStore.getState().removeReferences}
        />
        <div className="agent-composer-input">
          {mentionSuggestions.length ? (
            <div className="agent-mention-menu" role="listbox" aria-label="选择 Agent 成员">
              {mentionSuggestions.map((member) => (
                <button
                  type="button"
                  role="option"
                  key={member.id}
                  onClick={() => setMessage((value) => insertAgentMention(value, member.handle))}
                >
                  <b>@{member.handle}</b>
                  <span>{member.name}</span>
                  <small>{member.role}</small>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={composerRef}
            value={message}
            disabled={!current || busy}
            rows={3}
            aria-label="发送给创作 Agent 的消息"
            placeholder={
              agentScope === "project"
                ? "让全书 Agent 检查结构、设定与跨章节问题；输入 @ 可指定成员…"
                : "告诉 Agent 你想写什么；输入 @ 可指定导演、作家、编辑或资料员…"
            }
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
        </div>
        <div className="agent-composer-footer">
          <span>
            {(mode === "plan"
              ? "Plan 模式只生成计划，不调用工具"
              : yoloMode
                ? "AI YOLO：本轮新提案会自动写入"
                : "Enter 发送 · Shift + Enter 换行") +
              ` · ${composerCharacterCount.toLocaleString("zh-CN")}/${agentMessageCharacterLimit.toLocaleString("zh-CN")} 字符`}
            {runEstimate && composerPrompt.trim() ? (
              <em
                className="agent-run-estimate"
                title="发送前估算：输入 = 上下文 + 历史 + 消息 + 系统开销；输出按模型上限计"
              >
                {" "}
                · 估算输入 ~{runEstimate.promptTokens.toLocaleString("zh-CN")} tok / 输出上限{" "}
                {runEstimate.maxCompletionTokens.toLocaleString("zh-CN")} tok
                {runEstimate.estimatedCost !== undefined
                  ? ` / 费用 ≤ ${runEstimate.estimatedCost.toFixed(3)}（估算值）`
                  : "（估算值）"}
              </em>
            ) : null}
          </span>
          {running ? (
            <button
              className="stop"
              type="button"
              disabled={stopping}
              onClick={(event) => {
                // Restoring the composer can replace this node with the submit
                // button before the click's default action. Never submit it.
                event.preventDefault();
                cancel();
              }}
              aria-label="停止 Agent"
            >
              <CircleStop size={17} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={(!message.trim() && !textDocuments.length && !selectionReferences.length) || !current || busy}
              aria-label="发送消息"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </form>
      {pendingApproval && running ? (
        <div className="agent-tool-approval" role="alertdialog" aria-label="工具调用授权">
          <div>
            <strong>
              <ShieldCheck size={15} />
              Agent 请求调用「{toolLabels[pendingApproval.toolName]}」
            </strong>
            {pendingApproval.args ? <code>{pendingApproval.args.slice(0, 240)}</code> : null}
            <small>该工具设置了“每次询问”。拒绝后 Agent 会尝试换一种方式继续；3 分钟未响应视为拒绝。</small>
          </div>
          <div className="agent-tool-approval-actions">
            <button
              type="button"
              className="primary-button compact"
              onClick={() => {
                if (activeRequestIdRef.current) {
                  void bridge.approveAgentTool(activeRequestIdRef.current, pendingApproval.callId, true);
                }
                setPendingApproval(undefined);
              }}
            >
              允许本次
            </button>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => {
                if (activeRequestIdRef.current) {
                  void bridge.approveAgentTool(activeRequestIdRef.current, pendingApproval.callId, false);
                }
                setPendingApproval(undefined);
              }}
            >
              拒绝
            </button>
          </div>
        </div>
      ) : null}
      {confirmation ? (
        <div className="agent-confirm-backdrop">
          <section
            className={`agent-confirm-dialog ${confirmation.kind}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-confirm-title"
          >
            <div className="agent-confirm-icon" aria-hidden="true">
              {confirmation.kind === "rollback" ? <RotateCcw size={18} /> : <CheckCheck size={18} />}
            </div>
            <div>
              <h3 id="agent-confirm-title">
                {confirmation.kind === "rollback" ? "确认撤销 Agent 写入？" : "确认一键写入？"}
              </h3>
              <p>
                {confirmation.kind === "rollback"
                  ? "将用写入前快照恢复当前章节。请确认你没有需要先保存的手动修改。"
                  : `将接受尚未决定的修改块，并立即写入${confirmation.scopeLabel}。已经手动拒绝的修改块不会被重新接受。`}
              </p>
            </div>
            <footer>
              <button type="button" autoFocus onClick={() => setConfirmation(undefined)}>
                取消
              </button>
              <button
                className={confirmation.kind === "rollback" ? "danger" : "primary"}
                type="button"
                onClick={() => void confirmPendingAction()}
              >
                {confirmation.kind === "rollback" ? "确认撤销" : "确认并写入"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </aside>
  );
};
