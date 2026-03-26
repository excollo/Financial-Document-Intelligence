import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { workspaceService, WorkspaceDTO } from "@/services/workspaceService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AdminWorkspaceManagement() {
  const [items, setItems] = useState<WorkspaceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, { name: string; status: string }>>({});

  const load = async () => {
    try {
      setLoading(true);
      const res = await workspaceService.listWorkspaces();
      setItems(res.workspaces || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (ws: WorkspaceDTO) => {
    const draft = editing[ws.workspaceId] || { name: ws.name, status: ws.status };
    try {
      await workspaceService.updateWorkspace(ws.workspaceId, { name: draft.name, status: draft.status });
      toast.success("Workspace updated");
      setEditing((prev) => ({ ...prev, [ws.workspaceId]: { name: draft.name, status: draft.status } }));
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Update failed");
    }
  };

  const archive = async (ws: WorkspaceDTO) => {
    try {
      await workspaceService.archiveWorkspace(ws.workspaceId);
      toast.success("Workspace archived");
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Archive failed");
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Workspace Management</h1>
        <p className="text-sm text-gray-600">Create, view, and manage workspaces under your domain</p>
      </div>
      {loading ? (
        <div>Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-gray-600">No workspaces yet.</div>
      ) : (
        <div className="space-y-3">
          {items.map((ws) => {
            const draft = editing[ws.workspaceId] || { name: ws.name, status: ws.status };
            return (
              <div key={ws.workspaceId} className="border rounded p-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-500">{ws.domain} · {ws.slug} · {ws.workspaceId}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      value={draft.name}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [ws.workspaceId]: { ...draft, name: e.target.value } }))}
                      className="w-64"
                    />
                    <Select value={draft.status} onValueChange={(v) => setEditing((prev) => ({ ...prev, [ws.workspaceId]: { ...draft, status: v } }))}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => save(ws)}>Save</Button>
                  <Button variant="destructive" onClick={() => archive(ws)}>Archive</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


