import {
  type Character,
  type IDaemon,
  type ToolRegistration,
  type ITool,
  type IMessageLifecycle,
  type IHook,
  type IHookLog,
  type ModelSettings,
} from "./types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "./SSEClientTransport.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { Keypair } from "@solana/web3.js";
import { createPrompt, generateText } from "./llm.js";
import nacl from "tweetnacl";
import { nanoid } from "nanoid";
import { Buffer } from "buffer";

const DEFAULT_IDENTITY_PROMPT = (daemon: IDaemon) => {
  return `
  You are ${daemon.character?.name}. Keep your responses concise and to the point.
  `;
};

export class Daemon implements IDaemon {
  character: Character | undefined;
  keypair: Keypair | undefined;
  modelApiKeys: {
    generationKey: string | undefined;
  } = {
    generationKey: undefined,
  };

  mcpClients: {
    [url: string]: {
      name: string;
      description: string;
      client: Client;
    };
  } = {};

  tools: {
    server: ToolRegistration[];
    context: ToolRegistration[];
    action: ToolRegistration[];
    postProcess: ToolRegistration[];
  } = {
    server: [],
    context: [],
    action: [],
    postProcess: [],
  };

  constructor() {}

  async init(
    identityServerUrl: string,
    opts: {
      character?: Character;
      privateKey: Keypair;
      modelApiKeys: {
        generationKey: string;
        embeddingKey?: string;
      };
    }
  ) {
    this.modelApiKeys = {
      generationKey: opts.modelApiKeys.generationKey,
    };

    this.keypair = opts.privateKey;

    await this.addMCPServer({ url: identityServerUrl });

    if (opts.character) {
      if (opts.character?.pubkey !== opts.privateKey.publicKey.toBase58()) {
        throw new Error("Private key does not match character pubkey");
      }
    }
    if (!opts.character) {
      // If id, then fetch character from Context Server
      try {
        const result = await this.callTool(
          "fetchCharacter",
          identityServerUrl,
          {
            pubkey: this.keypair.publicKey.toBase58(),
          }
        );

        this.character = result as Character;
      } catch (e) {
        throw new Error(`Failed to fetch character: ${e}`);
      }
    } else if (opts.character) {
      // If character, then register character in Context Server
      try {
        const result = await this.callTool(
          "registerCharacter",
          identityServerUrl,
          opts.character
        );

        this.character = opts.character;
      } catch (e) {
        throw new Error(`Failed to register character: ${e}`);
      }
    } else {
      throw new Error("No character or id provided");
    }

    // Bootstrap
    for (const bootstrap of this.character?.bootstrap ?? []) {
      await this.addMCPServer({ url: bootstrap.serverUrl });
      for (const tool of bootstrap.tools) {
        await this.callTool(tool.toolName, bootstrap.serverUrl, tool.args);
      }
    }
  }

  async addMCPServer(opts: { url: string }) {
    const client = new Client(
      {
        name: opts.url,
        version: "1.0.0",
      },
      { capabilities: {} }
    );

    await client.connect(new SSEClientTransport(new URL(opts.url)));

    // Server Info
    const serverInfoResult = (
      await client.callTool({ name: "getServerInfo", arguments: {} })
    ).content as TextContent[];

    if (serverInfoResult[0].text.includes("Error")) {
      throw new Error(serverInfoResult[0].text);
    }

    const serverInfo = JSON.parse(serverInfoResult[0].text) as {
      name: string;
      description: string;
    };

    // Server Tools
    const serverTools = (
      await client.callTool({ name: "listServerTools", arguments: {} })
    ).content as TextContent[];

    if (serverTools[0].text.includes("Error")) {
      throw new Error(serverTools[0].text);
    }

    const serverToolList = JSON.parse(serverTools[0].text) as ITool[];

    // Context Tools
    const contextTools = (
      await client.callTool({ name: "listContextTools", arguments: {} })
    ).content as TextContent[];

    const contextToolList = JSON.parse(contextTools[0].text) as ITool[];

    // Action Tools
    const actionTools = (
      await client.callTool({ name: "listActionTools", arguments: {} })
    ).content as TextContent[];
    const actionToolList = JSON.parse(actionTools[0].text) as ITool[];

    // Post Process Tools
    const postProcessTools = (
      await client.callTool({
        name: "listPostProcessTools",
        arguments: {},
      })
    ).content as TextContent[];
    const postProcessToolList = JSON.parse(postProcessTools[0].text) as ITool[];

    this.mcpClients[opts.url] = {
      name: serverInfo.name,
      description: serverInfo.description,
      client,
    };

    this.tools.server.push(
      ...serverToolList.map((serverTool) => {
        return {
          serverUrl: opts.url,
          tool: serverTool,
        };
      })
    );
    this.tools.server.sort((a, b) => a.tool.zIndex - b.tool.zIndex);

    this.tools.context.push(
      ...contextToolList.map((contextTool) => {
        return {
          serverUrl: opts.url,
          tool: contextTool,
        };
      })
    );
    this.tools.context.sort((a, b) => a.tool.zIndex - b.tool.zIndex);

    this.tools.action.push(
      ...actionToolList.map((actionTool) => {
        return {
          serverUrl: opts.url,
          tool: actionTool,
        };
      })
    );
    this.tools.action.sort((a, b) => a.tool.zIndex - b.tool.zIndex);

    this.tools.postProcess.push(
      ...postProcessToolList.map((postProcessTool) => {
        return {
          serverUrl: opts.url,
          tool: postProcessTool,
        };
      })
    );
    this.tools.postProcess.sort((a, b) => a.tool.zIndex - b.tool.zIndex);
  }

  async removeMCPServer(opts: { url: string }): Promise<void> {
    delete this.mcpClients[opts.url];
    this.tools.server = this.tools.server.filter(
      (tool) => tool.serverUrl !== opts.url
    );
    this.tools.context = this.tools.context.filter(
      (tool) => tool.serverUrl !== opts.url
    );
    this.tools.action = this.tools.action.filter(
      (tool) => tool.serverUrl !== opts.url
    );
    this.tools.postProcess = this.tools.postProcess.filter(
      (tool) => tool.serverUrl !== opts.url
    );
  }

  private async callTool(
    toolName: string,
    toolURL: string,
    args: any,
    opts?: { timeout?: number; retries?: number }
  ): Promise<any> {
    let retryCount = 0;
    try {
      const client = this.mcpClients[toolURL].client;

      const result = (
        await client.callTool(
          {
            name: toolName,
            arguments: args,
          },
          undefined,
          { timeout: opts?.timeout ?? 15000 }
        )
      ).content as TextContent[];

      if (result[0].text.includes("Error")) {
        return result[0].text;
      } else {
        return JSON.parse(result[0].text);
      }
    } catch (e) {
      if (opts?.retries && opts.retries > 0) {
        retryCount++;
        return this.callTool(toolName, toolURL, args, {
          ...opts,
          retries: opts.retries - retryCount,
        });
      }
      console.error("Failed to call tool: " + `[${toolName}:${toolURL}]`);
    }
  }

  async message(
    message: string,
    opts?: {
      channelId?: string;
      context?: boolean;
      actions?: boolean;
      postProcess?: boolean;
      toolArgs?: {
        [key: string]: any; // key = `serverUrl-toolName`
      };
      modelOverride?: ModelSettings;
      // Set a timeout for each tool call (in milliseconds)
      timeout?: number;
      // Set a number of retries for each tool call
      retries?: number;
    }
  ): Promise<IMessageLifecycle> {
    if (!this.keypair) {
      throw new Error("Keypair not found");
    }

    if (!this.character) {
      throw new Error("Character not found");
    }

    if (!this.modelApiKeys.generationKey) {
      throw new Error("Model API key not found");
    }

    const context = opts?.context ?? true;
    const actions = opts?.actions ?? true;
    const postProcess = opts?.postProcess ?? true;

    // Lifecycle: message -> fetchContext -> generateText -> takeActions -> hooks -> callHooks -> postProcess
    let lifecycle: IMessageLifecycle = {
      daemonPubkey: this.keypair.publicKey.toBase58(),
      daemonName: this.character?.name ?? "",
      messageId: nanoid(),
      message: message,
      createdAt: new Date().toISOString(),
      approval: "",
      channelId: opts?.channelId ?? null,
      identityPrompt:
        this.character?.identityPrompt ?? DEFAULT_IDENTITY_PROMPT(this),
      context: [],
      tools: [],
      generatedPrompt: "",
      output: "",
      hooks: [],
      hooksLog: [],
      actionsLog: [],
      postProcessLog: [],
    };

    // Generate Approval
    lifecycle = this.generateApproval(lifecycle);

    if (context) {
      let contextPromises: Promise<IMessageLifecycle>[] = [];
      for (const tool of this.tools.context) {
        const toolArgs =
          opts?.toolArgs?.[`${tool.serverUrl}-${tool.tool.name}`];
        contextPromises.push(
          this.callTool(tool.tool.name, tool.serverUrl, {
            lifecycle,
            args: toolArgs,
            opts: {
              timeout: opts?.timeout ?? 15000,
              retries: opts?.retries ?? 3,
            },
          })
        );
      }

      const contextResults = await Promise.all(contextPromises);
      lifecycle.context = contextResults
        .map((lfcyl) => {
          return lfcyl.context;
        })
        .flat();
      lifecycle.tools = contextResults
        .map((lfcyl) => {
          return lfcyl.tools;
        })
        .flat();
    }

    const modelSettings =
      opts?.modelOverride ?? this.character.modelSettings.generation;
    if (!modelSettings.apiKey) {
      modelSettings.apiKey = this.modelApiKeys.generationKey;
    }

    // Generate Text
    lifecycle.generatedPrompt = createPrompt(lifecycle);
    lifecycle.output = await generateText(
      opts?.modelOverride ?? this.character.modelSettings.generation,
      this.modelApiKeys.generationKey,
      lifecycle.generatedPrompt
    );

    if (actions) {
      let actionPromises: Promise<IMessageLifecycle>[] = [];
      for (const tool of this.tools.action) {
        const toolArgs =
          opts?.toolArgs?.[`${tool.serverUrl}-${tool.tool.name}`];
        actionPromises.push(
          this.callTool(tool.tool.name, tool.serverUrl, {
            lifecycle,
            args: toolArgs,
            opts: {
              timeout: opts?.timeout ?? 15000,
              retries: opts?.retries ?? 3,
            },
          })
        );
      }

      const actionResults = await Promise.all(actionPromises);
      lifecycle.actionsLog = actionResults
        .map((lfcyl) => {
          return lfcyl.actionsLog;
        })
        .flat();
      lifecycle.hooks = actionResults
        .map((lfcyl) => {
          return lfcyl.hooks;
        })
        .flat();

      let hookPromises: Promise<any>[] = [];
      for (const hook of lifecycle.hooks) {
        hookPromises.push(this.hook(hook));
      }

      const hookResults = await Promise.all(hookPromises);
      lifecycle.hooksLog = hookResults
        .map((hookResult) => {
          return hookResult;
        })
        .flat();
    }

    if (postProcess) {
      let postProcessPromises: Promise<IMessageLifecycle>[] = [];
      for (const tool of this.tools.postProcess) {
        const toolArgs =
          opts?.toolArgs?.[`${tool.serverUrl}-${tool.tool.name}`];
        postProcessPromises.push(
          this.callTool(tool.tool.name, tool.serverUrl, {
            lifecycle,
            args: toolArgs,
            opts: {
              timeout: opts?.timeout ?? 15000,
              retries: opts?.retries ?? 3,
            },
          })
        );
      }

      const postProcessResults = await Promise.all(postProcessPromises);
      lifecycle.postProcessLog = postProcessResults
        .map((lfcyl) => {
          return lfcyl.postProcessLog;
        })
        .flat();
    }

    return lifecycle;
  }

  // Payload is b64 String
  sign(args: { payload: string }): string {
    if (!this.keypair) {
      throw new Error("Keypair not found");
    }

    const messageBytes = Uint8Array.from(Buffer.from(args.payload, "base64"));
    const signature = nacl.sign.detached(messageBytes, this.keypair.secretKey);
    return Buffer.from(signature).toString("base64");
  }

  private async hook(hook: IHook): Promise<IHookLog> {
    try {
      // Call the internal tool
      switch (hook.daemonTool) {
        case "sign":
          hook.hookOutput = this.sign(hook.daemonArgs);
          break;
      }
      // Create a client for the temp server
      const client = new Client(
        {
          name: hook.hookTool.hookServerUrl,
          version: "1.0.0",
        },
        { capabilities: {} }
      );
      // Call the tool
      const result = await client.callTool({
        name: hook.hookTool.toolName,
        arguments: {
          ...hook.hookTool.toolArgs,
          daemonOutput: hook.hookOutput,
        },
      });
      // Add result of tool to lifecycle by returning it;
      return result;
    } catch (e) {
      throw e;
    }
  }

  private generateApproval(lifecycle: IMessageLifecycle): IMessageLifecycle {
    if (!this.keypair) {
      throw new Error("Keypair not found");
    }

    const messageBytes = Buffer.from(
      JSON.stringify(
        {
          message: lifecycle.message,
          createdAt: lifecycle.createdAt,
          messageId: lifecycle.messageId,
          channelId: lifecycle.channelId ?? "",
        },
        null,
        0
      ),
      "utf-8"
    );

    lifecycle.approval = this.sign({
      payload: messageBytes.toString("base64"),
    });

    return lifecycle;
  }
}
