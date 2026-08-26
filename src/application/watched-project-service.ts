import {
  WatchedProjectNotFoundError,
  type WatchedProjectDefinition,
  type WatchedProjectInspector,
  type WatchedProjectSnapshot,
  type WatchedProjectSummary,
} from "../domain/watched-project.js";

export class WatchedProjectService {
  private readonly projects: ReadonlyMap<string, WatchedProjectDefinition>;

  constructor(
    projects: readonly WatchedProjectDefinition[],
    private readonly inspector: WatchedProjectInspector,
  ) {
    this.projects = new Map(projects.map((project) => [project.id, project]));
  }

  list(): readonly WatchedProjectSummary[] {
    return [...this.projects.values()].map((project) => ({
      id: project.id,
      label: project.label,
      planFile: project.planFile,
      reviewWindowDays: project.reviewWindowDays,
    }));
  }

  async snapshot(id: string): Promise<WatchedProjectSnapshot> {
    const project = this.projects.get(id);
    if (!project) throw new WatchedProjectNotFoundError();
    return this.inspector.inspect(project);
  }
}
