// Workspace Context Management Service

interface WorkspaceInfo {
  workspaceId: string;
  workspaceName: string;
  domain: string;
}

// Get current workspace from localStorage
export const getCurrentWorkspace = (): string | null => {
  try {
    const accessToken = localStorage.getItem("accessToken");
    if (!accessToken) return null;
    
    const payload = JSON.parse(atob(accessToken.split(".")[1]));
    const userDomain = payload.domain || null;
    
    const currentWorkspace = localStorage.getItem("currentWorkspace");
    
    // If workspace is set, validate it belongs to current user's domain
    // If not valid, clear it and use domain instead
    if (currentWorkspace) {
      // Note: We can't fully validate workspace here since custom slugs are allowed
      // The backend will handle validation and correct invalid workspaces
      // We just return what's in localStorage, and the backend will fix it if needed
      return currentWorkspace;
    }

    // Fallback to domain if no workspace is set
    return userDomain;
  } catch (error) {
    console.error("Error getting current workspace:", error);
    return null;
  }
};

// Set current workspace in localStorage
export const setCurrentWorkspace = (workspaceId: string): void => {
  try {
    localStorage.setItem("currentWorkspace", workspaceId);
  } catch (error) {
    console.error("Error setting current workspace:", error);
  }
};

// Clear current workspace (fallback to domain)
export const clearCurrentWorkspace = (): void => {
  try {
    localStorage.removeItem("currentWorkspace");
  } catch (error) {
    console.error("Error clearing current workspace:", error);
  }
};

// Get workspace info from user's accessible workspaces
export const getWorkspaceInfo = (
  workspaceId: string,
  userWorkspaces: any[]
): WorkspaceInfo | null => {
  try {
    const workspace = userWorkspaces.find(
      (ws) => ws.workspaceDomain === workspaceId && ws.isActive
    );

    if (workspace) {
      return {
        workspaceId: workspace.workspaceDomain,
        workspaceName: workspace.workspaceName,
        domain: workspace.domain || getCurrentWorkspace() || "",
      };
    }

    return null;
  } catch (error) {
    console.error("Error getting workspace info:", error);
    return null;
  }
};

// Check if user has access to a specific workspace
export const hasWorkspaceAccess = (
  workspaceId: string,
  userWorkspaces: any[]
): boolean => {
  try {
    return userWorkspaces.some(
      (ws) => ws.workspaceDomain === workspaceId && ws.isActive
    );
  } catch (error) {
    console.error("Error checking workspace access:", error);
    return false;
  }
};

// Get all accessible workspace IDs for the current user
export const getAccessibleWorkspaceIds = (userWorkspaces: any[]): string[] => {
  try {
    return userWorkspaces
      .filter((ws) => ws.isActive)
      .map((ws) => ws.workspaceDomain);
  } catch (error) {
    console.error("Error getting accessible workspace IDs:", error);
    return [];
  }
};

