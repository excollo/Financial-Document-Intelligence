const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const MONGODB_URI = process.env["MONGODB-URI"] || "mongodb+srv://Sonu7891:Sonu1234@cluster0.qfv4x.mongodb.net/pdf-summarizer";

async function createE2EUser() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");

    const email = "e2e@test.com";
    const password = "Password123!";
    const hashedPassword = await bcrypt.hash(password, 10);

    const User = mongoose.model("User", new mongoose.Schema({
      email: String,
      password: { type: String },
      role: { type: String, default: "admin" },
      domain: String,
      domainId: String,
      status: { type: String, default: "active" }
    }));

    // Upsert the E2E user
    await User.findOneAndUpdate(
      { email },
      { 
        email, 
        password: hashedPassword, 
        role: "admin", 
        domain: "test.com", 
        domainId: "domain_test_com",
        status: "active" 
      },
      { upsert: true, new: true }
    );

    console.log("E2E user created/updated successfully");
  } catch (error) {
    console.error("Error creating E2E user:", error);
  } finally {
    await mongoose.connection.close();
  }
}

createE2EUser();
