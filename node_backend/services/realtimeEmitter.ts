import { io } from "../index";
import { realtimeEventControlService } from "./realtimeEventControlService";

const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
const GLOBAL_COMPAT_EMIT =
  !isProduction && process.env.REALTIME_GLOBAL_BROADCAST_COMPAT === "true";

export async function emitToWorkspace(workspaceId: string | undefined, event: string, payload: any) {
  if (!workspaceId) return;
  const shouldEmit = await realtimeEventControlService.shouldEmit(event, `workspace_${workspaceId}`, payload || {});
  if (!shouldEmit) return;
  io.to(`workspace_${workspaceId}`).emit(event, payload);
  if (GLOBAL_COMPAT_EMIT) io.emit(event, payload);
}

export async function emitToTenant(tenantId: string | undefined, event: string, payload: any) {
  if (!tenantId) return;
  const shouldEmit = await realtimeEventControlService.shouldEmit(event, `tenant_${tenantId}`, payload || {});
  if (!shouldEmit) return;
  io.to(`tenant_${tenantId}`).emit(event, payload);
  if (GLOBAL_COMPAT_EMIT) io.emit(event, payload);
}

export async function emitToUser(userId: string | undefined, event: string, payload: any) {
  if (!userId) return;
  const shouldEmit = await realtimeEventControlService.shouldEmit(event, `user_${userId}`, payload || {});
  if (!shouldEmit) return;
  io.to(`user_${userId}`).emit(event, payload);
  if (GLOBAL_COMPAT_EMIT) io.emit(event, payload);
}

