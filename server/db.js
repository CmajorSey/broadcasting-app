// db.js (ES Module version)
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  retryWrites: true,
  tls: true
});

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("loboard");
    console.log("✅ Connected to MongoDB Atlas — DB: loboard");
    return db;
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err);
    throw err;
  }
}

export default connectDB;
