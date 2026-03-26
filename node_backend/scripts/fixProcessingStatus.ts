/**
 * Script to fix documents stuck in "processing" status
 * If a document has summaries, it means processing is complete
 * This script updates the status to "completed" for such documents
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Document } from "../models/Document";
import { Summary } from "../models/Summary";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "";

async function fixProcessingStatus() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Find all documents with "processing" status
    const processingDocs = await Document.find({ status: "processing" });
    console.log(`\n📄 Found ${processingDocs.length} documents with "processing" status`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const doc of processingDocs) {
      try {
        // Check if summaries exist for this document
        const summaries = await Summary.find({ documentId: doc.id });
        
        if (summaries && summaries.length > 0) {
          // Document has summaries, so processing is complete
          doc.status = "completed";
          await doc.save();
          console.log(`✅ Updated document ${doc.id} (${doc.name}) status to "completed" (${summaries.length} summaries found)`);
          updatedCount++;
        } else {
          // No summaries yet, might still be processing
          console.log(`⏳ Document ${doc.id} (${doc.name}) still has no summaries - keeping as "processing"`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error processing document ${doc.id}:`, error);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Updated: ${updatedCount} documents`);
    console.log(`   ⏳ Skipped: ${skippedCount} documents`);
    console.log(`\n✅ Script completed successfully`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
fixProcessingStatus();





















