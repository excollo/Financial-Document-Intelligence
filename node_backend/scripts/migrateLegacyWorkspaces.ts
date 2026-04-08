/**
 * Migration Script: Legacy Workspaces to WorkspaceMembership
 * 
 * This script migrates existing workspaces from the old accessibleWorkspaces system
 * to the new WorkspaceMembership system.
 * 
 * Run this script ONCE after deploying the new workspace system to migrate all
 * existing workspace access records.
 * 
 * Usage:
 *   npx ts-node scripts/migrateLegacyWorkspaces.ts
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "../models/User";
import { WorkspaceMembership } from "../models/WorkspaceMembership";
import { Workspace } from "../models/Workspace";

dotenv.config();

async function migrateLegacyWorkspaces() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env["MONGODB-URI"];
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is not set");
    }

    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Find all users with legacy accessibleWorkspaces
    const usersWithLegacy = await User.find({
      accessibleWorkspaces: { $exists: true, $ne: [] },
    });

    console.log(`📊 Found ${usersWithLegacy.length} users with legacy workspaces`);

    let migrated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const legacyUser of usersWithLegacy) {
      const legacyWorkspaces = (legacyUser.accessibleWorkspaces || []).filter(
        (ws: any) => ws.isActive !== false
      );

      console.log(
        `\n👤 Processing user: ${legacyUser.email} (${legacyWorkspaces.length} workspaces)`
      );

      for (const legacyWs of legacyWorkspaces) {
        try {
          // Check if membership already exists
          const existingMembership = await WorkspaceMembership.findOne({
            userId: legacyUser._id,
            workspaceId: legacyWs.workspaceDomain,
          });

          if (existingMembership) {
            console.log(`   ⏭️  Skipped: Membership already exists for ${legacyWs.workspaceDomain}`);
            skipped++;
            continue;
          }

          // Try to find workspace by slug (legacy system used slug as workspaceDomain)
          let workspace = await Workspace.findOne({
            domain: legacyUser.domain,
            slug: legacyWs.workspaceDomain,
            status: "active",
          });

          // If not found by slug, check if workspaceDomain is actually a workspaceId
          if (!workspace) {
            workspace = await Workspace.findOne({
              workspaceId: legacyWs.workspaceDomain,
              status: "active",
            });
          }

          // If workspace doesn't exist in DB, we can still create membership with the slug as workspaceId
          // This maintains backward compatibility
          const workspaceId = workspace?.workspaceId || legacyWs.workspaceDomain;

          // Map legacy role to membership role
          let membershipRole: "admin" | "member" | "viewer" = "member";
          if (legacyWs.role === "viewer") {
            membershipRole = "viewer";
          } else if (legacyWs.role === "editor") {
            membershipRole = "member";
          }

          // Create membership
          const membership = new WorkspaceMembership({
            userId: legacyUser._id,
            workspaceId,
            role: membershipRole,
            invitedBy: legacyWs.invitedBy || legacyUser._id,
            joinedAt: legacyWs.joinedAt || new Date(),
            status: "active",
          });

          await membership.save();
          migrated++;
          console.log(`   ✅ Created membership for ${workspaceId} (${membershipRole})`);

          // Update user's currentWorkspace if needed (use workspaceId if workspace exists)
          if (
            !legacyUser.currentWorkspace ||
            legacyUser.currentWorkspace === legacyWs.workspaceDomain
          ) {
            legacyUser.currentWorkspace = workspaceId;
            await legacyUser.save();
            console.log(`   🔄 Updated currentWorkspace to ${workspaceId}`);
          }
        } catch (error: any) {
          const errorMsg = `User ${legacyUser.email}, workspace ${legacyWs.workspaceDomain}: ${error.message}`;
          errors.push(errorMsg);
          console.error(`   ❌ Error: ${errorMsg}`);
        }
      }
    }

    console.log("\n📈 Migration Summary:");
    console.log(`   Users processed: ${usersWithLegacy.length}`);
    console.log(`   Memberships created: ${migrated}`);
    console.log(`   Memberships skipped: ${skipped}`);
    console.log(`   Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log("\n⚠️  Errors encountered:");
      errors.slice(0, 10).forEach((err) => console.log(`   - ${err}`));
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`);
      }
    }

    await mongoose.disconnect();
    console.log("\n✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
migrateLegacyWorkspaces();





















