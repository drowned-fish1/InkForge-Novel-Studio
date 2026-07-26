import { useMemo, useState } from "react";
import { BookOpen, Link2, MapPin, Network, Search, Users } from "lucide-react";
import { useLibraryStore } from "@/stores/useLibraryStore";

type RelationNode = { id: string; label: string; kind: "character" | "world" | "event" | "clue"; detail: string };
type RelationEdge = { from: string; to: string; label: string };

export const RelationshipCenter = () => {
  const characters = useLibraryStore((state) => state.characters);
  const worldEntries = useLibraryStore((state) => state.worldEntries);
  const timeline = useLibraryStore((state) => state.timeline);
  const clues = useLibraryStore((state) => state.clues);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");

  const { nodes, edges } = useMemo(() => {
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
        kind: "world" as const,
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
      }))
    ];
    const byLabel = new Map(allNodes.map((node) => [node.label, node.id]));
    const allEdges: RelationEdge[] = [];
    characters.forEach((character) => {
      character.currentState.relationships.forEach((relation) => {
        const target = Array.from(byLabel.entries()).find(([name]) => relation.includes(name));
        if (target)
          allEdges.push({
            from: `character:${character.id}`,
            to: target[1],
            label: relation.replace(target[0], "").trim() || "人物关系"
          });
      });
    });
    worldEntries.forEach((entry) => {
      entry.relatedCharacters.forEach((name) => {
        const to = byLabel.get(name);
        if (to)
          allEdges.push({ from: `world:${entry.id}`, to, label: entry.type === "location" ? "位于/活动" : "相关" });
      });
      entry.relatedClues.forEach((name) => {
        const to = byLabel.get(name);
        if (to) allEdges.push({ from: `world:${entry.id}`, to, label: "线索关联" });
      });
    });
    timeline.forEach((event) =>
      event.participants.forEach((name) => {
        const to = byLabel.get(name);
        if (to) allEdges.push({ from: `event:${event.id}`, to, label: "参与" });
      })
    );
    clues.forEach((clue) =>
      clue.relatedCharacters.forEach((name) => {
        const to = byLabel.get(name);
        if (to) allEdges.push({ from: `clue:${clue.id}`, to, label: "涉及" });
      })
    );
    return { nodes: allNodes, edges: allEdges };
  }, [characters, clues, timeline, worldEntries]);

  const selected = nodes.find((node) => node.id === selectedId);
  const relatedEdges = selected ? edges.filter((edge) => edge.from === selected.id || edge.to === selected.id) : edges;
  const connectedIds = new Set(relatedEdges.flatMap((edge) => [edge.from, edge.to]));
  const visibleNodes = nodes.filter((node) => {
    const matches =
      !query.trim() ||
      `${node.label} ${node.detail}`.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN"));
    return matches && (!selected || connectedIds.has(node.id));
  });
  const isolated = nodes.filter((node) => !edges.some((edge) => edge.from === node.id || edge.to === node.id)).length;
  const icons = { character: Users, world: MapPin, event: BookOpen, clue: Link2 };

  return (
    <section className="library-screen relationship-center">
      <header className="library-header">
        <div>
          <div className="crumb">资料</div>
          <h2>故事关系</h2>
          <p>从人物、世界观、事件与伏笔中自动提取关联，点击节点聚焦一层关系。</p>
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
        {selected ? (
          <button type="button" onClick={() => setSelectedId(undefined)}>
            显示全部关系
          </button>
        ) : null}
      </div>

      <div className="relationship-workspace">
        <div className="relationship-node-list">
          {visibleNodes.map((node) => {
            const Icon = icons[node.kind];
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
                  <small>{node.detail}</small>
                </span>
                <b>{count}</b>
              </button>
            );
          })}
        </div>
        <div className="relationship-edge-list">
          <header>
            <Network size={17} />
            <strong>{selected ? `${selected.label} 的关系` : "全部关系"}</strong>
            <span>{relatedEdges.length} 条</span>
          </header>
          {relatedEdges.map((edge, index) => {
            const from = nodes.find((node) => node.id === edge.from);
            const to = nodes.find((node) => node.id === edge.to);
            return (
              <article key={`${edge.from}-${edge.to}-${index}`}>
                <button type="button" onClick={() => setSelectedId(edge.from)}>
                  {from?.label}
                </button>
                <span>{edge.label}</span>
                <button type="button" onClick={() => setSelectedId(edge.to)}>
                  {to?.label}
                </button>
              </article>
            );
          })}
          {!relatedEdges.length ? (
            <div className="module-empty-state">
              <Link2 size={23} />
              <strong>还没有可识别关系</strong>
              <span>在人物关系、事件参与者或资料关联字段中补充名称后会自动出现。</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};
