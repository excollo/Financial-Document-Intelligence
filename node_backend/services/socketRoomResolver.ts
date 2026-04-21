import { WorkspaceMembership } from "../models/WorkspaceMembership";

export async function resolveAuthorizedWorkspaceIds(userId: string, currentWorkspace?: string) {
  const memberships = await WorkspaceMembership.find({
    userId,
    status: "active",
  })
    .select("workspaceId")
    .lean();

  const workspaceIds = new Set<string>(memberships.map((m: any) => String(m.workspaceId)));
  if (currentWorkspace) {
    workspaceIds.add(String(currentWorkspace));
  }
  return Array.from(workspaceIds);
}

