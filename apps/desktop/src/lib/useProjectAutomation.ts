import { useEffect, useState } from "react";

interface AutomationSettings {
  yolo: boolean;
  logicReview: boolean;
  updateProjectData: boolean;
}
const defaults: AutomationSettings = { yolo: false, logicReview: true, updateProjectData: true };
const read = (projectPath?: string): AutomationSettings => {
  if (!projectPath || typeof window === "undefined") return defaults;
  try {
    const value = JSON.parse(window.localStorage.getItem(`inkforge.automation.${projectPath}`) ?? "{}");
    return Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => [key, typeof value[key] === "boolean" ? value[key] : fallback])
    ) as unknown as AutomationSettings;
  } catch {
    return defaults;
  }
};
export function useProjectAutomation(projectPath?: string) {
  const [settings, setSettings] = useState(() => read(projectPath));
  useEffect(() => {
    const reload = () => setSettings(read(projectPath));
    reload();
    window.addEventListener("inkforge:automation-changed", reload);
    return () => window.removeEventListener("inkforge:automation-changed", reload);
  }, [projectPath]);
  const update = (patch: Partial<AutomationSettings>) => {
    const next = { ...read(projectPath), ...patch };
    if (projectPath) window.localStorage.setItem(`inkforge.automation.${projectPath}`, JSON.stringify(next));
    setSettings(next);
    window.dispatchEvent(new Event("inkforge:automation-changed"));
  };
  return { settings, update };
}
