import type { Keypair } from "@solana/web3.js";
import type { BehaviorSubject } from "rxjs";
import { z } from "zod";

export type ModelProvider =  {
    provider: string;
    endpoint: string;
    models: string[];
    apiKey: string;
}

export type ToolProvider = {
    serverUrl: string;
    tool: string;
    type: "utility" | "context" | "action" | "postProcess";
}

export const ZCharacter = z.object({
    name: z.string(),
    pubkey: z.string(),
    identityPrompt: z.string().optional()
});

export type Character = z.infer<typeof ZCharacter>;

export const ZHook = z.object({
    originServerUrl: z.string(),
    daemonTool: z.enum(["sign"]),
    daemonArgs: z.any(),
    hookTool: z.object({
        // If hook server IS NOT indexed, we will NOT add it, just use it temporarily
        hookServerUrl: z.string(), // The server we will submit the hook to
        toolName: z.string(), // The tool of the server we will submit the hook to
        toolArgs: z.any(), // The args for the tool
    }),
    hookOutput: z.any().optional(), // The output of the hook
});

export type IHook = z.infer<typeof ZHook>;
export type IHookLog = any;

export const ZMessageLifecycle = z.object({
    daemonPubkey: z.string(),
    message: z.string(),
    messageId: z.string(),
    createdAt: z.string(),
    approval: z.string(),
    channelId: z.string().nullable(),
    daemonName: z.string().default(""),
    identityPrompt: z.string().nullable(),
    context: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    generatedPrompt: z.string().default(""),
    output: z.string().default(""),
    hooks: z.array(ZHook).default([]),
    hooksLog: z.array(z.string()).default([]),
    actionsLog: z.array(z.string()).default([]),
    postProcessLog: z.array(z.string()).default([]),
});

export type IMessageLifecycle = z.infer<typeof ZMessageLifecycle>;

export interface IDaemon {
    character: Character | undefined;
    keypair: Keypair | undefined;
    models: ModelProvider[];
    tools: ToolProvider[];

    addModelProvider(provider: ModelProvider): Promise<void>;
    addSingleToolFromProvider(provider: ToolProvider): Promise<void>;
    addAllToolsByProvider(url: string): Promise<void>;
    callTool(tool: ToolProvider, args: any): Promise<any>;
    sign(args: { payload: string }): string;
    hook(hook: IHook): Promise<IHookLog>;
    message(message: string, opts?: {
        channelId?: string;
        stages?: {
            context?: boolean;
            actions?: boolean;
            postProcess?: boolean;  
        },
        toolArgs?: {
            [key: string]: any; // key = `serverUrl-toolName`
        },
        llm?: {
            provider: string;   
            model: string;
            endpoint?: string;
            apiKey?: string;
            systemPrompt?: string;
        }
    }): Promise<BehaviorSubject<Partial<IMessageLifecycle>>>;
}