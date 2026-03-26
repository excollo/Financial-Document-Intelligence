/**
 * Utility functions for tracking recent directory access
 * Tracks when directories are opened/closed and stores in localStorage
 * Workspace-specific: each workspace has its own recent directories list
 * Refreshes daily based on calendar date (resets at midnight, shows only today's directories)
 */

export interface RecentDirectory {
  id: string;
  name: string;
  lastAccessed: number;
  workspaceId: string;
}

const STORAGE_KEY_PREFIX = "recentDirectories_";
const MAX_RECENT = 20;

/**
 * Get storage key for a specific workspace
 */
const getStorageKey = (workspaceId: string | null): string => {
  return `${STORAGE_KEY_PREFIX}${workspaceId || "default"}`;
};

/**
 * Check if a timestamp is from today (same calendar date)
 */
const isToday = (timestamp: number): boolean => {
  const date = new Date(timestamp);
  const today = new Date();
  
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
};

/**
 * Track when a directory is opened (workspace-specific)
 */
export const trackDirectoryOpen = (
  directoryId: string,
  directoryName: string,
  workspaceId: string | null
): void => {
  try {
    if (!workspaceId) {
      console.warn("Cannot track directory open: workspace ID is required");
      return;
    }

    const storageKey = getStorageKey(workspaceId);
    const recentData = localStorage.getItem(storageKey);
    const recent: RecentDirectory[] = recentData ? JSON.parse(recentData) : [];

    // Remove if already exists (same directory in same workspace)
    const filtered = recent.filter(
      (r) => !(r.id === directoryId && r.workspaceId === workspaceId)
    );

    // Add to front with current timestamp
    filtered.unshift({
      id: directoryId,
      name: directoryName,
      lastAccessed: Date.now(),
      workspaceId: workspaceId,
    });

    // Keep only last MAX_RECENT
    const limited = filtered.slice(0, MAX_RECENT);
    localStorage.setItem(storageKey, JSON.stringify(limited));
  } catch (error) {
    console.error("Error tracking directory open:", error);
  }
};

/**
 * Get recent directories for a specific workspace (filtered by today's date)
 * Only returns directories accessed today (same calendar date)
 * Resets automatically when date changes (at midnight)
 */
export const getRecentDirectories = (workspaceId: string | null): RecentDirectory[] => {
  try {
    if (!workspaceId) {
      return [];
    }

    const storageKey = getStorageKey(workspaceId);
    const recentData = localStorage.getItem(storageKey);
    const recent: RecentDirectory[] = recentData ? JSON.parse(recentData) : [];

    // Filter to only show directories accessed today (same calendar date)
    // This automatically resets when the date changes (at midnight)
    const validRecent = recent.filter(
      (r) => isToday(r.lastAccessed) && r.workspaceId === workspaceId
    );

    // Sort by last accessed (most recent first)
    validRecent.sort((a, b) => b.lastAccessed - a.lastAccessed);

    // Update localStorage with filtered list if it changed (removes old entries from previous days)
    if (validRecent.length !== recent.length) {
      localStorage.setItem(storageKey, JSON.stringify(validRecent));
    }

    return validRecent;
  } catch (error) {
    console.error("Error getting recent directories:", error);
    return [];
  }
};

/**
 * Clear all recent directories for a specific workspace
 */
export const clearRecentDirectories = (workspaceId: string | null): void => {
  try {
    if (!workspaceId) {
      return;
    }
    const storageKey = getStorageKey(workspaceId);
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.error("Error clearing recent directories:", error);
  }
};

/**
 * Clear all recent directories across all workspaces
 */
export const clearAllRecentDirectories = (): void => {
  try {
    // Clear all keys that start with the prefix
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.error("Error clearing all recent directories:", error);
  }
};

/**
 * Update directory name in recent directories for a specific workspace
 * Called when a directory is renamed
 */
export const updateDirectoryName = (
  directoryId: string,
  newName: string,
  workspaceId: string | null
): void => {
  try {
    if (!workspaceId) {
      return;
    }

    const storageKey = getStorageKey(workspaceId);
    const recentData = localStorage.getItem(storageKey);
    const recent: RecentDirectory[] = recentData ? JSON.parse(recentData) : [];

    // Update the name if this directory exists in recent directories
    const updated = recent.map((r) => {
      if (r.id === directoryId && r.workspaceId === workspaceId) {
        return { ...r, name: newName };
      }
      return r;
    });

    localStorage.setItem(storageKey, JSON.stringify(updated));
  } catch (error) {
    console.error("Error updating directory name in recent directories:", error);
  }
};

/**
 * Remove directory from recent directories for a specific workspace
 * Called when a directory is deleted
 */
export const removeDirectoryFromRecent = (
  directoryId: string,
  workspaceId: string | null
): void => {
  try {
    if (!workspaceId) {
      return;
    }

    const storageKey = getStorageKey(workspaceId);
    const recentData = localStorage.getItem(storageKey);
    const recent: RecentDirectory[] = recentData ? JSON.parse(recentData) : [];

    // Remove the directory if it exists in recent directories
    const filtered = recent.filter(
      (r) => !(r.id === directoryId && r.workspaceId === workspaceId)
    );

    localStorage.setItem(storageKey, JSON.stringify(filtered));
  } catch (error) {
    console.error("Error removing directory from recent directories:", error);
  }
};

