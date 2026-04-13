/**
 * Script to fix the SharePermission index issue
 * Drops the old problematic index and ensures the correct indexes are in place
 */

import mongoose from "mongoose";
import { SharePermission } from "../models/SharePermission";

async function fixSharePermissionIndex() {
  try {
    console.log("🔧 Fixing SharePermission indexes...");

    // Connect to MongoDB - use the same connection string as the main app
    // Load environment variables
    require("dotenv").config();
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error("MONGODB_URI environment variable is not set");
    }
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    const collection = mongoose.connection.db.collection("sharepermissions");

    // Get all indexes
    const indexes = await collection.indexes();
    console.log("\n📋 Current indexes:");
    indexes.forEach((idx: any) => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    // Find and drop the old problematic index
    const oldIndex = indexes.find(
      (idx: any) =>
        idx.name === "scope_1_linkToken_1" ||
        (idx.key?.scope === 1 && idx.key?.linkToken === 1 && !idx.partialFilterExpression)
    );

    if (oldIndex) {
      console.log(`\n🗑️  Dropping old index: ${oldIndex.name}`);
      await collection.dropIndex(oldIndex.name);
      console.log("✅ Old index dropped");
    } else {
      console.log("\n✅ No old problematic index found");
    }

    // Ensure the correct indexes exist by recreating the model (Mongoose will create them)
    console.log("\n🔨 Recreating correct indexes...");
    
    // The model definition already has the correct indexes with partialFilterExpression
    // We just need to ensure they're created
    await SharePermission.createIndexes();
    console.log("✅ Correct indexes ensured");

    // Verify the indexes
    const newIndexes = await collection.indexes();
    console.log("\n📋 Updated indexes:");
    newIndexes.forEach((idx: any) => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
      if (idx.partialFilterExpression) {
        console.log(`    Partial filter: ${JSON.stringify(idx.partialFilterExpression)}`);
      }
    });

    console.log("\n✅ Index fix complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error fixing indexes:", error);
    process.exit(1);
  }
}

fixSharePermissionIndex();

