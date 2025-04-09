import { expect, test, describe, beforeEach, beforeAll, afterAll } from "bun:test";
import { Daemon } from "../src/daemon";
import { Keypair } from "@solana/web3.js";
import { nanoid } from "nanoid";
import mcpApp from "./mcp.js";
import type { Server } from "bun";

describe("Daemon", () => {
  let daemon: Daemon;
  let keypair: Keypair;
  let server: Server;
  
  beforeAll(async () => {
    // Start the MCP server for the tests
    try {
      server = Bun.serve({
        port: 3000,
        fetch: mcpApp.fetch
      });
      console.log("MCP server started on port 3000");
    } catch (error) {
      console.error("Failed to start MCP server:", error);
    }
  });
  
  afterAll(async () => {
    // Stop the server
    if (server) {
      server.stop();
      console.log("MCP server stopped");
    }
  });
  
  beforeEach(() => {
    // Create a new keypair for each test
    keypair = Keypair.generate();
    
    // Create a new daemon instance
    daemon = new Daemon(
      {
        name: "TestDaemon",
        pubkey: keypair.publicKey.toBase58(),
        identityPrompt: "You are TestDaemon, a helpful assistant for testing."
      },
      keypair
    );
    
    // Add OpenAI model provider
    daemon.addModelProvider({
      provider: "openai",
      models: ["gpt-4o-mini"],
      apiKey: process.env.OPENAI_API_KEY || "",
      endpoint: "https://api.openai.com/v1"
    });
  });
  
  test("should initialize daemon with correct properties", () => {
    expect(daemon.character.name).toBe("TestDaemon");
    expect(daemon.character.identityPrompt).toBe("You are TestDaemon, a helpful assistant for testing.");
    expect(daemon.keypair).toBe(keypair);
    expect(daemon.models.length).toBe(1);
    expect(daemon.models[0].provider).toBe("openai");
    expect(daemon.models[0].models).toEqual(["gpt-4o-mini"]);
  });
  
  test("should add model provider", async () => {
    await daemon.addModelProvider({
        provider: "openai",
        models: ["gpt-4o-mini"],
        apiKey: process.env.OPENAI_API_KEY || "",
        endpoint: "https://api.openai.com/v1"
    });
    
    expect(daemon.models.length).toBe(1);
    expect(daemon.models[0].provider).toBe("openai");
    expect(daemon.models[0].models).toEqual(["gpt-4o-mini"]);
  });
  
  test("should replace existing model provider", async () => {
    await daemon.addModelProvider({
      provider: "openai",
      models: ["gpt-4-turbo"],
      apiKey: "new-api-key",
      endpoint: "https://api.openai.com/v1/"
    });
    
    expect(daemon.models.length).toBe(1);
    expect(daemon.models[0].provider).toBe("openai");
    expect(daemon.models[0].models).toEqual(["gpt-4-turbo"]);
  });
  
  test("should add a single tool", async () => {
    // Add the hello tool from our test server
    await daemon.addSingleToolFromProvider({
      type: "ondemand",
      serverUrl: "http://localhost:3000",
      toolName: "hello",
      description: "Say hello",
      parameters: [
        {
          name: "name",
          type: "string",
          description: "The name to say hello to",
        }
      ],
    });
    
    expect(daemon.tools.length).toBe(1);
    expect(daemon.tools[0].toolName).toBe("hello");
    expect(daemon.tools[0].serverUrl).toBe("http://localhost:3000");
  });
  
  test("should sign messages correctly", () => {
    const payload = Buffer.from("test message").toString("base64");
    const signature = daemon.sign({ payload });
    
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe("string");
  });
  
  test("should generate a message", async () => {
    // Skip if no API key is provided
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping test: No OPENAI_API_KEY provided");
      return;
    }
    
    const response = await daemon.message("Hello world", {
      llm: {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: process.env.OPENAI_API_KEY,
        endpoint: "https://api.openai.com/v1"
      }
    });
    
    expect(response).toBeTruthy();
    const value = response.getValue();
    expect(value.message).toBe("Hello world");
    expect(value.output).toBeTruthy();
    expect(value.daemonName).toBe("TestDaemon");
  }, 30000);
  
  test("should generate a message with tools", async () => {
    // Skip if no API key is provided
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping integration test: No OPENAI_API_KEY provided");
      return;
    }
    
    // Add the hello tool from MCP server
    await daemon.addAllToolsByProvider("http://localhost:3000");
    
    // Confirm the tool was added
    const helloTool = daemon.tools.find(tool => tool.toolName === "hello");
    expect(helloTool).toBeTruthy();
    
    // Use the actual messageWithTools method without mocking
    const response = await daemon.messageWithTools("Greet me by name. My name is TestUser.", {
      llm: {
        provider: "openai",
        model: "gpt-4o-mini", // Using a smaller model for faster testing
        apiKey: process.env.OPENAI_API_KEY,
        endpoint: "https://api.openai.com/v1"
      }
    });
    
    expect(response).toBeTruthy();
    
    // Wait for processing to complete
    let finalOutput = "";
    for (let i = 0; i < 30; i++) { // Wait up to 30 * 100ms = 3 seconds
      finalOutput = response.getValue().output || "";
      if (finalOutput && !finalOutput.includes("...thinking...")) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Verify the response contains something reasonable
    const value = response.getValue();
    expect(value.message).toBe("Greet me by name. My name is TestUser.");
    expect(finalOutput).toBeTruthy();
    expect(value.daemonName).toBe("TestDaemon");
    
    console.log("Tool test response:", finalOutput);
  }, 30000); // Allow 30 seconds for this test as it makes real API calls
  
  test("should throw error if no model provider is added", async () => {
    // Create a new daemon without any model providers
    const emptyDaemon = new Daemon(
      { 
        name: "EmptyDaemon",
        pubkey: keypair.publicKey.toBase58()
      },
      keypair
    );
    
    await expect(emptyDaemon.message("Hello")).rejects.toThrow("No model provider added");
  });
  
  test("should generate correct approval signature", async () => {
    const message = "Test message";
    const createdAt = new Date().toISOString();
    const messageId = nanoid();
    
    // Use a private method to test the approval generation
    // @ts-ignore: Accessing private method for testing
    const approval = daemon["generateApproval"](message, createdAt, messageId);
    
    expect(approval).toBeTruthy();
    expect(typeof approval).toBe("string");
  });
  
  test("integration test with actual API call", async () => {
    // Skip if no API key is provided
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping integration test: No OPENAI_API_KEY provided");
      return;
    }
    
    const response = await daemon.message("What is the capital of France?", {
      llm: {
        provider: "openai",
        model: "gpt-4o-mini", // Using a smaller model for faster testing
        apiKey: process.env.OPENAI_API_KEY,
        endpoint: "https://api.openai.com/v1"
      }
    });
    
    expect(response).toBeTruthy();
    
    // Wait for processing to complete (though it should be immediate in this case)
    let finalOutput = "";
    for (let i = 0; i < 30; i++) { // Wait up to 30 * 100ms = 3 seconds
      finalOutput = response.getValue().output || "";
      if (finalOutput) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const value = response.getValue();
    expect(value.message).toBe("What is the capital of France?");
    expect(finalOutput).toBeTruthy();
    // The actual output will vary, but it should contain "Paris"
    expect(finalOutput.toLowerCase()).toContain("paris");
    
    console.log("Integration test response:", finalOutput);
  }, 30000); // Allow 30 seconds for this test as it makes real API calls
  
  test("should add all tools from MCP server", async () => {
    await daemon.addAllToolsByProvider("http://localhost:3000");
    
    expect(daemon.tools.length).toBeGreaterThan(0);
    const helloTool = daemon.tools.find(tool => tool.toolName === "hello");
    expect(helloTool).toBeTruthy();
    expect(helloTool?.serverUrl).toBe("http://localhost:3000");
  });
  
  test("should call a tool from MCP server", async () => {
    await daemon.addAllToolsByProvider("http://localhost:3000");
    
    const helloTool = daemon.tools.find(tool => tool.toolName === "hello");
    if (!helloTool) {
      throw new Error("Hello tool not found");
    }
    
    // Call the hello tool with a test name
    const result = await daemon.callTool(helloTool, { name: "World" });
    
    // Check the result structure and content
    expect(result).toBeTruthy();
    expect(result.content).toBeInstanceOf(Array);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].text).toBe("Hello World");
  });
  
  test("should integrate MCP tools with message generation", async () => {
    // Skip if no API key is provided
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping test: No OPENAI_API_KEY provided");
      return;
    }
    
    // Add tools from MCP server
    await daemon.addAllToolsByProvider("http://localhost:3000");
    
    const response = await daemon.messageWithTools("Use the hello tool to say hello to TestDaemon and return the tool output. If you cannot use the tool, say so. Also let me know what you passed into the tool as arguments.", {
      llm: {
        provider: "openai",
        model: "gpt-4o",
        apiKey: process.env.OPENAI_API_KEY,
        endpoint: "https://api.openai.com/v1"
      }
    });
    
    expect(response).toBeTruthy();
    const value = response.getValue();
    expect(value.output).toContain("Hello TestDaemon");
  }, 30000);
});
