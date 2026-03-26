import React, { useEffect, useState } from "react";
import { Navbar } from "@/components/sharedcomponents/Navbar";
import { trashService, directoryService, documentService } from "@/services/api";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

const TrashPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await trashService.list({ page: 1, pageSize: 100 });
      setItems(res.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const restore = async (it: any) => {
    try {
      if (it.kind === "directory") await directoryService.restore(it.item.id);
      else await documentService.restore(it.item.id);
      toast.success("Restored");
      await load();
    } catch (e) {
      toast.error("Failed to restore");
    }
  };

  const filtered = items.filter((i) => (i.item?.name || "").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar showSearch searchValue={search} onSearchChange={setSearch} onSidebarOpen={() => {}} sidebarOpen={false} />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <h1 className="text-3xl font-extrabold text-[#232323] mb-6">Bin</h1>
        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-gray-500">No items in bin</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((i) => (
              <div key={`${i.kind}-${i.item.id}`} className="flex items-center justify-between border rounded px-3 py-2">
                <div>
                  <div className="font-medium text-gray-800">{i.item.name}</div>
                  <div className="text-xs text-gray-500">{i.kind}</div>
                </div>
                <button className="text-[#4B2A06] hover:underline flex items-center gap-2" onClick={() => restore(i)}>
                  <RotateCcw className="h-4 w-4" /> Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default TrashPage;


