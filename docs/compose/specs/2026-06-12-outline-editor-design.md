# [S1] 问题定义

当前大纲模块是占位页，用户无法直观地编辑小说结构（前提、主线冲突、结局方向、分卷和章节规划）。需要一个可视化的看板界面来管理大纲。

## 现状分析

- `OutlineSchema`定义了完整的数据结构：premise、mainConflict、endingDirection、volumes（包含chapters）
- 当前大纲模块是占位页，重定向到章节树
- PlanningPanel已有JSON编辑器，但缺乏可视化界面
- ChapterTree已有章节管理，但与大纲结构分离

## 目标

实现一个看板式大纲编辑器，让用户能够：

1. 直观地查看和编辑小说整体结构
2. 可视化管理分卷和章节
3. 通过拖拽快速调整结构
4. 快速编辑章节详情（目标、冲突点等）

## [S2] 整体架构

### 布局结构

```
┌─────────────────────────────────────────────────────────┐
│ 大纲总览 (前提/主线冲突/结局方向)                         │
├─────────────────────────────────────────────────────────┤
│ [分卷1]    │ [分卷2]    │ [分卷3]    │ [+ 新分卷]       │
│ ──────── │ ──────── │ ──────── │                 │
│ [章节卡片] │ [章节卡片] │ [章节卡片] │                 │
│ [章节卡片] │ [章节卡片] │           │                 │
│ [+ 新章节] │ [+ 新章节] │           │                 │
└─────────────────────────────────────────────────────────┘
```

### 核心功能

1. **顶部总览区**：编辑premise、mainConflict、endingDirection
2. **看板区**：分卷为列，章节为卡片
3. **拖拽排序**：章节可在分卷内/间拖动
4. **卡片详情**：点击卡片展开编辑目标、冲突点、备注

### 文件结构

```
apps/desktop/src/features/outline/
├── OutlineEditor.tsx          # 主编辑器组件
├── OutlineOverview.tsx        # 顶部总览区
├── VolumeColumn.tsx           # 分卷列组件
├── ChapterCard.tsx            # 章节卡片组件
├── ChapterDetailPanel.tsx     # 章节详情面板
└── useOutlineStore.ts         # 大纲UI状态管理
```

## [S3] 卡片设计

### 章节卡片内容

- **标题**：可编辑，点击后进入编辑模式
- **状态标签**：未规划/已规划/草稿中/修改中/完成，使用不同颜色
- **字数统计**：目标字数 vs 实际字数，带进度条
- **目标摘要**：最多显示2行，超出截断
- **操作按钮**：编辑（展开详情）、删除（确认后删除）

### 卡片交互

- **单击**：展开详情面板（可编辑goal、hook、notes、conflictPoints）
- **右键**：上下文菜单（复制/移动到/归档）
- **拖拽**：改变章节顺序或移动到其他分卷

### 状态颜色

```typescript
const statusColors = {
  unplanned: "#94a3b8", // 灰色
  planned: "#3b82f6", // 蓝色
  drafting: "#f59e0b", // 黄色
  revising: "#f97316", // 橙色
  done: "#22c55e" // 绿色
};
```

## [S4] 交互与数据流

### 数据流

```
用户操作 → useOutlineStore → useProjectStore → 持久化到项目文件
```

### 核心交互

1. **新增分卷**：点击"+ 新分卷"按钮，弹出输入框
2. **新增章节**：点击列底部"+ 新章节"，自动填充默认值
3. **编辑章节**：点击卡片展开详情，实时保存
4. **拖拽排序**：使用HTML5 Drag & Drop API
5. **删除**：确认后删除分卷/章节

### 状态管理

- `useOutlineStore`：管理大纲UI状态（选中项、展开状态）
- `useProjectStore`：管理大纲数据（调用现有updateOutline方法）

### 拖拽实现

```typescript
// 拖拽数据格式
interface DragData {
  type: "chapter" | "volume";
  id: string;
  sourceVolumeId?: string;
}

// 放置处理
const handleDrop = (targetVolumeId: string, targetIndex: number) => {
  // 1. 从源位置移除
  // 2. 插入到目标位置
  // 3. 更新顺序
};
```

## [S5] 测试策略

### 单元测试

- `useOutlineStore`的action测试
- 拖拽排序逻辑测试
- 数据验证（确保符合OutlineSchema）

### 集成测试

- 看板渲染测试
- 新增/编辑/删除分卷章节测试
- 拖拽交互测试

### E2E测试

- 完整的大纲编辑流程

## [S6] 实现计划

### Phase 1: 基础结构

1. 创建`useOutlineStore`（UI状态管理）
2. 创建`OutlineEditor`主组件
3. 创建`OutlineOverview`总览区
4. 创建`VolumeColumn`分卷列
5. 创建`ChapterCard`章节卡片

### Phase 2: 交互功能

1. 实现拖拽排序
2. 实现新增/编辑/删除
3. 实现章节详情面板

### Phase 3: 测试与优化

1. 编写单元测试
2. 编写集成测试
3. 优化性能和用户体验

## [S7] 依赖关系

### 新增依赖

- 无新增npm依赖，使用HTML5 Drag & Drop API

### 现有依赖

- `@inkforge/schemas`：OutlineSchema、VolumePlan、ChapterPlan
- `useProjectStore`：updateOutline、addVolume、addChapter等方法
- `lucide-react`：图标库

## [S8] 风险与注意事项

### 风险

1. **拖拽性能**：大量章节时可能卡顿 → 使用虚拟滚动优化
2. **数据一致性**：拖拽过程中确保数据完整 → 使用事务式更新
3. **移动端适配**：拖拽在移动端不友好 → 提供替代操作方式

### 注意事项

1. 保持与现有章节树的数据同步
2. 确保编辑操作的撤销/重做支持
3. 考虑大项目的性能优化
