import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

/**
 * 🛠️ COSMOS DB INDEX FIXER
 * Resolves "BadRequest (400): The index path corresponding to the specified order-by item is excluded."
 */

async function fixIndexes() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI not found in environment.");
    return;
  }

  const client = new MongoClient(uri);

  try {
    console.log("🚀 Connecting to Cosmos DB...");
    await client.connect();
    const db = client.db("financial-doc-intelligence");

    // Fix Workspaces
    console.log("\n📦 [workspaces] Checking indexes...");
    const workspaceCol = db.collection("workspaces");
    await workspaceCol.createIndex({ domain: 1 });
    await workspaceCol.createIndex({ domain: 1, createdAt: -1 });
    console.log("   ✅ Indexes created for [workspaces]");

    // Fix Users
    console.log("\n👤 [users] Checking indexes...");
    const userCol = db.collection("users");
    await userCol.createIndex({ domain: 1 });
    await userCol.createIndex({ domainId: 1 });
    await userCol.createIndex({ email: 1 });
    console.log("   ✅ Indexes created for [users]");

    // Fix Documents (match real filters and sorts used by controllers)
    console.log("\n📄 [documents] Checking indexes...");
    const docCol = db.collection("documents");
    await docCol.createIndex({ domain: 1 });
    await docCol.createIndex({ domainId: 1 });
    await docCol.createIndex({ workspaceId: 1 });
    await docCol.createIndex({ directoryId: 1 });
    await docCol.createIndex({ domain: 1, workspaceId: 1, uploadedAt: -1 });
    await docCol.createIndex({ workspaceId: 1, directoryId: 1, uploadedAt: -1 });
    await docCol.createIndex({ domainId: 1, workspaceId: 1, uploadedAt: -1 });
    await docCol.createIndex({ workspaceId: 1, namespace: 1 });
    await docCol.createIndex({ id: 1 });
    console.log("   ✅ Indexes created for [documents]");

    // Fix Directories (children listing + search + sharing)
    console.log("\n📁 [directories] Checking indexes...");
    const dirCol = db.collection("directories");
    await dirCol.createIndex({ domain: 1 });
    await dirCol.createIndex({ domainId: 1 });
    await dirCol.createIndex({ workspaceId: 1, parentId: 1, name: 1 });
    await dirCol.createIndex({ workspaceId: 1, parentId: 1, isShared: 1, sharedWithUserId: 1 });
    await dirCol.createIndex({ workspaceId: 1, id: 1 });
    await dirCol.createIndex({ workspaceId: 1, normalizedName: 1 });
    await dirCol.createIndex({ sharedFromDirectoryId: 1, sharedWithUserId: 1, workspaceId: 1 });
    console.log("   ✅ Indexes created for [directories]");

    // Fix SharePermissions (hot permission checks)
    console.log("\n🔐 [sharepermissions] Checking indexes...");
    const shareCol = db.collection("sharepermissions");
    await shareCol.createIndex({ domain: 1, resourceType: 1, resourceId: 1 });
    await shareCol.createIndex({ scope: 1, principalId: 1 });
    await shareCol.createIndex({ resourceType: 1, resourceId: 1, scope: 1, principalId: 1, domain: 1 });
    await shareCol.createIndex({ resourceType: 1, resourceId: 1, scope: 1, invitedEmail: 1, domain: 1 });
    await shareCol.createIndex({ resourceType: 1, scope: 1, principalId: 1 });
    await shareCol.createIndex({ resourceType: 1, scope: 1, invitedEmail: 1 });
    console.log("   ✅ Indexes created for [sharepermissions]");

    console.log("\n🎉 ALL INDEXES OPERATIONAL!");

  } catch (error) {
    console.error("❌ Error setting up indexes:", error);
  } finally {
    await client.close();
  }
}

fixIndexes();
