/**
 * Diagnostic and Fix Script: Check and fix workspace/document visibility issues
 * 
 * This script:
 * 1. Checks if documents exist for excollo.com domain
 * 2. Checks if workspace exists with the new workspace ID
 * 3. Verifies users have the correct currentWorkspace set
 * 4. Fixes any mismatches
 * 
 * Usage:
 *   npx ts-node scripts/diagnoseAndFixWorkspaceIssue.ts
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Domain } from "../models/Domain";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { Document } from "../models/Document";
import { Directory } from "../models/Directory";
import { WorkspaceMembership } from "../models/WorkspaceMembership";

dotenv.config();

const TARGET_WORKSPACE_ID = "ws_1758689602670_z3pxonjqn";
const DOMAIN_NAME = "excollo.com";

async function diagnoseAndFix() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is not set");
    }

    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Step 1: Check Domain
    console.log(`\n📋 Step 1: Checking Domain...`);
    const domain = await Domain.findOne({ domainName: DOMAIN_NAME });
    if (!domain) {
      console.log(`   ❌ Domain not found! Creating...`);
      const domainId = `domain_${DOMAIN_NAME.toLowerCase().replace(/[^a-z0-9]/g, "-")}_${Date.now()}`;
      const newDomain = new Domain({
        domainId,
        domainName: DOMAIN_NAME,
        status: "active",
      });
      await newDomain.save();
      console.log(`   ✅ Created domain: ${DOMAIN_NAME} -> ${domainId}`);
    } else {
      console.log(`   ✅ Domain exists: ${domain.domainName} (${domain.domainId})`);
    }

    // Step 2: Check Workspace
    console.log(`\n🏢 Step 2: Checking Workspace...`);
    let workspace = await Workspace.findOne({ workspaceId: TARGET_WORKSPACE_ID });
    if (!workspace) {
      // Try to find any workspace for excollo.com
      const existingWorkspaces = await Workspace.find({ domain: DOMAIN_NAME });
      console.log(`   ⚠️  Workspace ${TARGET_WORKSPACE_ID} not found!`);
      console.log(`   Found ${existingWorkspaces.length} workspaces for ${DOMAIN_NAME}:`);
      existingWorkspaces.forEach(ws => {
        console.log(`     - ${ws.workspaceId} (${ws.name})`);
      });

      if (existingWorkspaces.length > 0) {
        // Update the first workspace to use the target ID
        workspace = existingWorkspaces[0];
        const oldWorkspaceId = workspace.workspaceId;
        workspace.workspaceId = TARGET_WORKSPACE_ID;
        await workspace.save();
        console.log(`   ✅ Updated workspace: ${oldWorkspaceId} -> ${TARGET_WORKSPACE_ID}`);
      } else {
        // Create new workspace
        const firstUser = await User.findOne({ domain: DOMAIN_NAME, role: "admin" });
        if (!firstUser) {
          console.log(`   ❌ No admin user found for ${DOMAIN_NAME}. Cannot create workspace.`);
        } else if (!domain) {
          console.log(`   ❌ Domain not found. Cannot create workspace.`);
        } else {
          workspace = new Workspace({
            workspaceId: TARGET_WORKSPACE_ID,
            domain: DOMAIN_NAME,
            domainId: domain.domainId,
            name: `${DOMAIN_NAME} Workspace`,
            slug: DOMAIN_NAME.replace(/\./g, "-"),
            ownerId: firstUser._id,
            admins: [firstUser._id],
          });
          await workspace.save();
          console.log(`   ✅ Created workspace: ${TARGET_WORKSPACE_ID}`);
        }
      }
    } else {
      console.log(`   ✅ Workspace exists: ${workspace.name} (${workspace.workspaceId})`);
    }

    // Step 3: Check Documents
    console.log(`\n📄 Step 3: Checking Documents...`);
    const allDocuments = await Document.find({ domain: DOMAIN_NAME });
    console.log(`   Found ${allDocuments.length} documents for ${DOMAIN_NAME}`);
    
    const docsWithWorkspace = allDocuments.filter(d => d.workspaceId);
    const docsWithoutWorkspace = allDocuments.filter(d => !d.workspaceId);
    const docsWithWrongWorkspace = allDocuments.filter(d => d.workspaceId && d.workspaceId !== TARGET_WORKSPACE_ID);

    console.log(`   - ${docsWithWorkspace.length} have workspaceId`);
    console.log(`   - ${docsWithoutWorkspace.length} missing workspaceId`);
    console.log(`   - ${docsWithWrongWorkspace.length} have different workspaceId`);

    if (docsWithoutWorkspace.length > 0 || docsWithWrongWorkspace.length > 0) {
      const result = await Document.updateMany(
        { domain: DOMAIN_NAME, workspaceId: { $ne: TARGET_WORKSPACE_ID } },
        { $set: { workspaceId: TARGET_WORKSPACE_ID } }
      );
      console.log(`   ✅ Fixed ${result.modifiedCount} documents`);
    }

    // Step 4: Check Users
    console.log(`\n👥 Step 4: Checking Users...`);
    const users = await User.find({ domain: DOMAIN_NAME });
    console.log(`   Found ${users.length} users for ${DOMAIN_NAME}`);
    
    let usersUpdated = 0;
    for (const user of users) {
      const needsUpdate = 
        !(user as any).currentWorkspace || 
        (user as any).currentWorkspace !== TARGET_WORKSPACE_ID;
      
      if (needsUpdate) {
        (user as any).currentWorkspace = TARGET_WORKSPACE_ID;
        await user.save();
        usersUpdated++;
        console.log(`   ✅ Updated user ${user.email}: currentWorkspace -> ${TARGET_WORKSPACE_ID}`);
      }
    }
    console.log(`   ✅ Updated ${usersUpdated} users' currentWorkspace`);

    // Step 5: Check WorkspaceMembership
    console.log(`\n👥 Step 5: Checking WorkspaceMembership...`);
    const memberships = await WorkspaceMembership.find({ workspaceId: { $ne: TARGET_WORKSPACE_ID } });
    if (memberships.length > 0) {
      const membershipResult = await WorkspaceMembership.updateMany(
        { workspaceId: { $ne: TARGET_WORKSPACE_ID } },
        { $set: { workspaceId: TARGET_WORKSPACE_ID } }
      );
      console.log(`   ✅ Updated ${membershipResult.modifiedCount} workspace memberships`);
    } else {
      console.log(`   ✅ All memberships already use ${TARGET_WORKSPACE_ID}`);
    }

    // Step 6: Check Directories
    console.log(`\n📁 Step 6: Checking Directories...`);
    const dirsWithoutWorkspace = await Directory.countDocuments({ 
      domain: DOMAIN_NAME, 
      workspaceId: { $ne: TARGET_WORKSPACE_ID } 
    });
    if (dirsWithoutWorkspace > 0) {
      const dirsResult = await Directory.updateMany(
        { domain: DOMAIN_NAME, workspaceId: { $ne: TARGET_WORKSPACE_ID } },
        { $set: { workspaceId: TARGET_WORKSPACE_ID } }
      );
      console.log(`   ✅ Updated ${dirsResult.modifiedCount} directories`);
    } else {
      console.log(`   ✅ All directories already use ${TARGET_WORKSPACE_ID}`);
    }

    // Final Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 Summary:");
    console.log("=".repeat(60));
    console.log(`   Domain: ${DOMAIN_NAME}`);
    console.log(`   Workspace ID: ${TARGET_WORKSPACE_ID}`);
    console.log(`   Total Documents: ${allDocuments.length}`);
    console.log(`   Documents with correct workspace: ${allDocuments.filter(d => d.workspaceId === TARGET_WORKSPACE_ID).length}`);
    console.log(`   Users: ${users.length}`);
    console.log("=".repeat(60));
    console.log("\n✅ Diagnosis and fix completed!");

    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Error:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

diagnoseAndFix();

