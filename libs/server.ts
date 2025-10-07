import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import { z } from "zod";
dotenv.config();

// Added following 3 components from the SDK to make MCP bridge
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json()); // for parsing application/json

// Configuration (very important! This is the URL of LLM Server in Python)
const LLM_SERVER_URL = "http://localhost:8001/v1/completions";

// ! MCP Client
// LISTING available MCP resources
async function listMcpResources(): Promise<string[]> {
  const client = new Client({ name: "example-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/refayet/dev/theRoot/proto/sandbox-llm-orch/libs/local-data-src'],
  });
  
  await client.connect(transport);
  const response = await client.listResources();
  await client.close();
  
  return response.resources.map(r => r.uri);
}

// GETTING content from the MCP server
async function getContentFromMcp(filePath: string): Promise<string> {
  const client = new Client({
    name: "llm-orchestrator-client",
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  try {
    // Define the transport (how we talk to the server)
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y', 
        '@modelcontextprotocol/server-filesystem', 
        '/home/refayet/dev/theRoot/proto/sandbox-llm-orch/libs/local-data-src'
      ],
    });

    // Connect to the MCP server
    await client.connect(transport);
    console.log('Connected to MCP Filesystem server');

    // Define schemas for the responses
    const ListResourcesResultSchema = z.object({
      resources: z.array(z.object({
        uri: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        mimeType: z.string().optional(),
      }))
    });

    const ReadResourceResultSchema = z.object({
      contents: z.array(z.union([
        z.object({
          uri: z.string(),
          mimeType: z.string().optional(),
          text: z.string()
        }),
        z.object({
          uri: z.string(),
          mimeType: z.string().optional(),
          blob: z.string()
        })
      ]))
    });

    // First, list available resources to see what's available
    // try {
    //   const listResult = await client.request(
    //     { method: "resources/list" },
    //     ListResourcesResultSchema
    //   );
    //   console.log('Available resources:', listResult.resources?.map(r => r.uri) || []);
    // } catch (listError) {
    //   console.log('Could not list resources:', listError);
    // }
        try {
      const resources = await client.listResources();
      console.log('Available resources:', resources.resources?.map(r => r.uri) || []);
    } catch (listError: any) {
      console.log('Could not list resources (this is okay):', listError.message);
    }

    // Read the resource (file) using the request method
    console.log('Attempting to read file:', `file://${filePath}`);
    // const readResult = await client.request(
    //   {
    //     method: "resources/read", 
    //     params: { uri: `file://${filePath}` }
    //   },
    //   ReadResourceResultSchema
    // );
     const result = await client.readResource({
      uri: `file://${filePath}`
    });


    // Extract text content from the response
    if (result.contents && result.contents.length > 0) {
      const content = result.contents[0];
      
      if ('text' in content && content.text) {
        console.log('Successfully read file from MCP server');
        return content.text as string;
      } else if ('blob' in content && content.blob) {
        console.log('File contains binary data (blob)');
        // For binary files like PDFs, you'd need additional processing
        return '';
      }
    }

    console.log('No content found in MCP response');
    return '';

  } catch (error: any) {
    console.error('Error calling MCP Server:', error.message || JSON.stringify(error));
    if (error.code === -32601) {
      console.error('This usually means the method is not supported by the server.');
      console.error('Make sure you are using the correct MCP filesystem server.');
    }
    return '';
  } finally {
    // Always close the connection
    try {
      await client.close();
    } catch (closeError) {
      console.error('Error closing client:', closeError);
    }
  }
}


/**
 * ! API End Points
 */
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

    // 1. Define a file you want to read from the MCP server's allowed directory
    // For example, let's assume we want to read 'notes.txt'
    const filePathFromMcp = '/home/refayet/dev/theRoot/proto/sandbox-llm-orch/libs/local-data-src/test.txt';

     // 2. Call the MCP server to get the content of that file
    const fileContent = await getContentFromMcp(filePathFromMcp);
    let context = '';
    
    if (fileContent) {
      context = `Use the following context from a file to answer the user's question. If the context is not relevant, use your own knowledge.\n\nCONTEXT:\n${fileContent}\n\n`;
    } else {
      console.log('No content received from MCP server or file not found.');
    }

    
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



/**
 * ! START OF THE SERVER Listener
 */
app.listen(PORT, () => {
  console.log(
    `Node.js Orchestrator server running on http://localhost:${PORT}`
  );
});
