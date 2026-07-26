import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  FileText,
  Link2,
  MapPin,
  Milestone,
  Network,
  Search,
  Shield,
  Swords,
  Users
} from "lucide-react";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";

type NodeKind = "character" | "location" | "faction" | "world" | "event" | "clue" | "conflict" | "chapter";

interface RelationNode {
  id: string;
  label: string;
  kind: NodeKind;
  detail: string;
}

interface RelationEdge {
  from: string;
  to: string;
  label: string;
}

const kindLabels: Record<NodeKind, string> = {
  character: "人物",
  location: "地点",
  faction: "势力",
  world: "世界观",
  event: "事件",
  clue: "伏笔",
  conflict: "冲突",
  chapter: "章节"
};

const kindIcons: Record<NodeKind, typeof Users> = {
  character: Users,
  location: MapPin,
  faction: Shield,
  world: BookOpen,
  event: BookOpen,
  clue: Milestone,
  conflict: Swords,
  chapter: FileText
};

export const RelationshipCenter = () => {
  const project = useProjectStore((state) => state.project);
  const selectChapterInStore = useProjectStore((state) => state.selectChapter);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const characters = useLibraryStore((state) => state.characters);
  const worldEntries = useLibraryStore((state) => state.worldEntries);
  const timeline = useLibraryStore((state) => state.timeline);
  const clues = useLibraryStore((state) => state.clues);
  const conflicts = useLibraryStore((state) => state.conflicts);
  const [selectedId, setSelectedId] = useState<string>();
  const [kindFilter, setKindFilter] = useState<NodeKind | "all">("all");
  const [query, setQuery] = useState("");

  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters) ?? [],
    [project?.outline.volumes]
  );

  const { nodes, edges } = useMemo(() => {
    const worldKind = (type: string): NodeKind =>
      type === "location" ? "location" : type === "faction" || type === "organization" ? "faction" : "world";
    const allNodes: RelationNode[] = [
      ...characters.map((item) => ({
        id: `character:${item.id}`,
        label: item.name,
        kind: "character" as const,
        detail: item.profile.identity || item.currentState.arc || "人物"
      })),
      ...worldEntries.map((item) => ({
        id: `world:${item.id}`,
        label: item.title,
        kind: worldKind(item.type),
        detail: item.summary || item.type
      })),
      ...timeline.map((item) => ({
        id: `event:${item.id}`,
        label: item.title,
        kind: "event" as const,
        detail: item.summary || item.location
      })),
      ...clues.map((item) => ({
        id: `clue:${item.id}`,
        label: item.title,
        kind: "clue" as const,
        detail: item.expectedPayoff || item.status
      })),
      ...conflicts.map((item) => ({
        id: `conflict:${item.id}`,
        label: item.title,
        kind: "conflict" as const,
        detail: item.stakes || item.summary || "冲突"
      })),
      ...chapters.map((item) => ({
        id: `chapter:${item.id}`,
        label: item.title,
        kind: "chapter" as const,
        detail: item.goal || `第 ${item.number} 章`
      }))
    ];

    const byLabel = new Map<string, string>();
    for (const node of allNodes) {
      if (!byLabel.has(node.label)) {
        byLabel.set(node.label, node.id);
      }
    }
    for (const character of characters) {
      for (const alias of character.aliases) {
        if (!byLabel.has(alias)) {
          byLabel.set(alias, `character:${character.id}`);
        }
      }
    }
    const chapterNodeId = (chapterId?: string) =>
      chapterId && chapters.some((chapter) => chapter.id === chapterId) ? `chapter:${chapterId}` : undefined;

    const allEdges: RelationEdge[] = [];
    const pushEdge = (from: string, to: string | undefined, label: string) => {
      if (to && from !== to) {
        allEdges.push({ from, to, label });
      }
    };

    characters.forEach((character) => {
      const from = `character:${character.id}`;
      character.currentState.relationships.forEach((relation) => {
        const target = [...byLabel.entries()].find(([name]) => name.length >= 2 && relation.includes(name));
        if (target && target[1] !== from) {
          pushEdge(from, target[1], relation.replace(target[0], "").trim() || "人物关系");
        }
      });
      pushEdge(from, byLabel.get(character.currentState.location.trim()), "位于");
    });

    worldEntries.forEach((entry) => {
      const from = `world:${entry.id}`;
      entry.relatedCharacters.forEach((name) => pushEdge(from, byLabel.get(name.trim()), "关联人物"));
      entry.relatedClues.forEach((name) => pushEdge(from, byLabel.get(name.trim()), "线索关联"));
    });

    timeline.forEach((event) => {
      const from = `event:${event.id}`;
      event.participants.forEach((name) => pushEdge(from, byLabel.get(name.trim()), "参与"));
      pushEdge(from, byLabel.get(event.location.trim()), "发生于");
      pushEdge(from, chapterNodeId(event.chapterId), "发生于章节");
    });

    clues.forEach((clue) => {
      const from = `clue:${clue.id}`;
      clue.relatedCharacters.forEach((name) => pushEdge(from, byLabel.get(name.trim()), "涉及"));
      pushEdge(from, chapterNodeId(clue.plantedChapterId), "埋设于");
    });

    conflicts.forEach((conflict) => {
      const from = `conflict:${conflict.id}`;
      conflict.parties.forEach((name) => pushEdge(from, byLabel.get(name.trim()), "冲突方"));
      conflict.relatedCharacters.forEach((name) => pushEdge(from, byLabel.get(name.trim()), "涉及人物"));
      conflict.relatedFactions.forEach((name) => pushEdge(from, byLabel.get(name.trim()), "涉及势力"));
      conflict.chapterIds.forEach((chapterId) => pushEdge(from, chapterNodeId(chapterId), "展开于"));
    });

    chapters.forEach((chapter) => {
      const from = `chapter:${chapter.id}`;
      chapter.characters.forEach((name) => pushEdge(from, byLabel.get(name.trim()), "出场"));
      chapter.worldRefs.forEach((name) => pushEdge(from, byLabel.get(name.trim()), "引用设定"));
    });

    return { nodes: allNodes, edges: allEdges };
  }, [characters, worldEntries, timeline, clues, conflicts, chapters]);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  const outgoing = selected ? edges.filter((edge) => edge.from === selected.id) : [];
  const incoming = selected ? edges.filter((edge) => edge.to === selected.id) : [];
  const relatedEdges = selected ? [...outgoing, ...incoming] : edges;
  const connectedIds = new Set(relatedEdges.flatMap((edge) => [edge.from, edge.to]));

  const visibleNodes = nodes.filter((node) => {
    if (kindFilter !== "all" && node.kind !== kindFilter) return false;
    const matches =
      !query.trim() ||
      `${node.label} ${node.detail}`.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN"));
    return matches && (!selected || connectedIds.has(node.id) || node.id === selected.id);
  });
  const isolated = nodes.filter((node) => !edges.some((edge) => edge.from === node.id || edge.to === node.id)).length;

  const openChapter = (nodeId: string) => {
    const chapterId = nodeId.startsWith("chapter:") ? nodeId.slice("chapter:".length) : undefined;
    const chapter = chapters.find((item) => item.id === chapterId);
    if (chapter) {
      void selectChapterInStore(chapter).then(() => setSelectedModule("chapters"));
    }
  };

  const renderEdgeRow = (edge: RelationEdge, index: number) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    return (
      <article key={`${edge.from}-${edge.to}-${index}`}>
        <button type="button" onClick={() => setSelectedId(edge.from)}>
          {from?.label ?? "?"}
        </button>
        <span>{edge.label}</span>
        <button type="button" onClick={() => setSelectedId(edge.to)}>
          {to?.label ?? "?"}
        </button>
      </article>
    );
  };

  return (
    <section className="library-screen relationship-center">
      <header className="library-header">
        <div>
          <div className="crumb">资料</div>
          <h2>故事关系</h2>
          <p>覆盖人物、地点、势力、冲突、事件、伏笔和章节的全部关联，选中节点可查看双向引用。</p>
        </div>
        <div className="relationship-health">
          <Network size={18} />
          <b>{edges.length}</b> 条关系 · {isolated} 个孤立节点
        </div>
      </header>

      <div className="relationship-toolbar">
        <label>
          <Search size={15} />
          <input value={query} placeholder="搜索节点" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
          <option value="all">全部类别</option>
          {Object.entries(kindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {selected ? (
          <button type="button" onClick={() => setSelectedId(undefined)}>
            显示全部关系
          </button>
        ) : null}
      </div>

      <div className="relationship-workspace">
        <div className="relationship-node-list">
          {visibleNodes.map((node) => {
            const Icon = kindIcons[node.kind];
            const count = edges.filter((edge) => edge.from === node.id || edge.to === node.id).length;
            return (
              <button
                className={`${node.kind} ${node.id === selectedId ? "active" : ""}`}
                type="button"
                key={node.id}
                onClick={() => setSelectedId(node.id)}
              >
                <Icon size={16} />
                <span>
                  <strong>{node.label}</strong>
                  <small>
                    {kindLabels[node.kind]} · {node.detail}
                  </small>
                </span>
                <b>{count}</b>
              </button>
            );
          })}
        </div>
        <div className="relationship-edge-list">
          {selected ? (
            <>
              <header>
                <Network size={17} />
                <strong>{selected.label}</strong>
                <span>
                  {outgoing.length} 条出向 · {incoming.length} 条被引用
                </span>
                {selected.kind === "chapter" ? (
                  <button className="tiny-text-button" type="button" onClick={() => openChapter(selected.id)}>
                    打开章节
                  </button>
                ) : null}
              </header>
              <div className="relationship-direction">
                <h4>
                  <ArrowUpRight size={14} />
                  引用了（{outgoing.length}）
                </h4>
                {outgoing.map(renderEdgeRow)}
                {!outgoing.length ? <p className="muted">没有出向引用。</p> : null}
              </div>
              <div className="relationship-direction">
                <h4>
                  <ArrowDownLeft size={14} />
                  被引用（{incoming.length}）
                </h4>
                {incoming.map(renderEdgeRow)}
                {!incoming.length ? <p className="muted">没有被其他资料引用。</p> : null}
              </div>
            </>
          ) : (
            <>
              <header>
                <Network size={17} />
                <strong>全部关系</strong>
                <span>{edges.length} 条</span>
              </header>
              {edges.slice(0, 300).map(renderEdgeRow)}
              {!edges.length ? (
                <div className="module-empty-state">
                  <Link2 size={23} />
                  <strong>还没有可识别关系</strong>
                  <span>在人物关系、冲突各方、事件参与者或章节引用中补充名称后会自动出现。</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
};
