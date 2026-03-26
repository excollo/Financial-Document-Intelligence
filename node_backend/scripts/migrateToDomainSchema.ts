/**
 * Migration Script: Add domainId to all schemas and link existing data
 * 
 * SAFE MIGRATION: This script ONLY ADDS domainId field - it does NOT:
 * - Delete any existing data
 * - Modify any existing fields
 * - Overwrite any existing domainId values
 * 
 * This script:
 * 1. Creates Domain records for all existing domains
 * 2. Links existing "exDev" workspace to appropriate domain
 * 3. Adds domainId to all documents, directories, users, workspaces, etc.
 *    (ONLY if domainId doesn't already exist)
 * 
 * Usage:
 *   npx ts-node scripts/migrateToDomainSchema.ts
 * 
 * Note: Run multiple times safely - it will skip records that already have domainId
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Domain } from "../models/Domain";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { Document } from "../models/Document";
import { Directory } from "../models/Directory";
import { Summary } from "../models/Summary";
import { Report } from "../models/Report";
import { Notification } from "../models/Notification";
import { Chat } from "../models/Chat";

dotenv.config();

async function migrateToDomainSchema() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is not set");
    }

    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Step 1: Create Domain records for all existing domains
    console.log("\n📋 Step 1: Creating Domain records...");
    const allUsers = await User.find({});
    const uniqueDomains = new Set<string>();
    
    allUsers.forEach((user: any) => {
      if (user.domain) {
        uniqueDomains.add(user.domain);
      }
    });

    const domainMap = new Map<string, string>(); // domainName -> domainId

    for (const domainName of uniqueDomains) {
      let domain = await Domain.findOne({ domainName, status: "active" });
      
      if (!domain) {
        const domainId = `domain_${domainName.toLowerCase().replace(/[^a-z0-9]/g, "-")}_${Date.now()}`;
        domain = new Domain({
          domainId,
          domainName,
          status: "active",
        });
        await domain.save();
        console.log(`   ✅ Created domain: ${domainName} -> ${domainId}`);
      } else {
        console.log(`   ⏭️  Domain already exists: ${domainName} -> ${domain.domainId}`);
      }
      
      domainMap.set(domainName, domain.domainId);
    }

    // Step 2: Update Users with domainId (ONLY if domainId doesn't exist)
    console.log("\n👥 Step 2: Updating Users with domainId...");
    let usersUpdated = 0;
    let usersSkipped = 0;
    for (const user of allUsers) {
      // Only add domainId if it doesn't exist - preserve all existing data
      if (user.domain && !(user as any).domainId) {
        const domainId = domainMap.get(user.domain);
        if (domainId) {
          (user as any).domainId = domainId;
          await user.save();
          usersUpdated++;
        }
      } else if ((user as any).domainId) {
        usersSkipped++; // Already has domainId
      }
    }
    console.log(`   ✅ Updated ${usersUpdated} users with domainId`);
    console.log(`   ⏭️  Skipped ${usersSkipped} users (already have domainId)`);

    // Step 3: Update Workspaces with domainId (ONLY if domainId doesn't exist)
    console.log("\n🏢 Step 3: Updating Workspaces with domainId...");
    const allWorkspaces = await Workspace.find({});
    let workspacesUpdated = 0;
    let workspacesSkipped = 0;
    
    for (const workspace of allWorkspaces) {
      // Only add domainId if it doesn't exist - preserve all existing data
      if (workspace.domain && !(workspace as any).domainId) {
        const domainId = domainMap.get(workspace.domain);
        if (domainId) {
          (workspace as any).domainId = domainId;
          await workspace.save();
          workspacesUpdated++;
          
          // Link "exDev" workspace to current domain if found
          if (workspace.slug === "exdev" || workspace.name?.toLowerCase().includes("exdev")) {
            console.log(`   🔗 Found exDev workspace: ${workspace.workspaceId} - linked to ${domainId}`);
          }
        }
      } else if ((workspace as any).domainId) {
        workspacesSkipped++; // Already has domainId
      }
    }
    console.log(`   ✅ Updated ${workspacesUpdated} workspaces with domainId`);
    console.log(`   ⏭️  Skipped ${workspacesSkipped} workspaces (already have domainId)`);

    // Step 4: Update Documents with domainId (ONLY if domainId doesn't exist)
    console.log("\n📄 Step 4: Updating Documents with domainId...");
    const allDocuments = await Document.find({ domainId: { $exists: false } });
    let docsUpdated = 0;
    let docsSkipped = 0;
    
    for (const doc of allDocuments) {
      // Only add domainId if it doesn't exist - preserve all existing data
      if (doc.domain && !(doc as any).domainId) {
        const domainId = domainMap.get(doc.domain);
        if (domainId) {
          (doc as any).domainId = domainId;
          await doc.save();
          docsUpdated++;
        }
      } else if ((doc as any).domainId) {
        docsSkipped++;
      }
    }
    console.log(`   ✅ Updated ${docsUpdated} documents with domainId`);
    console.log(`   ⏭️  Skipped ${docsSkipped} documents (already have domainId)`);

    // Step 5: Update Directories with domainId (ONLY if domainId doesn't exist)
    console.log("\n📁 Step 5: Updating Directories with domainId...");
    const allDirectories = await Directory.find({ domainId: { $exists: false } });
    let dirsUpdated = 0;
    let dirsSkipped = 0;
    
    for (const dir of allDirectories) {
      // Only add domainId if it doesn't exist - preserve all existing data
      if (dir.domain && !(dir as any).domainId) {
        const domainId = domainMap.get(dir.domain);
        if (domainId) {
          (dir as any).domainId = domainId;
          await dir.save();
          dirsUpdated++;
        }
      } else if ((dir as any).domainId) {
        dirsSkipped++;
      }
    }
    console.log(`   ✅ Updated ${dirsUpdated} directories with domainId`);
    console.log(`   ⏭️  Skipped ${dirsSkipped} directories (already have domainId)`);

    // Step 6: Update Summaries with domainId (ONLY if domainId doesn't exist)
    console.log("\n📝 Step 6: Updating Summaries with domainId...");
    const allSummaries = await Summary.find({ domainId: { $exists: false } });
    let summariesUpdated = 0;
    let summariesSkipped = 0;
    
    for (const summary of allSummaries) {
      // Only add domainId if it doesn't exist - preserve all existing data
      if (summary.domain && !(summary as any).domainId) {
        const domainId = domainMap.get(summary.domain);
        if (domainId) {
          (summary as any).domainId = domainId;
          await summary.save();
          summariesUpdated++;
        }
      } else if ((summary as any).domainId) {
        summariesSkipped++;
      }
    }
    console.log(`   ✅ Updated ${summariesUpdated} summaries with domainId`);
    console.log(`   ⏭️  Skipped ${summariesSkipped} summaries (already have domainId)`);

    // Step 7: Update Reports with domainId (ONLY if domainId doesn't exist)
    console.log("\n📊 Step 7: Updating Reports with domainId...");
    const allReports = await Report.find({ domainId: { $exists: false } });
    let reportsUpdated = 0;
    let reportsSkipped = 0;
    
    for (const report of allReports) {
      // Only add domainId if it doesn't exist - preserve all existing data
      if (report.domain && !(report as any).domainId) {
        const domainId = domainMap.get(report.domain);
        if (domainId) {
          (report as any).domainId = domainId;
          await report.save();
          reportsUpdated++;
        }
      } else if ((report as any).domainId) {
        reportsSkipped++;
      }
    }
    console.log(`   ✅ Updated ${reportsUpdated} reports with domainId`);
    console.log(`   ⏭️  Skipped ${reportsSkipped} reports (already have domainId)`);

    // Step 8: Update Notifications with domainId (ONLY if domainId doesn't exist)
    console.log("\n🔔 Step 8: Updating Notifications with domainId...");
    const allNotifications = await Notification.find({ domainId: { $exists: false } });
    let notificationsUpdated = 0;
    let notificationsSkipped = 0;
    
    for (const notification of allNotifications) {
      // Only add domainId if it doesn't exist - preserve all existing data
      if (notification.domain && !(notification as any).domainId) {
        const domainId = domainMap.get(notification.domain);
        if (domainId) {
          (notification as any).domainId = domainId;
          
          // Try to get workspaceId from the resource if it's a workspace-related notification
          // Only set workspaceId if it doesn't exist
          if (!(notification as any).workspaceId && notification.resourceType === "workspace" && notification.resourceId) {
            const workspace = await Workspace.findOne({ workspaceId: notification.resourceId });
            if (workspace) {
              (notification as any).workspaceId = workspace.workspaceId;
            }
          }
          
          await notification.save();
          notificationsUpdated++;
        }
      } else if ((notification as any).domainId) {
        notificationsSkipped++;
      }
    }
    console.log(`   ✅ Updated ${notificationsUpdated} notifications with domainId`);
    console.log(`   ⏭️  Skipped ${notificationsSkipped} notifications (already have domainId)`);

    // Step 9: Update Chats with domainId (ONLY if domainId doesn't exist)
    console.log("\n💬 Step 9: Updating Chats with domainId...");
    const allChats = await Chat.find({ domainId: { $exists: false } });
    let chatsUpdated = 0;
    let chatsSkipped = 0;
    
    for (const chat of allChats) {
      // Only add domainId if it doesn't exist - preserve all existing data
      if (chat.domain && !(chat as any).domainId) {
        const domainId = domainMap.get(chat.domain);
        if (domainId) {
          (chat as any).domainId = domainId;
          await chat.save();
          chatsUpdated++;
        }
      } else if ((chat as any).domainId) {
        chatsSkipped++;
      }
    }
    console.log(`   ✅ Updated ${chatsUpdated} chats with domainId`);
    console.log(`   ⏭️  Skipped ${chatsSkipped} chats (already have domainId)`);

    console.log("\n📈 Migration Summary:");
    console.log(`   Domains created: ${domainMap.size}`);
    console.log(`   Users: ${usersUpdated} updated, ${usersSkipped} skipped (already have domainId)`);
    console.log(`   Workspaces: ${workspacesUpdated} updated, ${workspacesSkipped} skipped (already have domainId)`);
    console.log(`   Documents: ${docsUpdated} updated, ${docsSkipped} skipped (already have domainId)`);
    console.log(`   Directories: ${dirsUpdated} updated, ${dirsSkipped} skipped (already have domainId)`);
    console.log(`   Summaries: ${summariesUpdated} updated, ${summariesSkipped} skipped (already have domainId)`);
    console.log(`   Reports: ${reportsUpdated} updated, ${reportsSkipped} skipped (already have domainId)`);
    console.log(`   Notifications: ${notificationsUpdated} updated, ${notificationsSkipped} skipped (already have domainId)`);
    console.log(`   Chats: ${chatsUpdated} updated, ${chatsSkipped} skipped (already have domainId)`);
    console.log("\n✅ Migration completed safely - all existing data preserved!");

    await mongoose.disconnect();
    console.log("\n✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
migrateToDomainSchema();

