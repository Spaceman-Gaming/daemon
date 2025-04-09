import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "./SSEClientTransport.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { Keypair } from "@solana/web3.js";
import { createPrompt, genText, genTextWithTools } from "./llm.js";
import nacl from "tweetnacl";
import { nanoid } from "nanoid";
import { Buffer } from "buffer";
import type { Character, IHook, IHookLog, IMessageLifecycle, ModelProvider, ToolProvider, IDaemon } from "./types.js";
import { BehaviorSubject } from "rxjs";

const DEFAULT_IDENTITY_PROMPT = (name: string) => {
	return `
You are ${name}. Keep your responses concise and to the point.
  `;
};

export class Daemon implements IDaemon {	
	character: Character;
	keypair: Keypair;
	models: ModelProvider[] = []
	tools: ToolProvider[] = []

	constructor(    
		character: Character,
		keypair: Keypair,
	){
        this.character = character;
        this.keypair = keypair;
    }

	async addModelProvider(provider: ModelProvider): Promise<void> {
		const existingProvider = this.models.find(p => p.provider === provider.provider);
		if (existingProvider) {
			// replace the existing provider
			this.models = this.models.map(p => p.provider === provider.provider ? provider : p);
		} else {
            this.models.push(provider);
        }
	}
	
	async addSingleToolFromProvider(provider: ToolProvider): Promise<void> {
		this.tools.push(provider)
	}

	async addAllToolsByProvider(url: string): Promise<void> {
		const client = new Client({
			name: url,
			version: "1.0.0",
		}, {capabilities: {}})
		
		// Ensure URL ends with /sse
		const sseUrl = url.endsWith('/sse') ? url : `${url}/sse`;
		await client.connect(new SSEClientTransport(new URL(sseUrl)))

		const serverInfo = (await client.callTool({
			name: "getDaemonServerInfo",
			arguments: {},
		})).content as TextContent[];		
		if (serverInfo[0].text.includes("Error")) {
			throw new Error(serverInfo[0].text)
		}
		const toolsList = JSON.parse(serverInfo[0].text) as ToolProvider[]
		await Promise.all(toolsList.map(async (tool) => {
			await this.addSingleToolFromProvider(tool)
		}));
	}

	async callTool(tool: ToolProvider, args: any): Promise<any> {
		const client = new Client({
			name: tool.serverUrl,
			version: "1.0.0",
		}, {capabilities: {}})

		// Ensure URL ends with /sse
		const sseUrl = tool.serverUrl.endsWith('/sse') ? tool.serverUrl : `${tool.serverUrl}/sse`;
		await client.connect(new SSEClientTransport(new URL(sseUrl)))

		// Check that args are valid 
		for(const parameter of tool.parameters) {
			if(parameter.type === "string") {
				if(typeof args[parameter.name] !== "string") {
					throw new Error(`${parameter.name} must be a string`)
				}
			} else if(parameter.type === "number") {
				if(typeof args[parameter.name] !== "number") {
					throw new Error(`${parameter.name} must be a number`)
				}
			} else if(parameter.type === "boolean") {
				if(typeof args[parameter.name] !== "boolean") {
					throw new Error(`${parameter.name} must be a boolean`)
				}
			} else if(parameter.type === "array") {
				if(!Array.isArray(args[parameter.name])) {
					throw new Error(`${parameter.name} must be an array`)
				}
			} else if(parameter.type === "object") {
				if(typeof args[parameter.name] !== "object") {
					throw new Error(`${parameter.name} must be an object`)
				}
			}
		}

		const result = await client.callTool({
			name: tool.toolName,
			arguments: args,
		})

		client.close();
		return result
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
	
	async hook(hook: IHook): Promise<IHookLog> {
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
	
	private generateApproval(message: string, createdAt: string, messageId: string, channelId?: string): string {
		if (!this.keypair) {
			throw new Error("Keypair not found");
		}
		
		const messageBytes = Buffer.from(
			JSON.stringify(
				{
					message: message,
					createdAt: createdAt,
					messageId: messageId,
					channelId: channelId ?? "",
				},
				null,
				0
			),
			"utf-8"
		);
		
		const approval = this.sign({
			payload: messageBytes.toString("base64"),
		});
		
		return approval;
	}

	async message(message: string, opts?: {
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
	}) {
		try {
            if(Object.keys(this.models).length === 0 && !opts?.llm) {
                throw new Error("No model provider added")
            }

            // Pick and LLM based on Opts or first provider / model in the list
            let llm = {};
            const provider:string = opts?.llm?.provider ?? Object.keys(this.models)[0];
            if(!provider) {
                throw new Error("No LLM provider chosen")
            }

            const model:string = opts?.llm?.model ?? this.models.find(p => p.provider === provider)?.models[0] ?? "";
            if(!model) {
                throw new Error("No LLM model chosen")
            }

            const apiKey = opts?.llm?.apiKey ?? this.models.find(p => p.provider === provider)?.apiKey ?? "";
            if(!apiKey) {
                throw new Error("No LLM API key chosen")
            }

            const endpoint = opts?.llm?.endpoint ?? this.models.find(p => p.provider === provider)?.endpoint ?? "";
            if(!endpoint) {
                throw new Error("No LLM endpoint chosen")
            }

            const context = opts?.stages?.context ?? true;
            const actions = opts?.stages?.actions ?? true;
            const postProcess = opts?.stages?.postProcess ?? true;


			const lifecycle = new BehaviorSubject<Partial<IMessageLifecycle>>({});
            
            // message => fetchContext => generateText => takeActions => hooks => callHooks => postProcess
            // Base
            lifecycle.next({
                daemonPubkey: this.keypair.publicKey.toBase58(),
                daemonName: this.character.name,
                messageId: nanoid(),
                message: message,
                createdAt: new Date().toISOString(),
                approval: this.generateApproval(
                    message, new Date().toISOString(), nanoid(), opts?.channelId ?? undefined
                ),
                channelId: opts?.channelId ?? undefined,
                identityPrompt: this.character.identityPrompt ?? DEFAULT_IDENTITY_PROMPT(this.character.name),
                context: [],
                tools: [],
                generatedPrompt: "",
                output: "",
                hooks: [],
                hooksLog: [],
                actionsLog: [],
                postProcessLog: [],
            })

            // fetchContext
            if(context) {
                let contextPromises: Promise<any>[] = [];
                for(const tool of this.tools) {
                    if(tool.type === "context") {
                        contextPromises.push(this.callTool(tool, {
                            lifecycle: lifecycle.value,
                            args: opts?.toolArgs?.[`${tool.serverUrl}-${tool.toolName}`] ?? {},
                        }))
                    }
                }

                const contextResults = await Promise.all(contextPromises);
                lifecycle.next({
                    ...lifecycle.value,
                    context: contextResults,
                })
            }

            // Generate Prompt
            lifecycle.next({
                ...lifecycle.value,
                generatedPrompt: createPrompt(
                    lifecycle.value.daemonName ?? "",
                    lifecycle.value.identityPrompt ?? "",
                    lifecycle.value.message ?? "",
                    lifecycle.value.context ?? [],
                    lifecycle.value.tools ?? []
                ),
            })

            // Generate Text
            lifecycle.next({
                ...lifecycle.value,
                output: await genText(
                    provider,
                    model,
                    endpoint,
                    apiKey,
                    opts?.llm?.systemPrompt ?? "",
                    lifecycle.value.generatedPrompt!,
                )
            }); 

            if(actions) {
                let actionPromises: Promise<any>[] = [];
                for(const tool of this.tools) {
                    if(tool.type === "action") {
                        actionPromises.push(this.callTool(tool, {
                        lifecycle: lifecycle.value,
                        args: opts?.toolArgs?.[`${tool.serverUrl}-${tool.toolName}`] ?? {},
                    }))
                    }
                }

                const actionResults = await Promise.all(actionPromises);
                lifecycle.next({
                    ...lifecycle.value,
                    actionsLog: actionResults,
                })

                let hookPromises: Promise<any>[] = [];
                for(const hook of lifecycle.value.hooks ?? []) {
                    hookPromises.push(this.hook(hook))
                }

                const hookResults = await Promise.all(hookPromises);
                lifecycle.next({
                    ...lifecycle.value,
                    hooksLog: hookResults,
                })
            }

            if(postProcess) {
                let postProcessPromises: Promise<any>[] = [];
                for(const tool of this.tools) {
                    if(tool.type === "postProcess") {
                        postProcessPromises.push(this.callTool(tool, {
                            lifecycle: lifecycle.value,
                            args: opts?.toolArgs?.[`${tool.serverUrl}-${tool.toolName}`] ?? {},
                        }))
                    }
                }

                const postProcessResults = await Promise.all(postProcessPromises);
                lifecycle.next({
                    ...lifecycle.value,
                    postProcessLog: postProcessResults,
                })
            }

            return lifecycle;
        } catch (e: any) {
			throw new Error(`Failed at step: ${e}`)
		}
	}

	async messageWithTools(message: string, opts?: {
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
	}) {
		try {
            if(Object.keys(this.models).length === 0 && !opts?.llm) {
                throw new Error("No model provider added")
            }

            // Pick and LLM based on Opts or first provider / model in the list
            const provider:string = opts?.llm?.provider ?? Object.keys(this.models)[0];
            if(!provider) {
                throw new Error("No LLM provider chosen")
            }

            const model:string = opts?.llm?.model ?? this.models.find(p => p.provider === provider)?.models[0] ?? "";
            if(!model) {
                throw new Error("No LLM model chosen")
            }

            const apiKey = opts?.llm?.apiKey ?? this.models.find(p => p.provider === provider)?.apiKey ?? "";
            if(!apiKey) {
                throw new Error("No LLM API key chosen")
            }

            const endpoint = opts?.llm?.endpoint ?? this.models.find(p => p.provider === provider)?.endpoint ?? "";
            if(!endpoint) {
                throw new Error("No LLM endpoint chosen")
            }

            const context = opts?.stages?.context ?? true;
            const actions = opts?.stages?.actions ?? true;
            const postProcess = opts?.stages?.postProcess ?? true;


			const lifecycle = new BehaviorSubject<Partial<IMessageLifecycle>>({});
            
            // message => fetchContext => generateText => takeActions => hooks => callHooks => postProcess
            // Base
            lifecycle.next({
                daemonPubkey: this.keypair.publicKey.toBase58(),
                daemonName: this.character.name,
                messageId: nanoid(),
                message: message,
                createdAt: new Date().toISOString(),
                approval: this.generateApproval(
                    message, new Date().toISOString(), nanoid(), opts?.channelId ?? undefined
                ),
                channelId: opts?.channelId ?? undefined,
                identityPrompt: this.character.identityPrompt ?? DEFAULT_IDENTITY_PROMPT(this.character.name),
                context: [],
                tools: [],
                generatedPrompt: "",
                output: "",
                hooks: [],
                hooksLog: [],
                actionsLog: [],
                postProcessLog: [],
            })

            // fetchContext
            if(context) {
                let contextPromises: Promise<any>[] = [];
                for(const tool of this.tools) {
                    if(tool.type === "context") {
                        contextPromises.push(this.callTool(tool, {
                            lifecycle: lifecycle.value,
                            args: opts?.toolArgs?.[`${tool.serverUrl}-${tool.toolName}`] ?? {},
                        }))
                    }
                }

                const contextResults = await Promise.all(contextPromises);
                lifecycle.next({
                    ...lifecycle.value,
                    context: contextResults,
                })
            }

            // Generate Prompt
            lifecycle.next({
                ...lifecycle.value,
                generatedPrompt: createPrompt(
                    lifecycle.value.daemonName ?? "",
                    lifecycle.value.identityPrompt ?? "",
                    lifecycle.value.message ?? "",
                    lifecycle.value.context ?? [],
                    lifecycle.value.tools ?? []
                ),
            })

            // Generate Text with Tools
            const outputStream = await genTextWithTools(
                provider,
                model,
                endpoint,
                apiKey,
                opts?.llm?.systemPrompt ?? "",
                lifecycle.value.generatedPrompt!,
                this.tools.filter(t => t.type === "ondemand")
            );

            // Create a promise that will resolve when text generation is complete
            const completionPromise = new Promise<void>((resolve, reject) => {
                // Subscribe to the output stream and update the lifecycle
                outputStream.subscribe({
                    next: (output: string) => {
                        lifecycle.next({
                            ...lifecycle.value,
                            output
                        });
                        // No resolution here, we want to wait for complete
                    },
                    error: (error: any) => {
                        console.error("Error in text generation:", error);
                        reject(error); // Reject the promise on error
                    },
                    complete: async () => {                        
                        // Process actions after generation is complete
                        if(actions) {
                            let actionPromises: Promise<any>[] = [];
                            for(const tool of this.tools) {
                                if(tool.type === "action") {
                                    actionPromises.push(this.callTool(tool, {
                                        lifecycle: lifecycle.value,
                                        args: opts?.toolArgs?.[`${tool.serverUrl}-${tool.toolName}`] ?? {},
                                    }))
                                }
                            }

                            const actionResults = await Promise.all(actionPromises);
                            lifecycle.next({
                                ...lifecycle.value,
                                actionsLog: actionResults,
                            });

                            let hookPromises: Promise<any>[] = [];
                            for(const hook of lifecycle.value.hooks ?? []) {
                                hookPromises.push(this.hook(hook));
                            }

                            const hookResults = await Promise.all(hookPromises);
                            lifecycle.next({
                                ...lifecycle.value,
                                hooksLog: hookResults,
                            });
                        }

                        if(postProcess) {
                            let postProcessPromises: Promise<any>[] = [];
                            for(const tool of this.tools) {
                                if(tool.type === "postProcess") {
                                    postProcessPromises.push(this.callTool(tool, {
                                        lifecycle: lifecycle.value,
                                        args: opts?.toolArgs?.[`${tool.serverUrl}-${tool.toolName}`] ?? {},
                                    }));
                                }
                            }

                            const postProcessResults = await Promise.all(postProcessPromises);
                            lifecycle.next({
                                ...lifecycle.value,
                                postProcessLog: postProcessResults,
                            });
                        }
                        
                        // Finally resolve the promise after all processing is done
                        resolve();
                    }
                });
            });
            
            // Set a timeout to prevent hanging indefinitely
            const timeoutPromise = new Promise<void>((_, reject) => {
                setTimeout(() => {
                    reject(new Error("Generation timeout reached after 30 seconds"));
                }, 30000); // 30 second timeout
            });
            
            try {
                // Wait for either completion or timeout
                await Promise.race([completionPromise, timeoutPromise]);
            } catch (error) {
                console.warn("Warning:", error);
                console.log("Returning lifecycle anyway due to timeout");
            }

            return lifecycle;
        } catch (e: any) {
			throw new Error(`Failed at step: ${e}`)
		}
	}
}
