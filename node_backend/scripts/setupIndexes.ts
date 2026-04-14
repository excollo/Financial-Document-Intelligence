import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

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

    // Fix Documents (Common sort by domain/createdAt)
    console.log("\n📄 [documents] Checking indexes...");
    const docCol = db.collection("documents");
    await docCol.createIndex({ domain: 1 });
    await docCol.createIndex({ directoryId: 1 });
    await docCol.createIndex({ domain: 1, createdAt: -1 });
    console.log("   ✅ Indexes created for [documents]");

    console.log("\n🎉 ALL INDEXES OPERATIONAL!");

  } catch (error) {
    console.error("❌ Error setting up indexes:", error);
  } finally {
    await client.close();
  }
}

fixIndexes();
