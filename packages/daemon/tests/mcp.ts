import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { streamSSE } from 'hono/streaming';
import { SSETransport } from "../src/SSEServerTransportHono.js";
import { Hono } from "hono";
import { z } from "zod";

const app = new Hono();
const server = new McpServer({
    name: "test server",
    version: "1.0.0",
})

server.tool("getDaemonServerInfo", "Get a list of tools provided by the server", async () => {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify([
                    {
                        serverUrl: "http://localhost:3000",
                        toolName: "hello",
                        type: "ondemand",
                        description: "Say hello",
                        parameters: [
                            {
                                name: "name",
                                type: "string",
                                description: "The name to say hello to",
                            }
                        ],
                    }
                ])
            }
        ]
    }
})

server.tool(
    "hello", 
    "Say hello to a name", 
    {
        name: z.string(),
    },
    async (args) => {
        return {
        content: [
            {
                type: "text",
                text: `Hello ${args.name}`
            }
        ]
    }
})
// to support multiple simultaneous connections we have a lookup object from
// sessionId to transport
const transports: { [sessionId: string]: SSETransport } = {};
app.get('/sse', (c) => {
    return streamSSE(c, async (stream) => {
      const transport = new SSETransport('/messages', stream);
  
      transports[transport.sessionId] = transport;
  
      stream.onAbort(() => {
        delete transports[transport.sessionId];
      });
  
      await server.connect(transport);
  
      while (true) {
        // This will keep the connection alive
        // You can also await for a promise that never resolves
        await stream.sleep(60_000);
      }
    });
});

app.post('/messages', async (c) => {
    const sessionId = c.req.query('sessionId');
    const transport = transports[sessionId as string];
  
    if (transport == null) {
      return c.text('No transport found for sessionId', 400);
    }
    
    return transport.handlePostMessage(c);
});
  

export default app;