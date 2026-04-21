import { io } from "../index";

const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
const GLOBAL_COMPAT_EMIT =
  !isProduction && process.env.REALTIME_GLOBAL_BROADCAST_COMPAT === "true";

export function emitToWorkspace(workspaceId: string | undefined, event: string, payload: any) {
  if (!workspaceId) return;
  io.to(`workspace_${workspaceId}`).emit(event, payload);
  if (GLOBAL_COMPAT_EMIT) io.emit(event, payload);
}

export function emitToTenant(tenantId: string | undefined, event: string, payload: any) {
  if (!tenantId) return;
  io.to(`tenant_${tenantId}`).emit(event, payload);
  if (GLOBAL_COMPAT_EMIT) io.emit(event, payload);
}

export function emitToUser(userId: string | undefined, event: string, payload: any) {
  if (!userId) return;
  io.to(`user_${userId}`).emit(event, payload);
  if (GLOBAL_COMPAT_EMIT) io.emit(event, payload);
}

