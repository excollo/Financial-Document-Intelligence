import axios from "axios";
import { getCurrentWorkspace } from "./workspaceContext";

const API_URL = import.meta.env.VITE_API_URL;
// Attach shared link token to every request if present
const getSharedLinkToken = (): string | null => {
  try {
    return localStorage.getItem("sharedLinkToken");
  } catch {
    return null;
  }
};

// Attach shared link token header automatically if present.
axios.interceptors.request.use((config) => {
  // Don't send link token for auth endpoints
  const isAuthEndpoint = config.url?.includes('/auth/') ||
    config.url?.includes('/login') ||
    config.url?.includes('/register') ||
    config.url?.includes('/forgot-password') ||
    config.url?.includes('/reset-password');

  if (isAuthEndpoint) {
    return config;
  }

  const linkToken = getSharedLinkToken();
  if (linkToken) {
    // Axios v1 uses AxiosHeaders; prefer set when available
    if (config.headers && typeof (config.headers as any).set === "function") {
      (config.headers as any).set("x-link-token", linkToken);
    } else {
      config.headers = {
        ...(config.headers as any),
        "x-link-token": linkToken,
      } as any;
    }
  }
  return config;
});

// If a revoked/invalid link is used, clear it and let app fall back gracefully
// Clear any invalid/expired shared-link token automatically.
axios.interceptors.response.use(
  (res) => res,
  (error) => {
    try {
      // Check for domain mismatch error
      if (error?.response?.data?.code === "DOMAIN_MISMATCH" ||
        error?.response?.data?.message?.includes("cannot access documents from other domains")) {
        // Clear the link token on domain mismatch
        localStorage.removeItem("sharedLinkToken");
        // Remove linkToken from URL if present
        if (typeof window !== "undefined") {
          const newUrl = new URL(window.location.href);
          if (newUrl.searchParams.has("linkToken")) {
            newUrl.searchParams.delete("linkToken");
            window.history.replaceState({}, "", newUrl.toString());
          }
        }
      }

      const status = error?.response?.status as number | undefined;
      const url: string = error?.config?.url || "";
      const hasLinkToken = !!getSharedLinkToken();

      // NEW: Health-aware error handling for normal users
      if (status === 429 || (error?.response?.data?.error === "QUOTA_EXCEEDED")) {
        // If not on an admin page, show a "Contact Admin" message
        if (!window.location.pathname.startsWith('/admin')) {
          console.warn("External API Quota Exceeded. Prompting user to contact admin.");
          // We'll rely on the UI to display this or we can trigger a custom event
          window.dispatchEvent(new CustomEvent('api-health-error', {
            detail: { message: "System is experiencing high load or quota limits. Please contact your administrator." }
          }));
        }
      }

      if (hasLinkToken) {
        // If link resolve returns 404/410, or any 403 while a link token is attached, purge it
        if (
          url.includes("/shares/link/") &&
          (status === 404 || status === 410)
        ) {
          localStorage.removeItem("sharedLinkToken");
        } else if (status === 403) {
          localStorage.removeItem("sharedLinkToken");
        }
      }
    } catch { }
    return Promise.reject(error);
  }
);

// Helper function to get user domain from stored user data
const getUserDomain = (): string | null => {
  try {
    const accessToken = localStorage.getItem("accessToken");
    if (!accessToken) return null;

    // Decode JWT token to get user info
    const payload = JSON.parse(atob(accessToken.split(".")[1]));
    return payload.domain || null;
  } catch (error) {
    console.error("Error getting user domain:", error);
    return null;
  }
};

// Document Services
export const documentService = {
  async getAll(params?: { directoryId?: string; includeDeleted?: boolean }) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const linkToken = localStorage.getItem("sharedLinkToken");
    const search = new URLSearchParams();
    if (domain) search.set("domain", domain);
    if (params?.directoryId) search.set("directoryId", params.directoryId);
    if (params?.includeDeleted) search.set("includeDeleted", "1");
    if (linkToken) search.set("linkToken", linkToken);
    const qs = search.toString();
    const url = qs ? `${API_URL}/documents?${qs}` : `${API_URL}/documents`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  // Admin: Get all documents across all workspaces
  async getAllAdmin() {
    const token = localStorage.getItem("accessToken");
    console.log(
      "Calling admin documents API with token:",
      token ? "present" : "missing"
    );
    try {
      const response = await axios.get(`${API_URL}/documents/admin`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      // console.log("Admin documents API response:", response.data);
      return response.data;
    } catch (error) {
      console.error("Admin documents API error:", error);
      throw error;
    }
  },

  async getById(id: string, linkToken?: string) {
    try {
      // First try to get by id
      const token = localStorage.getItem("accessToken");
      const domain = getUserDomain();
      const currentWorkspace = getCurrentWorkspace();
      const params = new URLSearchParams();
      if (domain) params.set("domain", domain);
      if (linkToken) params.set("linkToken", linkToken);

      const url = `${API_URL}/documents/${id}?${params.toString()}`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // If not found by id, try to get by namespace
        const allDocs = await this.getAll();
        const doc = allDocs.find((d) => d.namespace === id);
        if (doc) {
          return doc;
        }
      }
      throw error;
    }
  },

  async create(document: {
    id: string;
    name: string;
    namespace?: string;
    status?: string;
    uploadedAt?: string;
    file?: any;
    fileType?: string;
    directoryId?: string | null;
  }) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const payload: any = {
      id: document.id,
      name: document.name,
      namespace: document.namespace,
      domain: domain, // Include domain in payload
    };
    // if (document.namespace) payload.namespace = document.namespace;
    if (document.status) payload.status = document.status;
    if (document.uploadedAt) payload.uploadedAt = document.uploadedAt;
    if (document.file) payload.file = document.file;
    if (document.fileType) payload.fileType = document.fileType;
    if (typeof document.directoryId !== "undefined") {
      payload.directoryId =
        document.directoryId === null ? "root" : document.directoryId;
    }

    const response = await axios.post(`${API_URL}/documents`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    // console.log("for namespace:", response);
    return response.data;
  },

  async update(
    id: string,
    document: Partial<{
      status: string;
      name: string;
      namespace: string;
      directoryId: string | null;
    }>
  ) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/documents/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/documents/${id}`;
    const payload: any = { ...document };
    if (typeof document.directoryId !== "undefined") {
      payload.directoryId =
        document.directoryId === null ? "root" : document.directoryId;
    }
    const response = await axios.put(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    // console.log("check namespace:", response);
    return response.data;
  },

  async delete(id: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/documents/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/documents/${id}`;
    const response = await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async restore(id: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const url = domain
      ? `${API_URL}/documents/${id}/restore?domain=${encodeURIComponent(
        domain
      )}`
      : `${API_URL}/documents/${id}/restore`;
    const response = await axios.post(url, null, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  },

  async checkExistingByNamespace(namespace: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/documents/check-existing?namespace=${encodeURIComponent(
        namespace
      )}&domain=${encodeURIComponent(domain)}`
      : `${API_URL}/documents/check-existing?namespace=${encodeURIComponent(
        namespace
      )}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async uploadRhp(file: File, drhpId: string) {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("drhpId", drhpId);
    formData.append("namespace", file.name); // Preserve .pdf extension

    const response = await axios.post(
      `${API_URL}/documents/upload-rhp`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
      }
    );
    return response.data;
  },

  async getAvailableForCompare(documentId: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/documents/available-for-compare/${documentId}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/documents/available-for-compare/${documentId}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async linkForCompare(drhpId: string, rhpId: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/documents/link-for-compare?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/documents/link-for-compare`;
    const response = await axios.post(
      url,
      { drhpId, rhpId },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
      }
    );
    return response.data;
  },

  async unlinkForCompare(documentId: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/documents/unlink-for-compare/${documentId}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/documents/unlink-for-compare/${documentId}`;
    const response = await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },
};

// Directory Services
export const directoryService = {
  async create(name: string, parentId?: string | null) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const payload: any = { name };
    if (typeof parentId !== "undefined") {
      payload.parentId = parentId === null ? "root" : parentId;
    }
    const url = domain
      ? `${API_URL}/directories?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/directories`;
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return res.data;
  },
  async getById(id: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/directories/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/directories/${id}`;
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return res.data;
  },
  async listChildren(
    id: string,
    opts?: {
      page?: number;
      pageSize?: number;
      sort?: string;
      order?: "asc" | "desc";
      includeDeleted?: boolean;
    }
  ) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    if (opts?.page) params.set("page", String(opts.page));
    if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
    if (opts?.sort) params.set("sort", opts.sort);
    if (opts?.order) params.set("order", opts.order);
    if (opts?.includeDeleted) params.set("includeDeleted", "1");
    const url = `${API_URL}/directories/${id}/children?${params.toString()}`;
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(getCurrentWorkspace() && { "x-workspace": getCurrentWorkspace() }),
      },
    });
    return res.data;
  },
  async update(
    id: string,
    data: Partial<{ name: string; parentId: string | null }>
  ) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const payload: any = { ...data };
    if (typeof data.parentId !== "undefined") {
      payload.parentId = data.parentId === null ? "root" : data.parentId;
    }
    const url = domain
      ? `${API_URL}/directories/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/directories/${id}`;
    const res = await axios.patch(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(getCurrentWorkspace() && { "x-workspace": getCurrentWorkspace() }),
      },
    });
    return res.data;
  },
  async move(id: string, newParentId?: string | null) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const payload: any = {
      newParentId:
        typeof newParentId === "undefined"
          ? undefined
          : newParentId === null
            ? "root"
            : newParentId,
    };
    const url = domain
      ? `${API_URL}/directories/${id}/move?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/directories/${id}/move`;
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(getCurrentWorkspace() && { "x-workspace": getCurrentWorkspace() }),
      },
    });
    return res.data;
  },
  async delete(id: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const url = domain
      ? `${API_URL}/directories/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/directories/${id}`;
    const res = await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(getCurrentWorkspace() && { "x-workspace": getCurrentWorkspace() }),
      },
    });
    return res.data;
  },
  async softDelete(id: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const url = domain
      ? `${API_URL}/directories/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/directories/${id}`;
    const res = await axios.delete(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },
  async restore(id: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const url = domain
      ? `${API_URL}/directories/${id}/restore?domain=${encodeURIComponent(
        domain
      )}`
      : `${API_URL}/directories/${id}/restore`;
    const res = await axios.post(url, null, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  // NEW: Search directories with fuzzy matching
  async search(query: string, limit: number = 10): Promise<Array<{
    id: string;
    name: string;
    normalizedName: string;
    similarity: number;
    documentCount: number;
    drhpCount: number;
    rhpCount: number;
    lastDocumentUpload?: Date;
  }>> {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    const url = `${API_URL}/directories/search?query=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return res.data;
  },

  // NEW: Check for duplicate/similar directories
  async checkDuplicate(name: string): Promise<{
    isDuplicate: boolean;
    exactMatch: {
      id: string;
      name: string;
      similarity: number;
    } | null;
    similarDirectories: Array<{
      id: string;
      name: string;
      normalizedName: string;
      similarity: number;
      documentCount: number;
      drhpCount: number;
      rhpCount: number;
      lastDocumentUpload?: Date;
    }>;
  }> {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    const res = await axios.post(
      `${API_URL}/directories/check-duplicate`,
      { name },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
      }
    );
    return res.data;
  },
};

// Share Services
export const shareService = {
  async resolveTokenRole(): Promise<"viewer" | "editor" | "owner" | null> {
    const token = localStorage.getItem("sharedLinkToken");
    if (!token) return null;
    try {
      const res = await axios.get(
        `${API_URL}/shares/link/${encodeURIComponent(token)}`
      );
      return (res.data?.role as any) || null;
    } catch {
      return null;
    }
  },
  async list(resourceType: "directory" | "document", resourceId: string) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const params = new URLSearchParams({ resourceType, resourceId });
    if (domain) params.set("domain", domain);
    const res = await axios.get(`${API_URL}/shares?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },
  async create(input: {
    resourceType: "directory" | "document";
    resourceId: string;
    scope: "user" | "workspace" | "link";
    principalId?: string;
    role: "viewer" | "editor" | "owner";
    expiresAt?: string;
    invitedEmail?: string;
  }) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const payload = { ...input } as any;
    if (domain) (payload as any).domain = domain;
    const res = await axios.post(`${API_URL}/shares`, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },
  async revoke(id: string) {
    const token = localStorage.getItem("accessToken");
    const res = await axios.delete(`${API_URL}/shares/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },
  async createOrRotateLink(
    resourceType: "directory" | "document",
    resourceId: string,
    role: "viewer" | "editor",
    expiresAt?: string
  ) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const payload: any = { resourceType, resourceId, role };
    if (expiresAt) payload.expiresAt = expiresAt;
    if (domain) payload.domain = domain;
    const res = await axios.post(`${API_URL}/shares/link`, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data as { token: string };
  },
  async resolveLink(tokenValue: string) {
    const res = await axios.get(
      `${API_URL}/shares/link/${encodeURIComponent(tokenValue)}`
    );
    return res.data;
  },
};

// Trash Services
export const trashService = {
  async list(opts?: { page?: number; pageSize?: number }) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    if (opts?.page) params.set("page", String(opts.page));
    if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
    const res = await axios.get(`${API_URL}/trash?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },
};

// Notifications Services
export const notificationsService = {
  async list(opts?: { unread?: boolean; page?: number; pageSize?: number }) {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    if (opts?.unread) params.set("unread", "true");
    if (opts?.page) params.set("page", String(opts.page));
    if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
    // console.log(
    //   "Notifications API call:",
    //   `${API_URL}/notifications?${params.toString()}`
    // );
    const res = await axios.get(
      `${API_URL}/notifications?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
      }
    );
    // console.log("Notifications API response:", res.data);
    return res.data;
  },
  async markRead(id: string) {
    const token = localStorage.getItem("accessToken");
    const res = await axios.post(`${API_URL}/notifications/${id}/read`, null, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },
  async markAllRead() {
    const token = localStorage.getItem("accessToken");
    const res = await axios.post(`${API_URL}/notifications/read-all`, null, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },
  async delete(id: string) {
    const token = localStorage.getItem("accessToken");
    const res = await axios.delete(`${API_URL}/notifications/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },
};

// Chat Services
export const chatService = {
  // Current user's chats
  getMine: async () => {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/chats?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/chats`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },
  // Admin: get all chats
  getAllAdmin: async () => {
    const token = localStorage.getItem("accessToken");
    const response = await axios.get(`${API_URL}/chats/admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  },

  // Admin: get chat monitoring stats
  getStats: async (): Promise<{
    totalChats: number;
    chatsPerUser: Array<{
      _id: { microsoftId?: string; userId?: string };
      count: number;
    }>;
    chatsPerDocument: Array<{ _id: string; count: number }>;
    messagesPerChat: Array<{ id: string; count: number; documentId: string }>;
  }> => {
    const token = localStorage.getItem("accessToken");
    const response = await axios.get(`${API_URL}/chats/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  },

  // Admin: delete any chat
  deleteAnyAdmin: async (id: string) => {
    const token = localStorage.getItem("accessToken");
    const response = await axios.delete(`${API_URL}/chats/admin/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  },
  getByDocumentId: async (documentId: string, linkToken?: string) => {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const effectiveLinkToken = linkToken || localStorage.getItem("sharedLinkToken");
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    if (effectiveLinkToken) params.set("linkToken", effectiveLinkToken);
    const url = params.toString()
      ? `${API_URL}/chats/document/${documentId}?${params.toString()}`
      : `${API_URL}/chats/document/${documentId}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  create: async (chat: any) => {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const payload = { ...chat, domain }; // Include domain in chat data
    const response = await axios.post(`${API_URL}/chats`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  addMessage: async (chatId: string, message: any) => {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/chats/${chatId}/messages?domain=${encodeURIComponent(
        domain
      )}`
      : `${API_URL}/chats/${chatId}/messages`;
    const response = await axios.post(url, message, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  update: async (id: string, chat: any) => {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/chats/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/chats/${id}`;
    const response = await axios.put(url, chat, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  delete: async (id: string) => {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/chats/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/chats/${id}`;
    const response = await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },
};

export interface Summary {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  documentId: string;
  userId?: string;
  microsoftId?: string;
}

export interface Report {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  drhpId: string;
  rhpId: string;
  drhpNamespace: string;
  rhpNamespace: string;
  userId?: string;
  microsoftId?: string;
}

export const reportService = {
  async getAll(): Promise<Report[]> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const linkToken = localStorage.getItem("sharedLinkToken");
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    if (linkToken) params.set("linkToken", linkToken);
    const url = params.toString()
      ? `${API_URL}/reports?${params.toString()}`
      : `${API_URL}/reports`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  // Admin: Get all reports across all workspaces
  async getAllAdmin(): Promise<Report[]> {
    const token = localStorage.getItem("accessToken");
    const response = await axios.get(`${API_URL}/reports/admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  },

  async getById(id: string): Promise<Report> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/reports/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/reports/${id}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async createComparison(
    drhpNamespace: string,
    rhpNamespace: string,
    prompt?: string
  ): Promise<{ jobId: string; report: Report; reportId: string }> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const payload = {
      drhpNamespace,
      rhpNamespace,
      domain, // Include domain in payload
      prompt:
        prompt || "Compare these documents and provide a detailed analysis",
    };
    const response = await axios.post(
      `${API_URL}/reports/create-report`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
      }
    );
    return response.data;
  },

  async create(report: Omit<Report, "id" | "updatedAt">): Promise<Report> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const payload = { ...report, domain }; // Include domain in payload
    const response = await axios.post(`${API_URL}/reports`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async update(id: string, report: Partial<Report>): Promise<Report> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/reports/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/reports/${id}`;
    const response = await axios.put(url, report, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async delete(id: string): Promise<void> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/reports/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/reports/${id}`;
    try {
      await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
      });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // If the report doesn't exist, treat as successfully deleted
        return;
      }
      throw error;
    }
  },

  async downloadPdf(id: string): Promise<Blob> {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    const response = await axios.get(
      `${API_URL}/reports/${id}/download-html-pdf`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
        responseType: "blob",
      }
    );
    return response.data;
  },

  async downloadDocx(id: string): Promise<Blob> {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    try {
      const response = await axios.get(`${API_URL}/reports/${id}/download-docx`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
        responseType: "blob",
        validateStatus: (status) => status === 200 || status === 503 || status === 500,
      });

      // Check if response is actually an error (JSON) disguised as blob
      if (response.status !== 200) {
        // Try to parse as JSON to get error message
        const text = await response.data.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = { error: "Unknown error", message: text };
        }
        throw new Error(errorData.message || errorData.error || "Failed to generate DOCX");
      }

      // Check if the blob is actually a DOCX
      const expectedType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (response.data.type && response.data.type !== expectedType && response.data.type !== "application/octet-stream") {
        // Might be an error response, try to parse it
        const text = await response.data.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
          throw new Error(errorData.message || errorData.error || "DOCX generation service unavailable");
        } catch (parseError) {
          throw new Error("Invalid DOCX response from server");
        }
      }

      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        // If it's an error response with data, try to extract the message
        if (error.response.data instanceof Blob) {
          const text = await error.response.data.text();
          try {
            const errorData = JSON.parse(text);
            throw new Error(errorData.message || errorData.error || "DOCX generation failed");
          } catch {
            throw new Error("DOCX generation service unavailable");
          }
        }
      }
      throw error;
    }
  },

  async downloadHtmlPdf(id: string): Promise<Blob> {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    try {
      const response = await axios.get(
        `${API_URL}/reports/${id}/download-html-pdf`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(currentWorkspace && { "x-workspace": currentWorkspace }),
          },
          responseType: "blob",
          validateStatus: (status) => status === 200 || status === 503 || status === 500,
        }
      );

      // Check if response is actually an error (JSON) disguised as blob
      if (response.status !== 200) {
        // Try to parse as JSON to get error message
        const text = await response.data.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = { error: "Unknown error", message: text };
        }
        throw new Error(errorData.message || errorData.error || "Failed to generate PDF");
      }

      // Check if the blob is actually a PDF
      if (response.data.type && response.data.type !== "application/pdf") {
        // Might be an error response, try to parse it
        const text = await response.data.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
          throw new Error(errorData.message || errorData.error || "PDF generation service unavailable");
        } catch (parseError) {
          throw new Error("Invalid PDF response from server");
        }
      }

      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        // If it's an error response with data, try to extract the message
        if (error.response.data instanceof Blob) {
          const text = await error.response.data.text();
          try {
            const errorData = JSON.parse(text);
            throw new Error(errorData.message || errorData.error || "PDF generation failed");
          } catch {
            throw new Error("PDF generation service unavailable");
          }
        }
      }
      throw error;
    }
  },
};

export const summaryService = {
  async getAll(): Promise<Summary[]> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const linkToken = localStorage.getItem("sharedLinkToken");
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    if (linkToken) params.set("linkToken", linkToken);
    const url = params.toString()
      ? `${API_URL}/summaries?${params.toString()}`
      : `${API_URL}/summaries`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  // Admin: Get all summaries across all workspaces
  async getAllAdmin(): Promise<Summary[]> {
    const token = localStorage.getItem("accessToken");
    const response = await axios.get(`${API_URL}/summaries/admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  },

  async getByDocumentId(documentId: string, linkToken?: string): Promise<Summary[]> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const effectiveLinkToken = linkToken || localStorage.getItem("sharedLinkToken");
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    if (effectiveLinkToken) params.set("linkToken", effectiveLinkToken);
    const url = params.toString()
      ? `${API_URL}/summaries/document/${documentId}?${params.toString()}`
      : `${API_URL}/summaries/document/${documentId}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async create(summary: Omit<Summary, "id" | "updatedAt">): Promise<Summary> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const payload = { ...summary, domain }; // Include domain in payload
    // Backend expects POST /api/summaries/create
    const response = await axios.post(`${API_URL}/summaries/create`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async update(id: string, summary: Partial<Summary>): Promise<Summary> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/summaries/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/summaries/${id}`;
    const response = await axios.put(url, summary, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async delete(id: string): Promise<void> {
    const token = localStorage.getItem("accessToken");
    const domain = getUserDomain();
    const currentWorkspace = getCurrentWorkspace();
    const url = domain
      ? `${API_URL}/summaries/${id}?domain=${encodeURIComponent(domain)}`
      : `${API_URL}/summaries/${id}`;
    await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
  },

  async downloadDocx(id: string): Promise<Blob> {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    try {
      const response = await axios.get(
        `${API_URL}/summaries/${id}/download-docx`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(currentWorkspace && { "x-workspace": currentWorkspace }),
          },
          responseType: "blob",
          validateStatus: (status) => status === 200 || status === 503 || status === 500,
        }
      );

      // Check if response is actually an error (JSON) disguised as blob
      if (response.status !== 200) {
        // Try to parse as JSON to get error message
        const text = await response.data.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = { error: "Unknown error", message: text };
        }
        throw new Error(errorData.message || errorData.error || "Failed to generate DOCX");
      }

      // Check if the blob is actually a DOCX
      const expectedType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (response.data.type && response.data.type !== expectedType && response.data.type !== "application/octet-stream") {
        // Might be an error response, try to parse it
        const text = await response.data.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
          throw new Error(errorData.message || errorData.error || "DOCX generation service unavailable");
        } catch (parseError) {
          throw new Error("Invalid DOCX response from server");
        }
      }

      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        // If it's an error response with data, try to extract the message
        if (error.response.data instanceof Blob) {
          const text = await error.response.data.text();
          try {
            const errorData = JSON.parse(text);
            const msg = errorData.message || errorData.error || (errorData.details ? `DOCX Error: ${errorData.details}` : "DOCX generation failed");
            throw new Error(msg);
          } catch (e: any) {
            // Only fall back if JSON parse fails or if the error thrown above is caught here (which it is)
            // We need to differentiate between JSON parse error and the error we just threw
            if (e.message !== "DOCX generation service unavailable" && e.message) {
              throw e;
            }
            throw new Error("DOCX generation service unavailable");
          }
        }

      }
      throw error;
    }
  },

  async downloadHtmlPdf(id: string): Promise<Blob> {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    try {
      const response = await axios.get(
        `${API_URL}/summaries/${id}/download-html-pdf`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(currentWorkspace && { "x-workspace": currentWorkspace }),
          },
          responseType: "blob",
          validateStatus: (status) => status === 200 || status === 503 || status === 500,
        }
      );

      // Check if response is actually an error (JSON) disguised as blob
      if (response.status !== 200) {
        // Try to parse as JSON to get error message
        const text = await response.data.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = { error: "Unknown error", message: text };
        }
        throw new Error(errorData.message || errorData.error || "Failed to generate PDF");
      }

      // Check if the blob is actually a PDF
      if (response.data.type && response.data.type !== "application/pdf") {
        // Might be an error response, try to parse it
        const text = await response.data.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
          throw new Error(errorData.message || errorData.error || "PDF generation service unavailable");
        } catch (parseError) {
          throw new Error("Invalid PDF response from server");
        }
      }

      return response.data;
    } catch (error: any) {
      if (error.response && error.response.data) {
        // If it's an error response with data, try to extract the message
        if (error.response.data instanceof Blob) {
          const text = await error.response.data.text();
          try {
            const errorData = JSON.parse(text);
            throw new Error(errorData.message || errorData.error || "PDF generation failed");
          } catch {
            throw new Error("PDF generation service unavailable");
          }
        }
      }
      throw error;
    }
  },
};

// Intelligence Job Services
export const jobService = {
  async getAll(params?: { directoryId?: string; workspaceId?: string }) {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = params?.workspaceId || getCurrentWorkspace();
    const search = new URLSearchParams();
    if (params?.directoryId) search.set("directoryId", params.directoryId);
    
    const url = search.toString() ? `${API_URL}/jobs?${search.toString()}` : `${API_URL}/jobs`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async getById(id: string) {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    const response = await axios.get(`${API_URL}/jobs/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async create(data: {
    directoryId: string;
    drhpId: string;
    rhpId: string;
    title?: string;
  }) {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    const response = await axios.post(`${API_URL}/jobs`, data, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  },

  async delete(id: string) {
    const token = localStorage.getItem("accessToken");
    const currentWorkspace = getCurrentWorkspace();
    const response = await axios.delete(`${API_URL}/jobs/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(currentWorkspace && { "x-workspace": currentWorkspace }),
      },
    });
    return response.data;
  }
};

// Health Services
export const healthService = {
  async getDetailedStatus() {
    const token = localStorage.getItem("accessToken");
    const response = await axios.get(`${API_URL}/health/admin/detailed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  },
  async getBasicStatus() {
    const response = await axios.get(`${API_URL}/health/basic`);
    return response.data;
  },
};

export default axios;
