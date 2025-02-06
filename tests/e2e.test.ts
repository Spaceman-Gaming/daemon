import {
  Daemon,
  type Character,
  type MultiMessageSchema,
} from "@spacemangaming/daemon";
import { Keypair } from "@solana/web3.js";
import { expect, test } from "bun:test";

test(
  "Should use message templates & handle multiple messages",
  async () => {
    const daemon = new Daemon();

    const identityKp = Keypair.generate();
    const prompt =
      "You are Bob, a helpful assistant who has a knack for building things.";

    await daemon.init(process.env.IDENTITY_SERVER_URL!, {
      character: {
        name: "Bob",
        pubkey: identityKp.publicKey.toBase58(),
        identityPrompt: prompt,
        identityServerUrl: process.env.IDENTITY_SERVER_URL!,
        modelSettings: {
          embedding: {
            provider: "openai",
            name: "text-embedding-3-small",
            endpoint: process.env.OPENAI_ENDPOINT!,
            apiKey: process.env.OPENAI_API_KEY!,
          },
          generation: {
            provider: "openai",
            name: "gpt-4o",
            endpoint: process.env.OPENAI_ENDPOINT!,
            apiKey: process.env.OPENAI_API_KEY!,
          },
        },
        bootstrap: [],
      } as Character,
      privateKey: identityKp,
      modelApiKeys: {
        generationKey: process.env.OPENAI_API_KEY!,
        embeddingKey: process.env.OPENAI_API_KEY!,
      },
    });

    const lifecycle = await daemon.message("Hello!", {
      context: true,
      actions: true,
      postProcess: false,
      customSystemPrompt:
        "As Bob The Builder, guide the user through a conversation.",
      customMessageTemplate: `
        {{message}}
        `,
    });

    expect(lifecycle).toBeDefined();

    console.log("Message:", lifecycle.message);
    console.log("Output:", lifecycle.output);
    console.log("Generated Prompts:", lifecycle.generatedPrompt);

    const historyWithNewMessage: MultiMessageSchema[] = [
      {
        role: "user",
        content: lifecycle.message as string,
      },
      {
        role: "assistant",
        content: lifecycle.output,
      },
      {
        role: "user",
        content: "Awesome!",
      },
    ];

    console.log("History with new message:", historyWithNewMessage);

    const lifecycleWithMultiple = await daemon.multipleMessages(
      historyWithNewMessage,
      {
        context: true,
        actions: true,
        postProcess: false,
        customSystemPrompt:
          "As Bob The Builder, guide the user through a conversation.",
        customMessageTemplate: `
        {{message}}
        `,
      }
    );

    expect(lifecycleWithMultiple).toBeDefined();

    const generatedPrompts = lifecycleWithMultiple.generatedPrompt as string[];

    console.log("Messages:", lifecycleWithMultiple.message);
    console.log("Output:", lifecycleWithMultiple.output);
    console.log("Generated Prompts:", generatedPrompts);
  },
  { timeout: 60000 }
);
