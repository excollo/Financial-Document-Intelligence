import React, { useEffect, useState } from "react";
import { directoryService } from "@/services/api";
import { toast } from "sonner";
import { Folder as FolderIcon, ArrowLeft, Loader2, Home } from "lucide-react";

export interface MoveDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectDestination: (directoryId: string | null) => Promise<void> | void;
  currentDirectoryId?: string | null;
}

interface Item {
  kind: "directory" | "document";
  item: { id: string; name: string; parentId?: string | null };
}

export const MoveDocumentDialog: React.FC<MoveDocumentDialogProps> = ({
  open,
  onOpenChange,
  onSelectDestination,
  currentDirectoryId,
}) => {
  const [path, setPath] = useState<Array<{ id: string | null; name: string }>>([
    { id: null, name: "All files" },
  ]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDirId, setSelectedDirId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // Reset to root when opened
      setPath([{ id: null, name: "All files" }]);
      setSelectedDirId(null);
      void load("root");
    }
  }, [open]);

  const load = async (dirId: string) => {
    try {
      setLoading(true);
      const res = await directoryService.listChildren(dirId, { pageSize: 500 });
      const dirsOnly: Item[] = (res?.items || []).filter((i: Item) => i.kind === "directory");
      setItems(dirsOnly);
    } catch (e) {
      toast.error("Failed to load folders");
    } finally {
      setLoading(false);
    }
  };

  const enterFolder = async (dir: { id: string; name: string }) => {
    setPath((prev) => [...prev, { id: dir.id, name: dir.name }]);
    setSelectedDirId(null);
    await load(dir.id);
  };

  const goUp = async () => {
    if (path.length <= 1) return;
    const next = [...path.slice(0, -1)];
    setPath(next);
    await load(next[next.length - 1].id ? next[next.length - 1].id! : "root");
  };

  const handleChooseHere = async () => {
    try {
      setSubmitting(true);
      const dest = selectedDirId ?? (path[path.length - 1].id || null);
      await onSelectDestination(dest);
      onOpenChange(false);
      toast.success("Document moved");
    } catch (e) {
      toast.error("Failed to move document");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FolderIcon className="h-5 w-5 text-[#4B2A06]" />
            <h3 className="text-lg font-semibold">Move document</h3>
          </div>
          <button
            className="text-gray-500 hover:text-gray-700"
            onClick={() => onOpenChange(false)}
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
          {path.length > 1 ? (
            <button
              className="inline-flex items-center gap-1 text-[#4B2A06] hover:underline"
              onClick={goUp}
            >
              <ArrowLeft className="h-4 w-4" /> Up
            </button>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Home className="h-4 w-4" /> Root
            </span>
          )}
          <span className="mx-1">/</span>
          <span className="truncate" title={path[path.length - 1].name}>
            {path[path.length - 1].name}
          </span>
        </div>

        <div className="border rounded-md max-h-72 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading folders...
            </div>
          ) : items.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No folders here.</div>
          ) : (
            <ul>
              {items.map((i) => (
                <li
                  key={i.item.id}
                  className={`flex items-center gap-2 px-3 py-2 border-b last:border-b-0 cursor-pointer ${
                    selectedDirId === i.item.id ? "bg-[#ECE9E2]" : "hover:bg-gray-50"
                  }`}
                  onClick={() => setSelectedDirId(i.item.id)}
                  onDoubleClick={() => enterFolder({ id: i.item.id, name: i.item.name })}
                  title="Click to select, double-click to open"
                >
                  <input
                    type="radio"
                    name="dest-folder"
                    checked={selectedDirId === i.item.id}
                    onChange={() => setSelectedDirId(i.item.id)}
                    className="h-4 w-4 accent-[#4B2A06]"
                  />
                  <FolderIcon className="h-4 w-4 text-[#4B2A06]" />
                  <span className="truncate">{i.item.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="text-xs text-gray-500">
            {selectedDirId
              ? "Selected: folder"
              : `Current: ${currentDirectoryId ? "In a folder" : "Root"}`}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 rounded bg-[#4B2A06] text-white text-sm hover:bg-[#3A2004] disabled:opacity-50"
              onClick={handleChooseHere}
              disabled={submitting}
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Moving...
                </span>
              ) : (
                "Move here"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MoveDocumentDialog;


