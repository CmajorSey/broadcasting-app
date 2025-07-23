const { MongoClient } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");
    return client.db(); // Returns the default database from the URI
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err);
    throw err;
  }
}

module.exports = connectDB;
