import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function checkUsers() {
  const uri = process.env.MONGODB_URI;
  console.log("Connecting to:", uri);
  
  try {
    await mongoose.connect(uri!);
    console.log("Connected successfully");
    console.log("Current database:", mongoose.connection.db.databaseName);
    
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log("Collections in current db:", collections.map(c => c.name));
    
    const User = mongoose.connection.db.collection("users");
    const count = await User.countDocuments();
    console.log("User count in 'users' collection:", count);
    
    if (count > 0) {
      const firstUser = await User.findOne({});
      console.log("First user email:", firstUser?.email);
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

checkUsers();
