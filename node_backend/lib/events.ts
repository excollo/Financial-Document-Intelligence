import { Notification } from "../models/Notification";
import { User } from "../models/User";
import { Domain } from "../models/Domain";

// Generic audit/notification event payload used across controllers
type EventPayload = {
  actorUserId?: string;
  domain: string;
  action: string;
  resourceType: string;
  resourceId: string;
  title?: string;
  metadata?: Record<string, any>;
  notifyUserIds?: string[];
  notifyWorkspace?: boolean; // If true, notify all users in the workspace
  notifyAdminsOnly?: boolean; // If true, notify only admins in the domain
};

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Resolve which users should be notified for a workspace-scoped event.
// Includes primary domain users and (optionally) invited users with access.
async function getWorkspaceUserIds(domain: string, actorUserId?: string): Promise<string[]> {
  try {
    // Get users who have access to this workspace
    const users = await User.find({
      $or: [
        { domain }, // Primary domain users
        { "accessibleWorkspaces.workspaceDomain": domain, "accessibleWorkspaces.isActive": true } // Cross-workspace users
      ]
    }).select('_id role domain');
    
    // Filter based on user type and actor
    return users
      .filter(user => {
        const userId = user._id.toString();
        
        // If this is the actor themselves, always include them
        if (actorUserId && userId === actorUserId) {
          return true;
        }
        
        // Primary domain users (workspace owners) see all notifications
        if (user.domain === domain) {
          return true;
        }
        
        // Invited users only see their own notifications
        if (user.role === 'admin' || user.domain === domain) {
          return true;
        }
        
        return false;
      })
      .map(user => user._id.toString());
  } catch (error) {
    console.error('Error getting workspace users:', error);
    return [];
  }
}

export async function publishEvent(evt: EventPayload) {
  const { actorUserId, domain, action, resourceType, resourceId, title, metadata, notifyUserIds, notifyWorkspace, notifyAdminsOnly } = evt;
  
  // Get domainId from domain name
  let domainId: string | undefined;
  try {
    const domainRecord = await Domain.findOne({ domainName: domain, status: "active" });
    if (domainRecord) {
      domainId = domainRecord.domainId;
    } else {
      // Fallback: try to find by domain string if domainName doesn't match exactly
      const domainRecordByDomain = await Domain.findOne({ domainName: { $regex: new RegExp(domain.replace(/\./g, "\\."), "i") }, status: "active" });
      if (domainRecordByDomain) {
        domainId = domainRecordByDomain.domainId;
      }
    }
  } catch (error) {
    console.error("Error fetching domainId for event:", error);
  }
  
  // If domainId is still not found, try to get it from the first user with this domain
  if (!domainId) {
    try {
      const userWithDomain = await User.findOne({ domain }).select("domainId").lean();
      if (userWithDomain && (userWithDomain as any).domainId) {
        domainId = (userWithDomain as any).domainId;
      }
    } catch (error) {
      console.error("Error fetching domainId from user:", error);
    }
  }
  
  // If still no domainId, log warning but continue (backward compatibility)
  if (!domainId) {
    console.warn(`Warning: Could not find domainId for domain "${domain}". Notification may fail validation.`);
  }
  
  // Note: ActivityLog creation removed from publishEvent
  // Use auditLogger.logActivity() directly if ActivityLog is needed
  // publishEvent is now only for creating Notifications

  // Determine who to notify
  let userIdsToNotify: string[] = [];
  
  if (notifyUserIds && notifyUserIds.length) {
    userIdsToNotify = notifyUserIds;
  } else if (notifyAdminsOnly) {
    const admins = await User.find({ domain, role: 'admin' }).select('_id');
    userIdsToNotify = admins.map(a => a._id.toString());
  } else if (notifyWorkspace) {
    userIdsToNotify = await getWorkspaceUserIds(domain, actorUserId);
  }

  // Create notifications for all users
  if (userIdsToNotify.length > 0) {
    const notifs = userIdsToNotify.map((uid) => {
      const notifData: any = {
        id: genId("ntf"),
        userId: uid,
        domain,
        type: action,
        title: title || action,
        body: (metadata && metadata.message) || undefined,
        resourceType,
        resourceId,
      };
      
      // Add domainId if available
      if (domainId) {
        notifData.domainId = domainId;
      }
      
      return new Notification(notifData);
    });
    
    // Save notifications (validation will fail if domainId is missing, but we tried our best)
    for (const n of notifs) {
      try {
        await n.save();
      } catch (error: any) {
        // If validation fails due to missing domainId, try to get it and retry
        if (error.errors?.domainId && !domainId) {
          console.error(`Failed to save notification due to missing domainId for domain "${domain}"`);
          // Skip this notification - we can't proceed without domainId
        } else {
          throw error; // Re-throw other errors
        }
      }
    }
  }
}



