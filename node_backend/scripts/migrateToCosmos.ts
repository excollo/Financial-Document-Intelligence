import { MongoClient } from "mongodb";

/**
 * 🚀 SELECTIVE MIGRATION
 * Skips "summaries" and "reports" to ensure the rest of the data moves quickly.
 */

async function migrate() {
  const sourceUri = "mongodb+srv://Sonu7891:Sonu1234@cluster0.qfv4x.mongodb.net/pdf-summarizer";
  const destUri = process.env.MONGODB_URI!;

  const sourceClient = new MongoClient(sourceUri);
  const destClient = new MongoClient(destUri);
  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

  // Collections to SKIP
  const SKIP_LIST = ["summaries", "reports"];

  try {
    await sourceClient.connect();
    await destClient.connect();
    const sourceDb = sourceClient.db("pdf-summarizer");
    const destDb = destClient.db("financial-doc-intelligence");

    const collections = await sourceDb.listCollections().toArray();
    console.log(`📦 Found ${collections.length} collections.`);

    for (const colDef of collections) {
      const colName = colDef.name;
      
      // SKIP LOGIC
      if (colName.startsWith("system.") || SKIP_LIST.includes(colName)) {
        console.log(`\n⏭️  Skipping [${colName}] as requested.`);
        continue;
      }

      console.log(`\n🔄 [${colName}]`);
      const sourceCol = sourceDb.collection(colName);
      const destCol = destDb.collection(colName);

      const docs = await sourceCol.find({}).toArray();
      if (docs.length === 0) continue;

      console.log(`   📝 Inserting ${docs.length} docs...`);
      await destCol.deleteMany({}); 

      const batchSize = 50; 
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        await destCol.insertMany(batch);
        process.stdout.write(`   ...Progress: ${i + batch.length}/${docs.length}\r`);
        await sleep(500); 
      }
      console.log(`\n   ✅ Done.`);
    }

    console.log("\n🎉 SELECTIVE MIGRATION COMPLETE!");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await sourceClient.close();
    await destClient.close();
  }
}

migrate();
