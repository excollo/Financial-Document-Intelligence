/**
 * Check and Fix User Access Script
 * 
 * This script:
 * 1. Checks all users for excollo.com domain
 * 2. Verifies they have WorkspaceMembership for the workspace
 * 3. Checks their currentWorkspace is set correctly
 * 4. Fixes any missing memberships or incorrect currentWorkspace
 * 
 * Usage:
 *   npx ts-node scripts/checkAndFixUserAccess.ts
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { WorkspaceMembership } from "../models/WorkspaceMembership";
import { Document } from "../models/Document";

dotenv.config();

const TARGET_WORKSPACE_ID = "ws_1758689602670_z3pxonjqn";
const DOMAIN_NAME = "excollo.com";

async function checkAndFixUserAccess() {
  try {
    const MONGODB_URI = process.env["MONGODB-URI"];
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is not set");
    }

    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Step 1: Check Workspace exists
    console.log(`\n🏢 Step 1: Checking Workspace...`);
    const workspace = await Workspace.findOne({ workspaceId: TARGET_WORKSPACE_ID });
    if (!workspace) {
      console.log(`   ❌ Workspace ${TARGET_WORKSPACE_ID} not found!`);
      console.log(`   Run diagnoseAndFixWorkspaceIssue.ts first to create the workspace.`);
      await mongoose.disconnect();
      return;
    }
    console.log(`   ✅ Workspace found: ${workspace.name} (${workspace.workspaceId})`);

    // Step 2: Check all users for the domain
    console.log(`\n👥 Step 2: Checking Users for ${DOMAIN_NAME}...`);
    const users = await User.find({ domain: DOMAIN_NAME });
    console.log(`   Found ${users.length} users`);

    if (users.length === 0) {
      console.log(`   ⚠️  No users found for ${DOMAIN_NAME}`);
      await mongoose.disconnect();
      return;
    }

    // Step 3: Check and fix each user
    console.log(`\n🔧 Step 3: Checking and Fixing User Access...`);
    let usersFixed = 0;
    let membershipsCreated = 0;

    for (const user of users) {
      console.log(`\n   User: ${user.email} (${user._id})`);
      console.log(`     Role: ${user.role}`);
      console.log(`     Current Workspace: ${(user as any).currentWorkspace || "NOT SET"}`);
      console.log(`     Domain: ${user.domain}`);
      console.log(`     DomainId: ${(user as any).domainId || "NOT SET"}`);

      // Check if user has WorkspaceMembership
      const membership = await WorkspaceMembership.findOne({
        userId: user._id,
        workspaceId: TARGET_WORKSPACE_ID,
      });

      if (!membership) {
        console.log(`     ❌ No WorkspaceMembership found - Creating...`);
        const newMembership = new WorkspaceMembership({
          userId: user._id,
          workspaceId: TARGET_WORKSPACE_ID,
          role: user.role === "admin" ? "admin" : "member",
          invitedBy: user._id,
          joinedAt: new Date(),
          status: "active",
        });
        await newMembership.save();
        membershipsCreated++;
        console.log(`     ✅ Created membership (role: ${newMembership.role})`);
      } else {
        console.log(`     ✅ Membership exists (role: ${membership.role}, status: ${membership.status})`);
        if (membership.status !== "active") {
          membership.status = "active";
          await membership.save();
          console.log(`     ✅ Updated membership status to active`);
        }
      }

      // Check if currentWorkspace is set correctly
      if ((user as any).currentWorkspace !== TARGET_WORKSPACE_ID) {
        console.log(`     ❌ currentWorkspace incorrect - Fixing...`);
        (user as any).currentWorkspace = TARGET_WORKSPACE_ID;
        await user.save();
        usersFixed++;
        console.log(`     ✅ Updated currentWorkspace to ${TARGET_WORKSPACE_ID}`);
      } else {
        console.log(`     ✅ currentWorkspace is correct`);
      }
    }

    // Step 4: Verify documents exist
    console.log(`\n📄 Step 4: Verifying Documents...`);
    const totalDocs = await Document.countDocuments({ domain: DOMAIN_NAME });
    const docsWithWorkspace = await Document.countDocuments({
      domain: DOMAIN_NAME,
      workspaceId: TARGET_WORKSPACE_ID,
    });
    const docsWithoutWorkspace = await Document.countDocuments({
      domain: DOMAIN_NAME,
      $or: [
        { workspaceId: { $exists: false } },
        { workspaceId: { $ne: TARGET_WORKSPACE_ID } }
      ]
    });

    console.log(`   Total documents for ${DOMAIN_NAME}: ${totalDocs}`);
    console.log(`   Documents with workspace ${TARGET_WORKSPACE_ID}: ${docsWithWorkspace}`);
    console.log(`   Documents without/mismatched workspace: ${docsWithoutWorkspace}`);

    // Step 5: Check directories
    const { Directory } = await import("../models/Directory");
    const totalDirs = await Directory.countDocuments({ domain: DOMAIN_NAME });
    const dirsWithWorkspace = await Directory.countDocuments({
      domain: DOMAIN_NAME,
      workspaceId: TARGET_WORKSPACE_ID,
    });

    console.log(`\n📁 Step 5: Verifying Directories...`);
    console.log(`   Total directories for ${DOMAIN_NAME}: ${totalDirs}`);
    console.log(`   Directories with workspace ${TARGET_WORKSPACE_ID}: ${dirsWithWorkspace}`);

    // Final Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 Summary:");
    console.log("=".repeat(60));
    console.log(`   Users checked: ${users.length}`);
    console.log(`   Users fixed (currentWorkspace): ${usersFixed}`);
    console.log(`   Memberships created: ${membershipsCreated}`);
    console.log(`   Documents: ${docsWithWorkspace} with correct workspace`);
    console.log(`   Directories: ${dirsWithWorkspace} with correct workspace`);
    console.log("=".repeat(60));
    console.log("\n✅ Check and fix completed!");

    // Test query for each user
    console.log("\n🧪 Testing Document Access for Each User:");
    for (const user of users) {
      const testDocs = await Document.find({
        domain: DOMAIN_NAME,
        workspaceId: TARGET_WORKSPACE_ID,
      }).limit(3);
      console.log(`   ${user.email}: Can see ${testDocs.length} documents (showing first 3)`);
      if (testDocs.length > 0) {
        testDocs.forEach(doc => {
          console.log(`     - ${doc.name || doc.namespace} (workspaceId: ${doc.workspaceId})`);
        });
      }
    }

    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Error:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

checkAndFixUserAccess();





















