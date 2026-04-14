import { MongoClient } from "mongodb";

async function checkUser() {
  const destUri = process.env.MONGODB_URI!;
  const client = new MongoClient(destUri);

  try {
    await client.connect();
    const db = client.db("financial-doc-intelligence");
    const users = await db.collection("users").find({}).toArray();
    
    console.log(`👤 Found ${users.length} users in Cosmos.`);
    if (users.length > 0) {
      console.log("First user email:", users[0].email);
      console.log("Has password field:", !!users[0].password);
    }
  } catch (e) {
    console.error("❌ Link test failed:", e);
  } finally {
    await client.close();
  }
}
checkUser();
