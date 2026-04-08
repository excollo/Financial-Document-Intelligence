/**
 * Migration Script: Normalize Existing Directory Names
 * 
 * This script adds normalizedName to all existing directories
 * and updates directory statistics based on existing documents.
 * 
 * Run with: npx ts-node scripts/migrateNormalizeDirectories.ts
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Directory } from "../models/Directory";
import { Document } from "../models/Document";
import { normalizeCompanyName } from "../lib/companyNameNormalizer";

dotenv.config();

async function migrateDirectories() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env["MONGODB-URI"];
    if (!mongoUri) {
      console.error("❌ MONGODB_URI not found in environment variables");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // Get all directories
    const directories = await Directory.find({});
    console.log(`\n📁 Found ${directories.length} directories to migrate\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const dir of directories) {
      try {
        // Skip if already has normalizedName
        if (dir.normalizedName) {
          skipped++;
          continue;
        }

        // Normalize the directory name
        const normalizedName = normalizeCompanyName(dir.name);
        
        // Count documents in this directory
        const docCount = await Document.countDocuments({
          directoryId: dir.id,
          workspaceId: dir.workspaceId,
        });

        const drhpCount = await Document.countDocuments({
          directoryId: dir.id,
          workspaceId: dir.workspaceId,
          type: "DRHP",
        });

        const rhpCount = await Document.countDocuments({
          directoryId: dir.id,
          workspaceId: dir.workspaceId,
          type: "RHP",
        });

        // Get last document upload date
        const lastDoc = await Document.findOne({
          directoryId: dir.id,
          workspaceId: dir.workspaceId,
        })
          .sort({ uploadedAt: -1 })
          .select("uploadedAt");

        // Update directory
        await Directory.updateOne(
          { _id: dir._id },
          {
            $set: {
              normalizedName,
              documentCount: docCount,
              drhpCount,
              rhpCount,
              ...(lastDoc?.uploadedAt && { lastDocumentUpload: lastDoc.uploadedAt }),
            },
          }
        );

        updated++;
        console.log(`✅ Updated: "${dir.name}" → normalized: "${normalizedName}" (${docCount} docs)`);
      } catch (error: any) {
        errors++;
        console.error(`❌ Error updating directory ${dir.id}:`, error.message);
      }
    }

    console.log(`\n📊 Migration Summary:`);
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`\n✅ Migration completed!\n`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
migrateDirectories();









