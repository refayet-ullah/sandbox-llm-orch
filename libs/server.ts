import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json()); // for parsing application/json

// Configuration (very important! This is the URL of your Python server)
const LLM_SERVER_URL = "http://localhost:8001/v1/completions";

// Basic health check endpoint
app.get("/health", (req, res) => {
  res.json({ message: "Node.js Orchestrator is running!" });
});

// Main chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // TODO: In the future, here is where you will call MCP servers to get context (PDFs, web content)
    // For today, we just forward the message directly to the LLM.
    const prompt = `Please respond to the following user message in a helpful and friendly manner.

User: ${message}
Assistant:`;

    // Call the Python LLM Server
    const llmResponse = await axios.post(LLM_SERVER_URL, {
      prompt: prompt,
      max_tokens: 150, // You can adjust these parameters
      temperature: 0.2,
    });

    // Send the LLM's response back to the client
    res.json({
      response: llmResponse.data.response,
      usage: llmResponse.data.usage,
    });
  } catch (error: any) {
    console.error("Error in /api/chat endpoint:", error.message);

    // Handle errors from the Python server
    if (error.response) {
      res.status(502).json({
        error: "Error from LLM server: " + error.response.data.detail,
      });
    } else if (error.code === "ECONNREFUSED") {
      res.status(503).json({
        error:
          "Could not connect to the LLM service. Is it running on port 8001?",
      });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.listen(PORT, () => {
  console.log(
    `Node.js Orchestrator server running on http://localhost:${PORT}`
  );
});
