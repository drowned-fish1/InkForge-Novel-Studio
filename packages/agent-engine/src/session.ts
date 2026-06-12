import { SelfReviewer, type SelfReviewInput, type SelfReviewResult } from "./review.js";

export type WritingSessionStatus = "planning" | "writing" | "paused" | "awaiting_decision" | "review" | "done";

export interface WritingScene {
  id: string;
  title: string;
  goal: string;
  contextSummary?: string;
  expectedCharacters?: string[];
  requiredTerms?: string[];
  lockedCanon?: string[];
}

export interface SceneDraft {
  sceneId: string;
  text: string;
  review?: SelfReviewResult;
  revisionCount: number;
}

export interface WritingCheckpoint {
  id: string;
  createdAt: string;
  label: string;
  state: Omit<WritingSessionState, "checkpoints">;
}

export interface WritingSessionState {
  id: string;
  status: WritingSessionStatus;
  scenes: WritingScene[];
  currentSceneIndex: number;
  drafts: SceneDraft[];
  checkpoints: WritingCheckpoint[];
  pendingDecision?: string;
  lastReview?: SelfReviewResult;
}

export interface WriteSceneRequest {
  scene: WritingScene;
  previousDrafts: SceneDraft[];
}

export type SceneWriter = (request: WriteSceneRequest) => string | Promise<string>;
export type SceneReviser = (
  request: WriteSceneRequest & { draft: SceneDraft; review: SelfReviewResult }
) => string | Promise<string>;

export interface WritingSessionManagerOptions {
  writer: SceneWriter;
  reviser?: SceneReviser;
  reviewer?: SelfReviewer;
  maxAutoRevisions?: number;
  now?: () => Date;
}

export class WritingSessionManager {
  private readonly writer: SceneWriter;
  private readonly reviser?: SceneReviser;
  private readonly reviewer: SelfReviewer;
  private readonly maxAutoRevisions: number;
  private readonly now: () => Date;
  private state: WritingSessionState;

  constructor(state: WritingSessionState, options: WritingSessionManagerOptions) {
    this.state = structuredClone(state);
    this.writer = options.writer;
    this.reviser = options.reviser;
    this.reviewer = options.reviewer ?? new SelfReviewer();
    this.maxAutoRevisions = options.maxAutoRevisions ?? 1;
    this.now = options.now ?? (() => new Date());
  }

  getState(): WritingSessionState {
    return structuredClone(this.state);
  }

  static create(id: string, scenes: WritingScene[]): WritingSessionState {
    return {
      id,
      status: "planning",
      scenes,
      currentSceneIndex: 0,
      drafts: [],
      checkpoints: []
    };
  }

  async runAutoLoop(): Promise<WritingSessionState> {
    if (this.state.status === "paused" || this.state.status === "awaiting_decision" || this.state.status === "done") {
      return this.getState();
    }

    if (this.state.status === "planning") {
      this.state.status = "writing";
    }

    while (this.state.currentSceneIndex < this.state.scenes.length) {
      const scene = this.state.scenes[this.state.currentSceneIndex];
      let text = await this.writer({ scene, previousDrafts: this.state.drafts });
      let draft: SceneDraft = { sceneId: scene.id, text, revisionCount: 0 };

      while (draft.revisionCount <= this.maxAutoRevisions) {
        this.state.status = "review";
        const review = this.reviewDraft(scene, draft.text);
        draft = { ...draft, review };
        this.state.lastReview = review;
        if (review.passed) break;

        if (!this.reviser || draft.revisionCount >= this.maxAutoRevisions) {
          this.commitDraft(draft);
          this.state.status = "awaiting_decision";
          this.state.pendingDecision = `Scene ${scene.title} did not pass self review.`;
          return this.getState();
        }

        text = await this.reviser({ scene, previousDrafts: this.state.drafts, draft, review });
        draft = { sceneId: scene.id, text, revisionCount: draft.revisionCount + 1 };
      }

      this.commitDraft(draft);
      this.state.currentSceneIndex += 1;
      this.state.status = "writing";
    }

    this.state.status = "done";
    return this.getState();
  }

  pause(): WritingSessionState {
    if (this.state.status === "writing" || this.state.status === "review") {
      this.state.status = "paused";
    }
    return this.getState();
  }

  resume(): WritingSessionState {
    if (this.state.status === "paused" || this.state.status === "awaiting_decision") {
      this.state.status = "writing";
      this.state.pendingDecision = undefined;
    }
    return this.getState();
  }

  createCheckpoint(label: string): WritingCheckpoint {
    const { checkpoints: _checkpoints, ...snapshot } = this.state;
    const checkpoint: WritingCheckpoint = {
      id: `checkpoint_${this.state.checkpoints.length + 1}`,
      createdAt: this.now().toISOString(),
      label,
      state: structuredClone(snapshot)
    };
    this.state.checkpoints.push(checkpoint);
    return structuredClone(checkpoint);
  }

  rollback(checkpointId: string): WritingSessionState {
    const checkpoint = this.state.checkpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }
    const checkpoints = this.state.checkpoints;
    this.state = { ...structuredClone(checkpoint.state), checkpoints };
    return this.getState();
  }

  private reviewDraft(scene: WritingScene, draft: string): SelfReviewResult {
    const input: SelfReviewInput = {
      sceneGoal: scene.goal,
      draft,
      contextSummary: scene.contextSummary,
      expectedCharacters: scene.expectedCharacters,
      requiredTerms: scene.requiredTerms,
      lockedCanon: scene.lockedCanon
    };
    return this.reviewer.review(input);
  }

  private commitDraft(draft: SceneDraft): void {
    const index = this.state.drafts.findIndex((item) => item.sceneId === draft.sceneId);
    if (index >= 0) {
      this.state.drafts[index] = draft;
    } else {
      this.state.drafts.push(draft);
    }
  }
}
