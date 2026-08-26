import type { PrivateWorkScope } from "../domain/private-work-scope.js";
import {
  WatchedProjectAccessDeniedError,
  type PrivateWatchedProjectSource,
  type WatchedProjectDirectory,
  type WatchedProjectSnapshot,
  type WatchedProjectSummary,
} from "../domain/watched-project.js";

export class OwnerWatchedProjectSource implements PrivateWatchedProjectSource {
  constructor(
    private readonly projects: WatchedProjectDirectory,
    private readonly ownerScope: PrivateWorkScope,
  ) {}

  canReview(scope: PrivateWorkScope | null): boolean {
    return scope?.actorId === this.ownerScope.actorId &&
      scope.workspaceId === this.ownerScope.workspaceId;
  }

  list(scope: PrivateWorkScope): readonly WatchedProjectSummary[] {
    this.assertAuthorized(scope);
    return this.projects.list();
  }

  snapshot(
    id: string,
    scope: PrivateWorkScope,
  ): Promise<WatchedProjectSnapshot> {
    this.assertAuthorized(scope);
    return this.projects.snapshot(id);
  }

  private assertAuthorized(scope: PrivateWorkScope | null): void {
    if (!this.canReview(scope)) throw new WatchedProjectAccessDeniedError();
  }
}
