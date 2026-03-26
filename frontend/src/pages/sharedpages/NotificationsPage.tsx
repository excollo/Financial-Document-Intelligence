import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/sharedcomponents/Navbar";
import { notificationsService } from "@/services/api";
import { Check, Bell, MoreVertical, Trash2, Filter, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body?: string;
  isRead: boolean;
  createdAt: string;
};

// Lists notifications for the current user and workspace.
// Admins will also receive admin-scoped notifications (e.g., new user registered).
const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState<"all" | "today" | "last7" | "last15" | "last30">("all");
  const [showTimeFilter, setShowTimeFilter] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);

  const formatDateTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const load = async (p: number = page) => {
    setLoading(true);
    try {
      const data = await notificationsService.list({ page: p, pageSize: 50 });
      setItems(data.items || []);
      const inferred = (p - 1) * 50 + ((data.items || []).length || 0);
      setTotal(typeof (data as any).total === "number" ? (data as any).total : inferred);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(page);
  }, [page]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showTimeFilter) {
        const dropdown = document.querySelector('[data-time-filter-dropdown]');
        if (dropdown && !dropdown.contains(event.target as Node)) {
          setShowTimeFilter(false);
        }
      }
    };

    if (showTimeFilter) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTimeFilter]);

  const markAllRead = async () => {
    await notificationsService.markAllRead();
    await load(page);
    window.location.reload();
  };

  const markRead = async (id: string) => {
    await notificationsService.markRead(id);
    await load(page);
  };

  const deleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the click event on the parent
    if (window.confirm("Are you sure you want to delete this notification?")) {
      try {
        await notificationsService.delete(id);
        await load(page);
      } catch (error) {
        console.error("Failed to delete notification:", error);
        alert("Failed to delete notification. Please try again.");
      }
    }
  };

  const openNotification = async (n: NotificationItem) => {
    // Mark as read first
    if (!n.isRead) {
      try { await notificationsService.markRead(n.id); } catch {}
    }

    const anyN: any = n as any;
    const resourceType = anyN.resourceType || anyN.type; // backend may send resourceType
    const resourceId = anyN.resourceId || anyN.documentId || anyN.drhpId || anyN.id;

    try {
      switch ((resourceType || "").toLowerCase()) {
        case "document":
          if (resourceId) navigate(`/doc/${resourceId}`);
          else navigate(`/dashboard`);
          break;
        case "summary":
          if (anyN.documentId) navigate(`/doc/${anyN.documentId}`);
          else navigate(`/dashboard`);
          break;
        case "report":
          if (anyN.drhpId) navigate(`/compare/${anyN.drhpId}`);
          else if (anyN.documentId) navigate(`/compare/${anyN.documentId}`);
          else navigate(`/dashboard`);
          break;
        case "directory":
          // Could pass query like ?dir=id if supported; fallback to dashboard
          navigate(`/dashboard`);
          break;
        case "user":
          navigate(`/admin/users`);
          break;
        default:
          // Fallback: try to infer from title
          if (/report/i.test(n.title)) navigate(`/compare/${anyN.drhpId || anyN.documentId || ""}`);
          else if (/summary|rhp|drhp/i.test(n.title)) navigate(`/doc/${anyN.documentId || anyN.resourceId || ""}`);
          else navigate(`/dashboard`);
      }
    } catch {
      navigate(`/dashboard`);
    }
  };

  const getTimeFilteredItems = (items: NotificationItem[]) => {
    if (timeFilter === "all") return items;
    
    const now = new Date();
    const filterStart = new Date();
    
    switch (timeFilter) {
      case "today":
        filterStart.setHours(0, 0, 0, 0);
        break;
      case "last7":
        filterStart.setDate(now.getDate() - 7);
        break;
      case "last15":
        filterStart.setDate(now.getDate() - 15);
        break;
      case "last30":
        filterStart.setDate(now.getDate() - 30);
        break;
      default:
        return items;
    }
    
    return items.filter((n) => {
      const notificationDate = new Date(n.createdAt);
      return notificationDate >= filterStart;
    });
  };

  const filtered = getTimeFilteredItems(items).filter((n) =>
    (n.title || "").toLowerCase().includes(search.toLowerCase()) ||
    (n.body || "").toLowerCase().includes(search.toLowerCase())
  );

  // Pagination display helpers (50 per page)
  const pageSize = 50;
  const totalCount = typeof total === "number" ? total : ((page - 1) * pageSize + items.length);
  const hasAny = totalCount > 0;
  const rangeStart = hasAny ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = hasAny ? (page - 1) * pageSize + items.length : 0;
  const hasPrev = page > 1;
  const hasNext = typeof total === "number" ? page * pageSize < totalCount : items.length === pageSize;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar
        showSearch
        searchValue={search}
        onSearchChange={setSearch}
        onSidebarOpen={() => {}}
        sidebarOpen={false}
      />
      <main className="flex-1 max-w-[75vw] w-full mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-extrabold text-[#232323]">Notifications center</h1>
          <div className="flex items-center gap-4">
            {/* Pagination (header, left of Time Filter Dropdown) */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                {rangeStart}
                {"–"}
                {rangeEnd} of {totalCount}
              </span>
              <button
                className="p-1 rounded disabled:opacity-40 hover:bg-gray-100"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!hasPrev || loading}
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4 text-gray-600" />
              </button>
              <button
                className="p-1 rounded disabled:opacity-40 hover:bg-gray-100"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext || loading}
                title="Next page"
              >
                <ChevronRight className="h-4 w-4 text-gray-600" />
              </button>
            </div>

            {/* Time Filter Dropdown */}
            <div className="relative" data-time-filter-dropdown>
              <button
                className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                onClick={() => setShowTimeFilter(!showTimeFilter)}
              >
                <Filter className="h-4 w-4" />
                <span>
                  {timeFilter === "all" && "All Time"}
                  {timeFilter === "today" && "Today"}
                  {timeFilter === "last7" && "Last 7 days"}
                  {timeFilter === "last15" && "Last 15 days"}
                  {timeFilter === "last30" && "Last 30 days"}
                </span>
                <ChevronDown className="h-4 w-4" />
              </button>
              
              {showTimeFilter && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                  <div className="py-1">
                    <button
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                        timeFilter === "all" ? "bg-[#F7F5F0] text-[#4B2A06]" : "text-gray-700"
                      }`}
                      onClick={() => {
                        setTimeFilter("all");
                        setShowTimeFilter(false);
                      }}
                    >
                      All Time
                    </button>
                    <button
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                        timeFilter === "today" ? "bg-gray-100 text-[#4B2A06]" : "text-gray-700"
                      }`}
                      onClick={() => {
                        setTimeFilter("today");
                        setShowTimeFilter(false);
                      }}
                    >
                      Today
                    </button>
                    <button
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                        timeFilter === "last7" ? "bg-[#F7F5F0] text-[#4B2A06]" : "text-gray-700"
                      }`}
                      onClick={() => {
                        setTimeFilter("last7");
                        setShowTimeFilter(false);
                      }}
                    >
                      Last 7 days
                    </button>
                    <button
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                        timeFilter === "last15" ? "bg-[#F7F5F0] text-[#4B2A06]" : "text-gray-700"
                      }`}
                      onClick={() => {
                        setTimeFilter("last15");
                        setShowTimeFilter(false);
                      }}
                    >
                      Last 15 days
                    </button>
                    <button
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                        timeFilter === "last30" ? "bg-[#F7F5F0] text-[#4B2A06]" : "text-gray-700"
                      }`}
                      onClick={() => {
                        setTimeFilter("last30");
                        setShowTimeFilter(false);
                      }}
                    >
                      Last 30 days
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            <button
              className="text-sm text-[#4B2A06] hover:underline flex items-center gap-2"
              onClick={markAllRead}
            >
              <Check className="h-4 w-4" /> Mark all as read
            </button>
          </div>
        </div>

        {/* Filter Summary */}
        <div className="mb-4 text-sm text-gray-600">
          Showing {filtered.length} notification{filtered.length !== 1 ? 's' : ''} 
          {timeFilter !== "all" && (
            <span>
              {" "}from {timeFilter === "today" && "today"}
              {timeFilter === "last7" && "the last 7 days"}
              {timeFilter === "last15" && "the last 15 days"}
              {timeFilter === "last30" && "the last 30 days"}
            </span>
          )}
        </div>

        <div className=" h-[70vh] overflow-y-auto scrollbar-hide">
          {loading ? (
            <div className="text-gray-500">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-gray-500">No notifications</div>
          ) : (
            filtered.map((n) => (
              <div
                key={n.id}
                className={`flex items-start  rounded-md border-b border-gray-200 px-4 py-3  ${n.isRead ? "bg-white" : "bg-gray-50"}`}
                onClick={() => openNotification(n)}
                style={{ cursor: "pointer" }}
              >
                <div className="mt-1 mr-1">
                  
                    <Bell className={`h-4 w-4  bg-none ${n.isRead ? "text-[#4B2A06]" : "text-[#FF7A1A]"}`} />
                  
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <div className="font-semibold text-[#232323]">{n.title}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{formatDateTime(n.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!n.isRead && (
                        <button
                          className="text-sm text-[#4B2A06] hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            markRead(n.id);
                          }}
                        >
                          Mark read
                        </button>
                      )}
                      <button
                        className="text-red-500 hover:text-red-700 p-1"
                        onClick={(e) => deleteNotification(n.id, e)}
                        title="Delete notification"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {n.body && (
                    <div className="text-sm text-gray-600 mt-1">{n.body}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
};

export default NotificationsPage;



