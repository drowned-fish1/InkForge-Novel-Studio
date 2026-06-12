import {
  defaultProviderConfig,
  type Character,
  type Clue,
  type PromptTemplate,
  type Term,
  type TimelineEvent,
  type WorldEntry
} from "@inkforge/schemas";
import type { PlanningSession, ProjectSummary, ProviderConfigInput } from "@/types/app";

export interface BrowserProjectRecord {
  summary: ProjectSummary;
  chapterBodies: Record<string, string>;
  chapterHistory?: Record<string, Array<{ id: string; createdAt: string; content: string }>>;
  characters: Character[];
  worldEntries: WorldEntry[];
  timeline: TimelineEvent[];
  clues: Clue[];
  terms: Term[];
  prompts: Record<string, PromptTemplate>;
  summaries: Record<string, unknown>;
  planningSessions: PlanningSession[];
  importSnapshots: Record<string, unknown>;
  updatedAt: string;
}

export interface BrowserProjectStorage {
  activeProjectPath?: string;
  projects: Record<string, BrowserProjectRecord>;
}

export interface BrowserProviderStorage extends ProviderConfigInput {
  apiKey: string;
  updatedAt: string;
}

const projectStorageKey = "inkforge.browser.projects.v1";
const providerStorageKey = "inkforge.browser.provider.v1";

const defaultProvider: BrowserProviderStorage = {
  ...defaultProviderConfig,
  apiKey: "",
  updatedAt: ""
};

export const toOffsetIso = (date = new Date()): string => {
  const pad = (value: number) => String(Math.abs(Math.trunc(value))).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = pad(offsetMinutes / 60);
  const minutes = pad(offsetMinutes % 60);
  return `${date.toISOString().slice(0, 19)}${sign}${hours}:${minutes}`;
};

export const readProjectStorage = (): BrowserProjectStorage => {
  try {
    const parsed = JSON.parse(localStorage.getItem(projectStorageKey) ?? "");
    return { activeProjectPath: parsed.activeProjectPath, projects: parsed.projects ?? {} };
  } catch {
    return { projects: {} };
  }
};

export const writeProjectStorage = (storage: BrowserProjectStorage): void => {
  localStorage.setItem(projectStorageKey, JSON.stringify(storage));
};

export const readProviderStorage = (): BrowserProviderStorage => {
  try {
    return { ...defaultProvider, ...JSON.parse(localStorage.getItem(providerStorageKey) ?? "") };
  } catch {
    return defaultProvider;
  }
};

export const writeProviderStorage = (provider: BrowserProviderStorage): void => {
  localStorage.setItem(providerStorageKey, JSON.stringify(provider));
};

export const getProjectRecord = (projectPath: string): BrowserProjectRecord => {
  const record = readProjectStorage().projects[projectPath];
  if (!record) {
    throw new Error("项目不存在或尚未打开。");
  }
  return structuredClone({
    ...record,
    prompts: record.prompts ?? {},
    summaries: record.summaries ?? {},
    planningSessions: record.planningSessions ?? [],
    importSnapshots: record.importSnapshots ?? {},
    chapterHistory: record.chapterHistory ?? {}
  });
};

export const saveProjectRecord = (record: BrowserProjectRecord): void => {
  const storage = readProjectStorage();
  const updated = {
    ...record,
    updatedAt: new Date().toISOString(),
    summary: {
      ...record.summary,
      meta: {
        ...record.summary.meta,
        updatedAt: toOffsetIso()
      }
    }
  };
  storage.projects[updated.summary.projectPath] = updated;
  storage.activeProjectPath = updated.summary.projectPath;
  writeProjectStorage(storage);
  window.__inkforgePersistProjectRecord?.(updated);
};

declare global {
  interface Window {
    __inkforgePersistProjectRecord?: (record: BrowserProjectRecord) => void;
  }
}
