/**
 * Migration Script: Create Directories from Documents
 * 
 * This script:
 * 1. Checks ALL documents (DRHP and RHP) in the database
 * 2. Creates directories from all DRHP document names
 * 3. Attaches their linked RHP documents to the same directory
 * 4. For any unlinked RHP documents, creates directories based on their names
 * 5. Migrates all documents to their appropriate directories
 * 
 * Run with: npx ts-node scripts/migrateCreateDirectoriesFromDocuments.ts
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Directory } from "../models/Directory";
import { Document } from "../models/Document";
import { normalizeCompanyName, findSimilarDirectories } from "../lib/companyNameNormalizer";

dotenv.config();

/**
 * Extract company name from document filename
 * Examples:
 * - "CompanyA_DRHP_2024.pdf" → "CompanyA"
 * - "Company B Limited_DRHP_2023.pdf" → "Company B Limited"
 * - "DRHP_CompanyC_2024.pdf" → "CompanyC"
 */
function extractCompanyNameFromFilename(filename: string): string {
  if (!filename) return "";

  // Remove file extension
  let name = filename.replace(/\.pdf$/i, "").trim();

  // Remove common patterns
  // Remove "DRHP" or "RHP" from anywhere in the name
  name = name.replace(/\b(DRHP|RHP)\b/gi, "").trim();
  
  // Remove year patterns (4 digits, possibly with underscores/dashes)
  name = name.replace(/[_-]?\d{4}[_-]?/g, "").trim();
  
  // Remove common separators at start/end
  name = name.replace(/^[_-]+|[_-]+$/g, "").trim();
  
  // If name starts with underscore/dash, remove it
  name = name.replace(/^[_-]/, "").trim();
  
  // If empty after cleaning, use original filename (without extension)
  if (!name) {
    name = filename.replace(/\.pdf$/i, "").replace(/\b(DRHP|RHP)\b/gi, "").trim();
  }

  return name || "Unknown Company";
}

/**
 * Create directory for a document (DRHP or RHP)
 * Returns the directory and whether it was newly created
 * Each document gets its own directory based on its name
 */
async function createDirectoryForDocument(
  documentId: string,
  companyName: string,
  workspaceId: string,
  domain: string,
  domainId: string,
  ownerUserId?: string
): Promise<{ directory: InstanceType<typeof Directory>; isNew: boolean }> {
  const normalizedName = normalizeCompanyName(companyName);
  
  // Check if directory already exists for this document
  // We'll use a naming convention: include document ID or use the company name
  // First, check if there's already a directory with this exact name in this workspace
  let directory = await Directory.findOne({
    workspaceId,
    name: companyName,
    parentId: null, // Only top-level directories
  });

  if (directory) {
    console.log(`   📁 Using existing directory: "${directory.name}"`);
    return { directory, isNew: false };
  }

  // Create new directory for this document
  // Use a unique ID with timestamp and random string to avoid collisions
  const directoryId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  
  try {
    const newDirectory = new Directory({
      id: directoryId,
      name: companyName,
      normalizedName,
      parentId: null, // Top-level company directory
      domain,
      domainId,
      workspaceId,
      ownerUserId,
      documentCount: 0,
      drhpCount: 0,
      rhpCount: 0,
    });

    await newDirectory.save();
    console.log(`   ✅ Created new directory: "${companyName}" (for document: ${documentId})`);
    return { directory: newDirectory, isNew: true };
  } catch (error: any) {
    // If duplicate key error, try to find the existing directory
    if (error.code === 11000) {
      console.log(`   ⚠️  Duplicate key error, searching for existing directory...`);
      directory = await Directory.findOne({
        workspaceId,
        name: companyName,
        parentId: null,
      });
      if (directory) {
        console.log(`   📁 Found existing directory: "${directory.name}"`);
        return { directory, isNew: false };
      }
      // If still not found, try with normalized name
      directory = await Directory.findOne({
        workspaceId,
        normalizedName,
        parentId: null,
      });
      if (directory) {
        console.log(`   📁 Found existing directory by normalized name: "${directory.name}"`);
        return { directory, isNew: false };
      }
    }
    throw error;
  }
}

/**
 * Update directory statistics
 */
async function updateDirectoryStats(directoryId: string, workspaceId: string) {
  const docCount = await Document.countDocuments({
    directoryId,
    workspaceId,
  });

  const drhpCount = await Document.countDocuments({
    directoryId,
    workspaceId,
    type: "DRHP",
  });

  const rhpCount = await Document.countDocuments({
    directoryId,
    workspaceId,
    type: "RHP",
  });

  const lastDoc = await Document.findOne({
    directoryId,
    workspaceId,
  })
    .sort({ uploadedAt: -1 })
    .select("uploadedAt");

  const now = new Date();
  await Directory.updateOne(
    { id: directoryId, workspaceId },
    {
      $set: {
        documentCount: docCount,
        drhpCount,
        rhpCount,
        updatedAt: now,
        ...(lastDoc?.uploadedAt && { lastDocumentUpload: lastDoc.uploadedAt }),
      },
    }
  );
}

async function migrateDocumentsToDirectories() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("❌ MONGODB_URI not found in environment variables");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB\n");

    // STEP 1: Check ALL documents first
    console.log("📊 STEP 1: Analyzing all documents in database...\n");
    
    const allDrhpDocs = await Document.find({ type: "DRHP" }).sort({ uploadedAt: 1 });
    const allRhpDocs = await Document.find({ type: "RHP" }).sort({ uploadedAt: 1 });
    
    const totalDrhpCount = allDrhpDocs.length;
    const totalRhpCount = allRhpDocs.length;
    
    console.log(`📄 Found ${totalDrhpCount} DRHP documents`);
    console.log(`📄 Found ${totalRhpCount} RHP documents`);
    console.log(`📄 Total documents: ${totalDrhpCount + totalRhpCount}\n`);

    if (totalDrhpCount === 0 && totalRhpCount === 0) {
      console.log("✅ No documents to migrate. All documents are already organized.\n");
      await mongoose.disconnect();
      process.exit(0);
    }

    // STEP 2: Identify linked and unlinked documents
    console.log("📊 STEP 2: Identifying document relationships...\n");
    
    // Track which RHP documents are linked to DRHP documents
    const linkedRhpIds = new Set<string>();
    const drhpToRhpMap = new Map<string, string[]>(); // Map: drhpId -> [rhpIds]
    const rhpToDrhpMap = new Map<string, string>(); // Map: rhpId -> drhpId
    
    // Process all DRHP documents and find their linked RHP documents
    for (const drhpDoc of allDrhpDocs) {
      const linkedRhps: string[] = [];
      
      // Find RHP documents that reference this DRHP (by relatedDrhpId)
      const rhpDocsReferencing = allRhpDocs.filter(
        rhp => rhp.relatedDrhpId === drhpDoc.id && rhp.workspaceId === drhpDoc.workspaceId
      );
      
      for (const rhp of rhpDocsReferencing) {
        linkedRhpIds.add(rhp.id);
        linkedRhps.push(rhp.id);
        rhpToDrhpMap.set(rhp.id, drhpDoc.id);
      }
      
      // Also check if DRHP has relatedRhpId field pointing to an RHP
      if (drhpDoc.relatedRhpId) {
        const linkedRhp = allRhpDocs.find(
          rhp => rhp.id === drhpDoc.relatedRhpId && rhp.workspaceId === drhpDoc.workspaceId
        );
        if (linkedRhp) {
          linkedRhpIds.add(linkedRhp.id);
          if (!linkedRhps.includes(linkedRhp.id)) {
            linkedRhps.push(linkedRhp.id);
          }
          rhpToDrhpMap.set(linkedRhp.id, drhpDoc.id);
        }
      }
      
      if (linkedRhps.length > 0) {
        drhpToRhpMap.set(drhpDoc.id, linkedRhps);
      }
    }
    
    // Identify unlinked RHP documents
    const unlinkedRhpDocs = allRhpDocs.filter(rhp => !linkedRhpIds.has(rhp.id));
    
    console.log(`   ✅ Linked RHP documents: ${linkedRhpIds.size}`);
    console.log(`   📄 Unlinked RHP documents: ${unlinkedRhpDocs.length}`);
    console.log(`   📁 DRHP documents with linked RHP: ${drhpToRhpMap.size}\n`);

    // STEP 3: Process all DRHP documents and create directories
    console.log("📊 STEP 3: Processing DRHP documents and creating directories...\n");
    
    let processed = 0;
    let created = 0;
    let moved = 0;
    let skipped = 0;
    let errors = 0;
    const drhpDirectoryMap = new Map<string, InstanceType<typeof Directory>>(); // Map: drhpDoc.id -> Directory

    for (const drhpDoc of allDrhpDocs) {
      try {
        console.log(`\n[${processed + 1}/${totalDrhpCount}] 📄 Processing DRHP: "${drhpDoc.name}"`);
        console.log(`   DRHP ID: ${drhpDoc.id}`);
        console.log(`   Workspace: ${drhpDoc.workspaceId || "N/A"}`);
        console.log(`   Current directoryId: ${drhpDoc.directoryId || "null (root)"}`);

        // Extract company name from DRHP document name
        const companyName = extractCompanyNameFromFilename(drhpDoc.name);
        console.log(`   Extracted company name: "${companyName}"`);

        // Create directory for this DRHP document
        let directory = drhpDirectoryMap.get(drhpDoc.id);
        let isNewDirectory = false;

        if (!directory) {
          const result = await createDirectoryForDocument(
            drhpDoc.id,
            companyName,
            drhpDoc.workspaceId,
            drhpDoc.domain,
            drhpDoc.domainId,
            drhpDoc.userId
          );
          directory = result.directory;
          isNewDirectory = result.isNew;
          
          drhpDirectoryMap.set(drhpDoc.id, directory);
          
          if (isNewDirectory) {
            created++;
            console.log(`   ✨ NEW directory created: "${directory.name}"`);
          }
        } else {
          console.log(`   📁 Using existing directory: "${directory.name}"`);
        }

        // Move DRHP document to directory (only if not already there)
        if (drhpDoc.directoryId !== directory.id) {
          await Document.updateOne(
            { _id: drhpDoc._id },
            { $set: { directoryId: directory.id } }
          );
          console.log(`   ✅ Moved DRHP to directory: "${directory.name}"`);
          moved++;
        } else {
          console.log(`   ℹ️  DRHP already in correct directory: "${directory.name}"`);
          skipped++;
        }

        // STEP 4: Move linked RHP documents to this DRHP's directory
        const linkedRhpIds = drhpToRhpMap.get(drhpDoc.id) || [];
        
        if (linkedRhpIds.length > 0) {
          console.log(`   🔍 Found ${linkedRhpIds.length} linked RHP document(s)...`);
          
          for (const rhpId of linkedRhpIds) {
            const rhpDoc = allRhpDocs.find(rhp => rhp.id === rhpId);
            if (rhpDoc) {
              if (rhpDoc.directoryId !== directory.id) {
                await Document.updateOne(
                  { _id: rhpDoc._id },
                  { $set: { directoryId: directory.id } }
                );
                console.log(`   ✅ Moved linked RHP "${rhpDoc.name}" to DRHP directory: "${directory.name}"`);
                moved++;
              } else {
                console.log(`   ℹ️  Linked RHP "${rhpDoc.name}" already in correct directory`);
              }
            }
          }
        } else {
          console.log(`   ℹ️  No linked RHP documents for this DRHP`);
        }

        // Update directory statistics
        await updateDirectoryStats(directory.id, drhpDoc.workspaceId);

        processed++;
      } catch (error: any) {
        errors++;
        console.error(`   ❌ Error processing DRHP document ${drhpDoc.id}:`, error.message);
      }
    }

    // STEP 5: Process unlinked RHP documents and create directories for them
    console.log(`\n\n📊 STEP 4: Processing unlinked RHP documents and creating directories...\n`);
    console.log(`   Found ${unlinkedRhpDocs.length} unlinked RHP documents\n`);

    for (const rhpDoc of unlinkedRhpDocs) {
      try {
        console.log(`📄 Processing unlinked RHP: "${rhpDoc.name}"`);
        console.log(`   RHP ID: ${rhpDoc.id}`);
        console.log(`   Workspace: ${rhpDoc.workspaceId || "N/A"}`);
        console.log(`   Current directoryId: ${rhpDoc.directoryId || "null (root)"}`);

        // Extract company name from RHP document name
        const companyName = extractCompanyNameFromFilename(rhpDoc.name);
        console.log(`   Extracted company name: "${companyName}"`);

        // Create directory for this unlinked RHP document
        const result = await createDirectoryForDocument(
          rhpDoc.id,
          companyName,
          rhpDoc.workspaceId,
          rhpDoc.domain,
          rhpDoc.domainId,
          rhpDoc.userId
        );
        const directory = result.directory;
        
        if (result.isNew) {
          created++;
          console.log(`   ✨ Created new directory for unlinked RHP: "${directory.name}"`);
        } else {
          console.log(`   📁 Using existing directory: "${directory.name}"`);
        }

        // Move RHP document to directory (only if not already there)
        if (rhpDoc.directoryId !== directory.id) {
          await Document.updateOne(
            { _id: rhpDoc._id },
            { $set: { directoryId: directory.id } }
          );
          console.log(`   ✅ Moved RHP to directory: "${directory.name}"`);
          moved++;
        } else {
          console.log(`   ℹ️  RHP already in correct directory`);
          skipped++;
        }

        // Update directory statistics
        await updateDirectoryStats(directory.id, rhpDoc.workspaceId);

        processed++;
      } catch (error: any) {
        errors++;
        console.error(`   ❌ Error processing unlinked RHP document ${rhpDoc.id}:`, error.message);
      }
    }

    // Final Summary
    console.log(`\n\n📊 Migration Summary:`);
    console.log(`   ✅ Total documents processed: ${processed}`);
    console.log(`   📁 Directories created: ${created}`);
    console.log(`   📦 Documents moved: ${moved}`);
    console.log(`   ⏭️  Documents skipped (already in correct directory): ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`\n📈 Detailed Statistics:`);
    console.log(`   Total DRHP documents: ${totalDrhpCount}`);
    console.log(`   Total RHP documents: ${totalRhpCount}`);
    console.log(`   Linked RHP documents: ${linkedRhpIds.size}`);
    console.log(`   Unlinked RHP documents: ${unlinkedRhpDocs.length}`);
    console.log(`   Directories created: ${created}`);
    console.log(`\n✅ Migration completed!\n`);
    
    // Final verification
    const finalDirCount = await Directory.countDocuments({ parentId: null });
    const finalDrhpCount = await Document.countDocuments({ type: "DRHP" });
    const finalRhpCount = await Document.countDocuments({ type: "RHP" });
    const docsWithoutDir = await Document.countDocuments({
      $or: [
        { directoryId: null },
        { directoryId: { $exists: false } }
      ]
    });
    
    console.log(`📁 Final Verification:`);
    console.log(`   Total directories in database: ${finalDirCount}`);
    console.log(`   Total DRHP documents: ${finalDrhpCount}`);
    console.log(`   Total RHP documents: ${finalRhpCount}`);
    console.log(`   Documents without directory: ${docsWithoutDir}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
migrateDocumentsToDirectories();

