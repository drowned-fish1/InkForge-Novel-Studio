import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { ProjectStart } from "@/features/project/ProjectStart";
import { useProjectStore } from "@/stores/useProjectStore";
import { useProviderStore } from "@/stores/useProviderStore";

export const App = () => {
  const project = useProjectStore((state) => state.project);
  const loadRecentProjects = useProjectStore((state) => state.loadRecentProjects);
  const loadProviderStatus = useProviderStore((state) => state.loadProviderStatus);

  useEffect(() => {
    void loadProviderStatus();
    void loadRecentProjects();
  }, [loadProviderStatus, loadRecentProjects]);

  return project ? <AppShell /> : <ProjectStart />;
};
