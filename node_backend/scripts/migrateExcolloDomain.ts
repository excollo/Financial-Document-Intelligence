/**
 * Migration Script: Create Domain for excollo.com and link all existing data
 * 
 * This script:
 * 1. Creates Domain record for "excollo.com"
 * 2. Adds domainId to all existing records with domain="excollo.com"
 *    - Users, Workspaces, Documents, Directories, Summaries, Reports, Notifications, Chats
 * 
 * SAFE: Only adds domainId field - does NOT delete or modify existing data
 * 
 * Usage:
 *   npx ts-node scripts/migrateExcolloDomain.ts
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

async function migrateExcolloDomain() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is not set");
    }

    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    const domainName = "excollo.com";

    // Step 1: Create or get Domain record for excollo.com
    console.log(`\n📋 Step 1: Creating Domain record for ${domainName}...`);
    let domain = await Domain.findOne({ domainName, status: "active" });
    
    if (!domain) {
      const domainId = `domain_${domainName.toLowerCase().replace(/[^a-z0-9]/g, "-")}_${Date.now()}`;
      domain = new Domain({
        domainId,
        domainName,
        status: "active",
      });
      await domain.save();
      console.log(`   ✅ Created domain: ${domainName} -> ${domain.domainId}`);
    } else {
      console.log(`   ⏭️  Domain already exists: ${domainName} -> ${domain.domainId}`);
    }

    const domainId = domain.domainId;
    console.log(`   Using domainId: ${domainId}`);

    // Step 2: Update Users with domainId
    console.log(`\n👥 Step 2: Updating Users with domain="${domainName}"...`);
    const users = await User.find({ domain: domainName });
    let usersUpdated = 0;
    let usersSkipped = 0;
    
    for (const user of users) {
      if (!(user as any).domainId) {
        (user as any).domainId = domainId;
        await user.save();
        usersUpdated++;
      } else {
        usersSkipped++;
      }
    }
    console.log(`   ✅ Updated ${usersUpdated} users with domainId`);
    console.log(`   ⏭️  Skipped ${usersSkipped} users (already have domainId)`);

    // Step 3: Update Workspaces with domainId
    console.log(`\n🏢 Step 3: Updating Workspaces with domain="${domainName}"...`);
    const workspaces = await Workspace.find({ domain: domainName });
    let workspacesUpdated = 0;
    let workspacesSkipped = 0;
    
    for (const workspace of workspaces) {
      if (!(workspace as any).domainId) {
        (workspace as any).domainId = domainId;
        await workspace.save();
        workspacesUpdated++;
      } else {
        workspacesSkipped++;
      }
    }
    console.log(`   ✅ Updated ${workspacesUpdated} workspaces with domainId`);
    console.log(`   ⏭️  Skipped ${workspacesSkipped} workspaces (already have domainId)`);

    // Step 4: Update Documents with domainId (using bulk update to avoid validation errors)
    console.log(`\n📄 Step 4: Updating Documents with domain="${domainName}"...`);
    const docsResult = await Document.updateMany(
      { domain: domainName, domainId: { $exists: false } },
      { $set: { domainId } }
    );
    const docsWithDomainId = await Document.countDocuments({ domain: domainName, domainId: { $exists: true } });
    const totalDocs = await Document.countDocuments({ domain: domainName });
    const docsSkipped = docsWithDomainId - docsResult.modifiedCount;
    
    console.log(`   ✅ Updated ${docsResult.modifiedCount} documents with domainId`);
    console.log(`   ⏭️  Skipped ${docsSkipped} documents (already have domainId)`);

    // Step 5: Update Directories with domainId (using bulk update)
    console.log(`\n📁 Step 5: Updating Directories with domain="${domainName}"...`);
    const dirsResult = await Directory.updateMany(
      { domain: domainName, domainId: { $exists: false } },
      { $set: { domainId } }
    );
    const dirsWithDomainId = await Directory.countDocuments({ domain: domainName, domainId: { $exists: true } });
    const dirsSkipped = dirsWithDomainId - dirsResult.modifiedCount;
    
    console.log(`   ✅ Updated ${dirsResult.modifiedCount} directories with domainId`);
    console.log(`   ⏭️  Skipped ${dirsSkipped} directories (already have domainId)`);

    // Step 6: Update Summaries with domainId (using bulk update)
    console.log(`\n📝 Step 6: Updating Summaries with domain="${domainName}"...`);
    const summariesResult = await Summary.updateMany(
      { domain: domainName, domainId: { $exists: false } },
      { $set: { domainId } }
    );
    const summariesWithDomainId = await Summary.countDocuments({ domain: domainName, domainId: { $exists: true } });
    const summariesSkipped = summariesWithDomainId - summariesResult.modifiedCount;
    
    console.log(`   ✅ Updated ${summariesResult.modifiedCount} summaries with domainId`);
    console.log(`   ⏭️  Skipped ${summariesSkipped} summaries (already have domainId)`);

    // Step 7: Update Reports with domainId (using bulk update)
    console.log(`\n📊 Step 7: Updating Reports with domain="${domainName}"...`);
    const reportsResult = await Report.updateMany(
      { domain: domainName, domainId: { $exists: false } },
      { $set: { domainId } }
    );
    const reportsWithDomainId = await Report.countDocuments({ domain: domainName, domainId: { $exists: true } });
    const reportsSkipped = reportsWithDomainId - reportsResult.modifiedCount;
    
    console.log(`   ✅ Updated ${reportsResult.modifiedCount} reports with domainId`);
    console.log(`   ⏭️  Skipped ${reportsSkipped} reports (already have domainId)`);

    // Step 8: Update Notifications with domainId (using bulk update)
    console.log(`\n🔔 Step 8: Updating Notifications with domain="${domainName}"...`);
    const notificationsResult = await Notification.updateMany(
      { domain: domainName, domainId: { $exists: false } },
      { $set: { domainId } }
    );
    const notificationsWithDomainId = await Notification.countDocuments({ domain: domainName, domainId: { $exists: true } });
    const notificationsSkipped = notificationsWithDomainId - notificationsResult.modifiedCount;
    
    console.log(`   ✅ Updated ${notificationsResult.modifiedCount} notifications with domainId`);
    console.log(`   ⏭️  Skipped ${notificationsSkipped} notifications (already have domainId)`);

    // Step 9: Update Chats with domainId (using bulk update)
    console.log(`\n💬 Step 9: Updating Chats with domain="${domainName}"...`);
    const chatsResult = await Chat.updateMany(
      { domain: domainName, domainId: { $exists: false } },
      { $set: { domainId } }
    );
    const chatsWithDomainId = await Chat.countDocuments({ domain: domainName, domainId: { $exists: true } });
    const chatsSkipped = chatsWithDomainId - chatsResult.modifiedCount;
    
    console.log(`   ✅ Updated ${chatsResult.modifiedCount} chats with domainId`);
    console.log(`   ⏭️  Skipped ${chatsSkipped} chats (already have domainId)`);

    // Final Summary
    console.log("\n" + "=".repeat(60));
    console.log("📈 Migration Summary for excollo.com:");
    console.log("=".repeat(60));
    console.log(`   Domain: ${domainName}`);
    console.log(`   DomainId: ${domainId}`);
    console.log(`   Users: ${usersUpdated} updated, ${usersSkipped} skipped`);
    console.log(`   Workspaces: ${workspacesUpdated} updated, ${workspacesSkipped} skipped`);
    console.log(`   Documents: ${docsResult.modifiedCount} updated, ${docsSkipped} skipped`);
    console.log(`   Directories: ${dirsResult.modifiedCount} updated, ${dirsSkipped} skipped`);
    console.log(`   Summaries: ${summariesResult.modifiedCount} updated, ${summariesSkipped} skipped`);
    console.log(`   Reports: ${reportsResult.modifiedCount} updated, ${reportsSkipped} skipped`);
    console.log(`   Notifications: ${notificationsResult.modifiedCount} updated, ${notificationsSkipped} skipped`);
    console.log(`   Chats: ${chatsResult.modifiedCount} updated, ${chatsSkipped} skipped`);
    console.log("=".repeat(60));
    console.log("\n✅ Migration completed safely - all existing data preserved!");
    console.log("✅ All excollo.com records now linked to domainId");

    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
migrateExcolloDomain();

