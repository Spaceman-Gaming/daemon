import OpenAI from "openai";
import { z } from "zod";
import { streamText, tool} from 'ai';
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type{ ToolProvider } from "./types";
import { Observable } from "rxjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "./SSEClientTransport";

export const SYSTEM_PROMPT = `
You are an AI agent operating within a framework that provides you with:
- An identity (who you are and your core traits)
- Context (memories and relevant information)
- Tools (capabilities you can use)

# Core Principles
1. Maintain consistent personality and behavior aligned with your identity
2. Use provided context to inform your responses
3. Consider past interactions when making decisions
4. Use available tools appropriately to accomplish tasks

# Input Structure
Each interaction will provide:
- Identity Prompt: Your specific role and personality
- Message: The user's current request/message
- Context: Relevant memories and information

# Response Protocol
1. First, process your identity and maintain that persona
2. Review provided context and incorporate relevant information
3. Analyze the user's message
4. Formulate a response that:
   - Stays true to your defined identity
   - Incorporates relevant context naturally
   - Uses appropriate tools when needed
   - Maintains conversation history coherence
   - Keep your responses concise
   
It's *very* important that if you do not know something, then you don't make something up.

# Memory Usage Guidelines
- Reference provided memories naturally, as a person would recall information
- Don't explicitly mention that you're using RAG or accessing memories
- Integrate past knowledge smoothly into conversations

# Tool Usage Guidelines
- Use tools when they would genuinely help accomplish the task
- Maintain in-character behavior while using tools
- Only use tools that have been explicitly provided

Remember: You are not just processing queries - you are embodying a specific identity with consistent traits, memories, and capabilities.
`;

export async function genTextWithTools(
    providerName: string,
    modelId: string,
    endpoint: string,
    apiKey: string,
    systemPrompt: string,
    prompt: string,
    tools: ToolProvider[],
    maxSteps: number = 10
): Promise<Observable<string>> {
    try {
        switch(providerName) {
            case "openai":
            case "openrouter":
                const provider = createOpenAICompatible({
                    baseURL: endpoint,
                    apiKey: apiKey,
                    name: providerName,
                });
                const model = provider(modelId)

                const toolSet = tools.map((t) => {
                    let parameters: any = {};
                    for(const parameter of t.parameters) {
                        switch(parameter.type) {
                            case "string":
                                parameters[parameter.name] = z.string().describe(parameter.description);
                                break;
                            case "number":
                                parameters[parameter.name] = z.number().describe(parameter.description);
                                break;
                            case "boolean":
                                parameters[parameter.name] = z.boolean().describe(parameter.description);
                                break;
                            case "array":
                                parameters[parameter.name] = z.array(z.any()).describe(parameter.description);
                                break;
                            case "object":
                                parameters[parameter.name] = z.any().describe(parameter.description);
                                break;
                        }
                    }
                    return {
                        name: t.toolName,
                        tool: tool({
                            description: t.description,
                            parameters: z.object(parameters),
                            execute: async (parameters: any) => {
                                const client = new Client({
                                    name: t.serverUrl,
                                    version: "1.0.0",
                                }, {capabilities: {}})
                                // Ensure URL ends with /sse
                                const sseUrl = t.serverUrl.endsWith('/sse') ? t.serverUrl : `${t.serverUrl}/sse`;
                                await client.connect(new SSEClientTransport(new URL(sseUrl)))

                                const result = await client.callTool({
                                    name: t.toolName,
                                    arguments: parameters,
                                })
                                client.close();
                                if (Array.isArray(result.content) && result.content.length > 0 && typeof result.content[0].text === 'string') {
                                    return result.content[0].text;
                                } else {
                                    throw new Error("Unexpected result format");
                                }
                            }
                        }),
                    }
                })
                
                let tSet: any = {};
                for(const tool of toolSet) {
                    tSet[tool.name] = tool.tool;
                }

                const result = streamText({
                    model,
                    prompt,
                    system: systemPrompt === "" ? SYSTEM_PROMPT : systemPrompt,
                    tools: tSet,
                    maxSteps: maxSteps,
                });

                let output = "";
                return new Observable<string>(observer => {
                    const streamHandler = async () => {
                        try {
                            for await (const chunk of result.textStream) {
                                output += chunk;
                                observer.next(output);
                            }
                            observer.complete();
                        } catch (error) {
                            observer.error(error);
                        }
                    };
                    
                    streamHandler();
                });
                
            default:
                throw new Error(`Unsupported provider: ${providerName}`)
        }
    } catch(e: any) {
        throw new Error(`Error generating text: ${e}`)
    }
}


export async function genText(
    provider: string,
    model: string,
    endpoint: string,
    apiKey: string,
    systemPrompt: string,
    prompt: string,
): Promise<string> {
    try {
        switch(provider) {
            case "openai":
            case "openrouter":
                const llm = new OpenAI({
                    apiKey: apiKey,
                    baseURL: endpoint,
                    dangerouslyAllowBrowser: true,
                });
    
                const response = await llm.chat.completions.create({
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt === "" ? SYSTEM_PROMPT : systemPrompt,
                        },
                        {
                            role: "user",
                            content: prompt,
                        }
                    ],
                    temperature: 0.2,
                    max_completion_tokens: 1000,
                })
    
                return response.choices[0].message.content ?? "";
            default:
                throw new Error(`Unsupported provider: ${provider}`)
        }
    } catch(e: any) {
        throw new Error(`Error generating text: ${e}`)
    }
}

export function createPrompt(
    daemonName: string,
    identityPrompt: string,
    message: string,
    context: string[],
    tools: string[]
): string {
  return `
  # Name
  ${daemonName}

  # Identity Prompt
  ${identityPrompt}

  # User Message
  ${message}
  
  # Context
  ${context?.join("\n")}

  # Tools
  ${tools?.join("\n")}
  `;
}
