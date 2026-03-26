/**
 * Script to manually create SharePermissions for an invited user
 * This bypasses the old index issue by using native MongoDB insert
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "../models/User";
import { WorkspaceInvitation } from "../models/WorkspaceInvitation";
import { Directory } from "../models/Directory";

dotenv.config();

const USER_EMAIL = "jhalanihimanshu2129@gmail.com";
const DIRECTORY_IDS = ["1761385507579-hu87cf", "1759137803708-kujgj4"]; // Patil Automation and fund

async function createSharePermissions() {
  try {
    console.log("🔧 Creating SharePermissions for invited user...");

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error("MONGODB_URI environment variable is not set");
    }
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // Find the user
    const user = await User.findOne({ email: USER_EMAIL.toLowerCase() });
    if (!user) {
      throw new Error(`User not found: ${USER_EMAIL}`);
    }
    console.log(`✅ Found user: ${user.email} (${user._id})`);

    // Find the accepted invitation
    const invitation = await WorkspaceInvitation.findOne({
      inviteeEmail: USER_EMAIL.toLowerCase(),
      status: "accepted",
    }).sort({ createdAt: -1 }); // Get the most recent

    if (!invitation) {
      throw new Error(`No accepted invitation found for ${USER_EMAIL}`);
    }
    console.log(`✅ Found invitation: ${invitation.invitationId}`);

    // Get the inviter's domain
    const inviter = await User.findById(invitation.inviterId);
    if (!inviter) {
      throw new Error("Inviter not found");
    }
    const actualDomain = inviter.domain;
    const workspaceId = invitation.workspaceId;
    console.log(`✅ Inviter domain: ${actualDomain}, Workspace: ${workspaceId}`);

    const userIdString = user._id.toString();
    const collection = mongoose.connection.db.collection("sharepermissions");

    // Clean up ALL existing SharePermissions with null/missing linkToken for this user
    // This is necessary because the old index treats all documents with scope="user" and linkToken=null as duplicates
    console.log("\n🧹 Cleaning up existing SharePermissions with null linkToken...");
    const deletedNull = await collection.deleteMany({
      scope: "user",
      principalId: userIdString,
      $or: [
        { linkToken: null },
        { linkToken: { $exists: false } }
      ]
    });
    console.log(`   Deleted ${deletedNull.deletedCount} SharePermissions with null/missing linkToken`);

    // Also try to delete any that might be blocking (any scope="user" with linkToken=null for any resource)
    // This is more aggressive but needed to work around the old index
    console.log("\n🧹 Cleaning up ALL SharePermissions with null linkToken for scope=user (this user only)...");
    const allUserShares = await collection.find({
      scope: "user",
      principalId: userIdString,
    }).toArray();
    
    let deletedCount = 0;
    for (const share of allUserShares) {
      if (share.linkToken === null || share.linkToken === undefined) {
        await collection.deleteOne({ _id: share._id });
        deletedCount++;
      }
    }
    console.log(`   Deleted ${deletedCount} additional SharePermissions with null/missing linkToken`);

    // Create SharePermissions for each directory
    const created: string[] = [];
    const errors: string[] = [];

    for (const directoryId of DIRECTORY_IDS) {
      try {
        // Find the directory
        const directory = await Directory.findOne({
          id: directoryId,
          domain: actualDomain,
        });

        if (!directory) {
          errors.push(`Directory ${directoryId} not found`);
          continue;
        }

        console.log(`\n📁 Processing directory: ${directory.name} (${directoryId})`);

        // Check if SharePermission already exists
        const existing = await collection.findOne({
          domain: actualDomain,
          resourceType: "directory",
          resourceId: directoryId,
          scope: "user",
          principalId: userIdString,
        });

        if (existing) {
          console.log(`   ⏭️  SharePermission already exists, skipping...`);
          created.push(directoryId);
          continue;
        }

        // Delete any with null linkToken that might block
        await collection.deleteMany({
          domain: actualDomain,
          resourceType: "directory",
          resourceId: directoryId,
          scope: "user",
          principalId: userIdString,
          linkToken: null,
        });

        // Create SharePermission using native insert
        const shareId = `shr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // For user-scoped shares, set linkToken to a unique dummy value to bypass old index
        // This is a workaround - the old index { scope: 1, linkToken: 1 } requires unique linkToken values
        // For user-scoped shares, we use a unique identifier based on the shareId
        const uniqueLinkToken = `user_${shareId}`;
        
        const sharePermissionDoc = {
          id: shareId,
          resourceType: "directory",
          resourceId: directoryId,
          domain: actualDomain,
          scope: "user",
          principalId: userIdString,
          role: "editor", // Give editor role for full access
          invitedEmail: USER_EMAIL.toLowerCase(),
          createdBy: invitation.inviterId.toString(),
          linkToken: uniqueLinkToken, // Set unique value to bypass old index
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Insert using native MongoDB (bypasses Mongoose validation)
        await collection.insertOne(sharePermissionDoc);

        // Verify it was created
        const verify = await collection.findOne({
          domain: actualDomain,
          resourceType: "directory",
          resourceId: directoryId,
          scope: "user",
          principalId: userIdString,
        });

        if (verify) {
          console.log(`   ✅ Created SharePermission for directory ${directory.name}`);
          created.push(directoryId);
        } else {
          throw new Error("SharePermission was not created despite insertOne success");
        }
      } catch (error: any) {
        console.error(`   ❌ Error creating SharePermission for ${directoryId}:`, error.message);
        errors.push(`${directoryId}: ${error.message}`);
      }
    }

    console.log("\n📊 Summary:");
    console.log(`   ✅ Created: ${created.length} SharePermissions`);
    if (errors.length > 0) {
      console.log(`   ❌ Errors: ${errors.length}`);
      errors.forEach(err => console.log(`      - ${err}`));
    }

    // Verify final state
    console.log("\n🔍 Verifying SharePermissions...");
    const allShares = await collection.find({
      scope: "user",
      principalId: userIdString,
      resourceType: "directory",
    }).toArray();

    console.log(`   Found ${allShares.length} SharePermissions for this user:`);
    allShares.forEach(share => {
      console.log(`      - Directory: ${share.resourceId}, Domain: ${share.domain}, Role: ${share.role}`);
    });

    console.log("\n✅ SharePermission creation complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

createSharePermissions();

