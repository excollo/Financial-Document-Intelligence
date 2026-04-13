/**
 * Migration Script: Replace all existing workspace IDs with new workspace ID
 * 
 * This script:
 * 1. Finds all existing workspace IDs in the database
 * 2. Replaces ALL workspace IDs with the new one: "ws_1758689602670_z3pxonjqn"
 * 3. Updates all schemas that reference workspaceId:
 *    - Workspace (workspaceId field)
 *    - Documents (workspaceId)
 *    - Directories (workspaceId)
 *    - Summaries (workspaceId)
 *    - Reports (workspaceId)
 *    - Chats (workspaceId)
 *    - Notifications (workspaceId)
 *    - WorkspaceMembership (workspaceId)
 *    - WorkspaceInvitation (workspaceId)
 *    - User (currentWorkspace field)
 *    - SharePermission (workspaceId if exists)
 * 
 * SAFE: This replaces workspace IDs - make sure you have a backup!
 * 
 * Usage:
 *   npx ts-node scripts/migrateWorkspaceId.ts
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Workspace } from "../models/Workspace";
import { Document } from "../models/Document";
import { Directory } from "../models/Directory";
import { Summary } from "../models/Summary";
import { Report } from "../models/Report";
import { Notification } from "../models/Notification";
import { Chat } from "../models/Chat";
import { WorkspaceMembership } from "../models/WorkspaceMembership";
import { User } from "../models/User";

dotenv.config();

const NEW_WORKSPACE_ID = "ws_1758689602670_z3pxonjqn";

async function migrateWorkspaceId() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is not set");
    }

    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");
    console.log(`\n🎯 Target Workspace ID: ${NEW_WORKSPACE_ID}`);

    // Step 1: Find all existing workspace IDs
    console.log("\n📋 Step 1: Finding all existing workspace IDs...");
    const allWorkspaces = await Workspace.find({});
    const existingWorkspaceIds = allWorkspaces.map(ws => ws.workspaceId).filter(Boolean);
    const uniqueWorkspaceIds = [...new Set(existingWorkspaceIds)];
    
    console.log(`   Found ${uniqueWorkspaceIds.length} unique workspace IDs:`);
    uniqueWorkspaceIds.forEach(id => console.log(`     - ${id}`));

    if (uniqueWorkspaceIds.length === 0) {
      console.log("   ⚠️  No workspaces found. Nothing to migrate.");
      await mongoose.disconnect();
      return;
    }

    // Step 2: Update Workspace documents themselves
    console.log(`\n🏢 Step 2: Updating Workspace documents...`);
    let workspaceUpdated = 0;
    for (const workspace of allWorkspaces) {
      if (workspace.workspaceId !== NEW_WORKSPACE_ID) {
        const oldWorkspaceId = workspace.workspaceId;
        workspace.workspaceId = NEW_WORKSPACE_ID;
        await workspace.save();
        workspaceUpdated++;
        console.log(`   ✅ Updated workspace: ${oldWorkspaceId} -> ${NEW_WORKSPACE_ID}`);
      }
    }
    console.log(`   ✅ Updated ${workspaceUpdated} workspace documents`);

    // Step 3: Update Documents
    console.log(`\n📄 Step 3: Updating Documents...`);
    const docsResult = await Document.updateMany(
      { workspaceId: { $exists: true, $ne: NEW_WORKSPACE_ID } },
      { $set: { workspaceId: NEW_WORKSPACE_ID } }
    );
    console.log(`   ✅ Updated ${docsResult.modifiedCount} documents`);

    // Step 4: Update Directories
    console.log(`\n📁 Step 4: Updating Directories...`);
    const dirsResult = await Directory.updateMany(
      { workspaceId: { $exists: true, $ne: NEW_WORKSPACE_ID } },
      { $set: { workspaceId: NEW_WORKSPACE_ID } }
    );
    console.log(`   ✅ Updated ${dirsResult.modifiedCount} directories`);

    // Step 5: Update Summaries
    console.log(`\n📝 Step 5: Updating Summaries...`);
    const summariesResult = await Summary.updateMany(
      { workspaceId: { $exists: true, $ne: NEW_WORKSPACE_ID } },
      { $set: { workspaceId: NEW_WORKSPACE_ID } }
    );
    console.log(`   ✅ Updated ${summariesResult.modifiedCount} summaries`);

    // Step 6: Update Reports
    console.log(`\n📊 Step 6: Updating Reports...`);
    const reportsResult = await Report.updateMany(
      { workspaceId: { $exists: true, $ne: NEW_WORKSPACE_ID } },
      { $set: { workspaceId: NEW_WORKSPACE_ID } }
    );
    console.log(`   ✅ Updated ${reportsResult.modifiedCount} reports`);

    // Step 7: Update Chats
    console.log(`\n💬 Step 7: Updating Chats...`);
    const chatsResult = await Chat.updateMany(
      { workspaceId: { $exists: true, $ne: NEW_WORKSPACE_ID } },
      { $set: { workspaceId: NEW_WORKSPACE_ID } }
    );
    console.log(`   ✅ Updated ${chatsResult.modifiedCount} chats`);

    // Step 8: Update Notifications
    console.log(`\n🔔 Step 8: Updating Notifications...`);
    const notificationsResult = await Notification.updateMany(
      { workspaceId: { $exists: true, $ne: NEW_WORKSPACE_ID } },
      { $set: { workspaceId: NEW_WORKSPACE_ID } }
    );
    console.log(`   ✅ Updated ${notificationsResult.modifiedCount} notifications`);

    // Step 9: Update WorkspaceMembership
    console.log(`\n👥 Step 9: Updating WorkspaceMembership...`);
    const membershipResult = await WorkspaceMembership.updateMany(
      { workspaceId: { $exists: true, $ne: NEW_WORKSPACE_ID } },
      { $set: { workspaceId: NEW_WORKSPACE_ID } }
    );
    console.log(`   ✅ Updated ${membershipResult.modifiedCount} workspace memberships`);

    // Step 10: Update WorkspaceInvitation (if model exists)
    try {
      const { WorkspaceInvitation } = await import("../models/WorkspaceInvitation");
      console.log(`\n📧 Step 10: Updating WorkspaceInvitation...`);
      const invitationResult = await WorkspaceInvitation.updateMany(
        { workspaceId: { $exists: true, $ne: NEW_WORKSPACE_ID } },
        { $set: { workspaceId: NEW_WORKSPACE_ID } }
      );
      console.log(`   ✅ Updated ${invitationResult.modifiedCount} workspace invitations`);
    } catch (error) {
      console.log(`   ⏭️  WorkspaceInvitation model not found, skipping...`);
    }

    // Step 11: Update User.currentWorkspace
    console.log(`\n👤 Step 11: Updating User.currentWorkspace...`);
    const userResult = await User.updateMany(
      { 
        $and: [
          { currentWorkspace: { $exists: true } },
          { currentWorkspace: { $ne: NEW_WORKSPACE_ID } },
          { currentWorkspace: { $ne: null } }
        ]
      },
      { $set: { currentWorkspace: NEW_WORKSPACE_ID } }
    );
    console.log(`   ✅ Updated ${userResult.modifiedCount} users' currentWorkspace`);

    // Step 12: Update SharePermission (if model exists and has workspaceId)
    try {
      const { SharePermission } = await import("../models/SharePermission");
      console.log(`\n🔐 Step 12: Updating SharePermission...`);
      const shareResult = await SharePermission.updateMany(
        { "permissions.workspaceId": { $exists: true, $ne: NEW_WORKSPACE_ID } },
        { $set: { "permissions.$[].workspaceId": NEW_WORKSPACE_ID } }
      );
      console.log(`   ✅ Updated ${shareResult.modifiedCount} share permissions`);
    } catch (error) {
      console.log(`   ⏭️  SharePermission update skipped (may not have workspaceId field)`);
    }

    // Final Summary
    console.log("\n" + "=".repeat(60));
    console.log("📈 Migration Summary:");
    console.log("=".repeat(60));
    console.log(`   New Workspace ID: ${NEW_WORKSPACE_ID}`);
    console.log(`   Old Workspace IDs found: ${uniqueWorkspaceIds.length}`);
    console.log(`   Workspaces updated: ${workspaceUpdated}`);
    console.log(`   Documents updated: ${docsResult.modifiedCount}`);
    console.log(`   Directories updated: ${dirsResult.modifiedCount}`);
    console.log(`   Summaries updated: ${summariesResult.modifiedCount}`);
    console.log(`   Reports updated: ${reportsResult.modifiedCount}`);
    console.log(`   Chats updated: ${chatsResult.modifiedCount}`);
    console.log(`   Notifications updated: ${notificationsResult.modifiedCount}`);
    console.log(`   WorkspaceMembership updated: ${membershipResult.modifiedCount}`);
    console.log(`   Users' currentWorkspace updated: ${userResult.modifiedCount}`);
    console.log("=".repeat(60));
    console.log("\n✅ Migration completed!");
    console.log(`✅ All workspace IDs consolidated to: ${NEW_WORKSPACE_ID}`);

    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
migrateWorkspaceId();

