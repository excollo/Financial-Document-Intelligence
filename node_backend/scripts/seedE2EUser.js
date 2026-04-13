const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String },
  name: { type: String },
  domain: { type: String, required: true },
  domainId: { type: String, required: true },
  role: { type: String, enum: ["admin", "user"], default: "user" },
  status: { type: String, default: "active" },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

async function run() {
  try {
    const email = "e2e@test.com";
    const password = "Password123!";
    const hashedPassword = await bcrypt.hash(password, 10);

    // Delete existing test user if any
    await User.deleteOne({ email });

    const testUser = new User({
      email,
      password: hashedPassword,
      name: "E2E Tester",
      domain: "test.com",
      domainId: "test.com",
      role: "user",
      status: "active"
    });

    await testUser.save();
    console.log("E2E Test User created successfully!");
    console.log("Email: ", email);
    console.log("Password: ", password);
  } catch (error) {
    console.error("Seeding failed:", error);
  } finally {
    mongoose.connection.close();
  }
}

run();
