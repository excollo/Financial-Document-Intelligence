
import mongoose from "mongoose";
import { Summary } from "./models/Summary";
import dotenv from "dotenv";

dotenv.config();

async function checkSummaries() {
    try {
        await mongoose.connect(process.env.MONGODB_URI as string);
        console.log("Connected to MongoDB");

        // Get latest 5 summaries
        const summaries = await Summary.find({}).sort({ _id: -1 }).limit(5).lean();
        console.log(`Found ${summaries.length} recent summaries`);

        summaries.forEach(s => {
            console.log(`_id: ${s._id}, id: ${s.id} (Type: ${typeof s.id}), title: ${s.title}`);
        });

        await mongoose.disconnect();
    } catch (error) {
        console.error("Error:", error);
    }
}

checkSummaries();
