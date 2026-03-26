import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export interface WorkspaceDTO {
  workspaceId: string;
  domain: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "archived";
  color?: string;
  createdAt: string;
}

export const workspaceService = {
  async createWorkspace(data: { name: string; slug?: string; description?: string }): Promise<{ workspace: WorkspaceDTO }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.post(`${API_URL}/workspaces`, data, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async checkFirstLogin(): Promise<{ needsWorkspace: boolean; isAdmin: boolean; isNewDomain: boolean; needsOnboarding: boolean }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.get(`${API_URL}/workspaces/check-first-login`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async listWorkspaces(): Promise<{ workspaces: WorkspaceDTO[] }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.get(`${API_URL}/workspaces`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async getMyWorkspaces(): Promise<{
    workspaces: Array<{
      workspaceId: string;
      name: string;
      slug: string;
      description?: string;
      domain: string;
      role: string;
      joinedAt?: string;
    }>
  }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.get(`${API_URL}/workspaces/my-workspaces`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async getAvailableWorkspaces(): Promise<{
    workspaces: Array<{
      workspaceId: string;
      name: string;
      slug: string;
      description?: string;
      hasPendingRequest: boolean;
    }>
  }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.get(`${API_URL}/workspace-requests/available`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async requestWorkspaceAccess(workspaceId: string, message?: string): Promise<{ message: string; request: any }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.post(
      `${API_URL}/workspace-requests/request`,
      { workspaceId, message },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.data;
  },

  async getMyRequests(): Promise<{
    requests: Array<{
      id: string;
      workspaceId: string;
      workspace: { workspaceId: string; name: string } | null;
      status: string;
      requestedAt: string;
      reviewedAt?: string;
      rejectionReason?: string;
    }>
  }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.get(`${API_URL}/workspace-requests/my-requests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async updateWorkspace(workspaceId: string, updates: Partial<{ name: string; status: string; settings: any }>): Promise<{ workspace: WorkspaceDTO }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.patch(`${API_URL}/workspaces/${workspaceId}`, updates, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async archiveWorkspace(workspaceId: string): Promise<{ message: string; workspace: WorkspaceDTO }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.delete(`${API_URL}/workspaces/${workspaceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async listMembers(workspaceId: string): Promise<{ members: Array<{ _id: string; name?: string; email: string; status: string; role: string }> }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.get(`${API_URL}/workspaces/${workspaceId}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async addMember(workspaceId: string, payload: { userId?: string; email?: string }): Promise<{ message: string }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.post(`${API_URL}/workspaces/${workspaceId}/members`, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  async removeMember(workspaceId: string, memberId: string): Promise<{ message: string }> {
    const token = localStorage.getItem("accessToken");
    const res = await axios.delete(`${API_URL}/workspaces/${workspaceId}/members/${memberId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },
};

export default workspaceService;


