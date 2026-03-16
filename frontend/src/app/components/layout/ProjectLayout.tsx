import { useEffect } from "react";
import { Outlet, useParams } from "react-router";
import { TopBar } from "./TopBar";
import { MotherSidebar } from "./MotherSidebar";
import { useOrganization } from "../../contexts/OrganizationContext";

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects, selectProject, selectedProject } = useOrganization();

  // Sync context selection from URL — enables deep-link and back-button support
  useEffect(() => {
    if (!projectId || !projects.length) return;
    const project = projects.find(p => p.id === projectId);
    if (project && project.id !== selectedProject?.id) {
      selectProject(project);
    }
  }, [projectId, projects, selectedProject, selectProject]);

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0b]">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <MotherSidebar />
        <main className="flex-1 ml-14 overflow-auto bg-[#0f1115]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
