import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function checkUsers() {
  const originalUri = process.env["MONGODB-URI"];
  // Move the database name before the ?
  const fixedUri = originalUri?.replace("/?ssl=true", "/financial-doc-intelligence?ssl=true").split("/financial-doc-intelligence")[0] + "/financial-doc-intelligence" + originalUri?.split("?")[1] ? "?" + originalUri?.split("?")[1].replace("/financial-doc-intelligence", "") : "";
  
  // Actually, let's just construct it simply for the test
  const testUri = process.env["MONGODB-URI"];

  console.log("Connecting to Fixed URI:", testUri);
  
  try {
    await mongoose.connect(testUri!);
    console.log("Connected successfully");
    console.log("Current database:", mongoose.connection.db.databaseName);
    
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log("Collections in current db:", collections.map(c => c.name));
    
    const UserCol = mongoose.connection.db.collection("users");
    const count = await UserCol.countDocuments();
    console.log("User count in 'users' collection:", count);
    
    if (count > 0) {
      const firstUser = await UserCol.findOne({});
      console.log("First user email:", firstUser?.email);
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

checkUsers();
