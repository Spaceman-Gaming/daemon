# `@spacemangaming/daemon`

## Overview

The `@spacemangaming/daemon` package provides the `Daemon` class, a framework for creating AI agents. It manages character identity, model providers, tool integration (via Model Context Protocol - MCP), message processing, and secure interactions.

## Installation

```bash
npm install @spacemangaming/daemon @solana/web3.js rxjs tweetnacl nanoid buffer
# or
yarn add @spacemangaming/daemon @solana/web3.js rxjs tweetnacl nanoid buffer
# or
pnpm add @spacemangaming/daemon @solana/web3.js rxjs tweetnacl nanoid buffer
```

## Core Components

### `Daemon` Class

The main class representing an AI agent.

**Properties:**

-   `character: Character`: Holds the configuration defining the Daemon's identity, including name and identity prompt.
-   `keypair: Keypair`: The Solana keypair used for signing messages and approvals.
-   `models: ModelProvider[]`: An array storing configured language model providers (e.g., OpenAI, Anthropic).
-   `tools: ToolProvider[]`: An array storing configured tool providers, fetched from MCP servers.

**Constructor:**

-   `constructor(character: Character, keypair: Keypair)`: Creates a new `Daemon` instance. Requires a `Character` object defining the agent's identity and a Solana `Keypair` for signing.

**Methods:**

-   `async addModelProvider(provider: ModelProvider): Promise<void>`: Adds or replaces a language model provider configuration. Providers define how the Daemon interacts with LLMs (e.g., API keys, endpoints, available models).

-   `async addSingleToolFromProvider(provider: ToolProvider): Promise<void>`: Registers a single tool provided by an MCP server.

-   `async addAllToolsByProvider(url: string): Promise<void>`: Connects to an MCP server at the specified `url`, retrieves its list of available tools using the `getDaemonServerInfo` tool, and registers them with the Daemon.

-   `async callTool(tool: ToolProvider, args: any): Promise<any>`: Executes a specific tool registered with the Daemon. Connects to the tool's server, validates arguments against the tool's parameter schema, calls the tool via MCP, and returns the result.

-   `sign(args: { payload: string }): string`: Signs a base64 encoded payload string using the Daemon's private key (`keypair.secretKey`) and returns the signature as a base64 string. Uses NaCl (TweetNaCl) for signing.

-   `async hook(hook: IHook): Promise<IHookLog>`: Handles server-requested callbacks (`hooks`). Currently supports the internal `sign` tool. It executes the specified `daemonTool` (e.g., `sign`), then calls back to the originating server's specified `hookTool` with the results.

-   `async message(message: string, opts?: MessageOptions): Promise<BehaviorSubject<Partial<IMessageLifecycle>>>`: Processes a user message through a standard lifecycle without direct LLM tool calling:

    1.  Initializes a `IMessageLifecycle` object.
    2.  (Optional) Fetches context using registered `context` tools.
    3.  Generates a prompt based on identity, message, and context.
    4.  Calls the configured LLM (`genText`) to get a response.
    5.  (Optional) Executes registered `action` tools based on the lifecycle state.
    6.  (Optional) Processes any `hooks` requested by action tools.
    7.  (Optional) Executes registered `postProcess` tools.
    8.  Returns an RxJS `BehaviorSubject` containing the final lifecycle state.

-   `async messageWithTools(message: string, opts?: MessageOptions): Promise<BehaviorSubject<Partial<IMessageLifecycle>>>`: Processes a user message similarly to `message`, but utilizes an LLM capable of tool calling (`genTextWithTools`):
    1.  Initializes a `IMessageLifecycle` object.
    2.  (Optional) Fetches context using `context` tools.
    3.  Generates an initial prompt.
    4.  Calls the configured LLM (`genTextWithTools`), providing available `ondemand` tools. The LLM can decide to call these tools during generation. Tool calls and responses are streamed.
    5.  Updates the `output` in the lifecycle as the LLM generates text and tool results.
    6.  Once generation is complete:
        -   (Optional) Executes `action` tools.
        -   (Optional) Processes `hooks`.
        -   (Optional) Executes `postProcess` tools.
    7.  Returns an RxJS `BehaviorSubject` containing the final lifecycle state.

### Message Lifecycle (`IMessageLifecycle`)

A BehaviorSubject holding the state of a message as it's processed. Key fields include:

-   `daemonPubkey`: Daemon's public key.
-   `daemonName`: Daemon's name.
-   `messageId`: Unique ID for the message interaction.
-   `message`: The input message.
-   `createdAt`: Timestamp.
-   `approval`: Signature proving Daemon processed this message.
-   `channelId`: Optional ID for conversation context.
-   `identityPrompt`: Base instructions for the LLM.
-   `context`: Data gathered from context tools.
-   `tools`: Descriptions of tools available to the LLM (used in `messageWithTools`).
-   `generatedPrompt`: The final prompt sent to the LLM.
-   `output`: The LLM's final textual response (may include interleaved tool results in `messageWithTools`).
-   `hooks`: Hooks requested by action tools.
-   `hooksLog`, `actionsLog`, `postProcessLog`: Logs of executed tools in different phases.

### Types (`Character`, `ToolProvider`, `ModelProvider`, etc.)

Refer to `packages/daemon/src/types.ts` for detailed definitions of configuration objects and interfaces like `Character`, `ToolProvider`, `ModelProvider`, `IHook`, `IMessageLifecycle`.

## Security

-   **Signing:** Uses Solana keypairs (`nacl.sign.detached`) to sign approvals and potentially other payloads via the `sign` method/hook, ensuring message authenticity.
-   **MCP:** Relies on the underlying Model Context Protocol for tool communication. Ensure server URLs (`sseUrl`) are trusted.

## Example Usage

```typescript
import { Daemon } from "@spacemangaming/daemon";
import type {
    Character,
    ModelProvider,
    ToolProvider,
} from "@spacemangaming/daemon";
import { Keypair } from "@solana/web3.js";
import { config } from "dotenv";

config(); // Load .env variables

// 1. Define Character
const keypair = Keypair.generate();
const character: Character = {
    name: "Helpful Assistant",
    pubkey: keypair.publicKey.toBase58(),
    identityPrompt: "You are a helpful assistant. Be concise.",
    // modelSettings and bootstrap might be handled differently now
};

// 2. Initialize Daemon
const daemon = new Daemon(character, keypair);

// 3. Add Model Provider
const openAIProvider: ModelProvider = {
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY || "YOUR_API_KEY", // Use environment variable
    endpoint: "https://api.openai.com/v1",
    models: ["gpt-4", "gpt-3.5-turbo"],
};
await daemon.addModelProvider(openAIProvider);

// 4. (Optional) Add Tools (Example: adding all tools from a memory server)
// Assuming a memory server running locally
// try {
//     await daemon.addAllToolsByProvider("http://localhost:3002");
// } catch (error) {
//     console.error("Failed to add tools from memory server:", error);
// }

// 5. Send a message
try {
    const lifecycleSubject = await daemon.message("Hello Daemon!", {
        llm: {
            // Specify LLM to use
            provider: "openai",
            model: "gpt-4",
        },
        // channelId: "general",
        // stages: { context: true, actions: true, postProcess: true } // Enable stages
    });

    // Subscribe to the final state or get the current value
    lifecycleSubject.subscribe((finalState) => {
        console.log("Final Output:", finalState.output);
        // console.log("Full Lifecycle:", finalState);
    });

    // Or get the last emitted value directly
    // const finalState = lifecycleSubject.getValue();
    // console.log("Final Output:", finalState.output);
} catch (error) {
    console.error("Error sending message:", error);
}

// Example using messageWithTools (requires LLM that supports tool calling)
// try {
//     const lifecycleSubjectTools = await daemon.messageWithTools("What's the weather in London?", {
//         llm: { provider: "openai", model: "gpt-4" }, // Ensure model supports tool use
//         // Assuming a 'get_weather' tool is registered via addAllToolsByProvider or addSingleToolFromProvider
//     });

//     lifecycleSubjectTools.subscribe(state => {
//         console.log("Stream/Final Output:", state.output);
//         if (state.actionsLog && state.actionsLog.length > 0) {
//             console.log("Actions Log:", state.actionsLog);
//         }
//     });

// } catch (error) {
//     console.error("Error sending message with tools:", error);
// }
```

## Key Changes from Previous Version (Based on `daemon.ts`)

-   `init()` method seems removed or replaced by constructor initialization and separate `addModelProvider`/`addToolProvider` calls.
-   Explicit `ModelProvider` and `ToolProvider` concepts are central.
-   `addMCPServer` is replaced by `addAllToolsByProvider` and `addSingleToolFromProvider`.
-   Two distinct message methods: `message` (standard LLM call) and `messageWithTools` (LLM call with integrated tool execution).
-   Reliance on RxJS `BehaviorSubject` for managing and returning the message lifecycle state.
-   Uses `nanoid` for IDs and `tweetnacl` for signing.
