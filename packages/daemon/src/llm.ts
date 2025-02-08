import OpenAI from "openai";
import type { IMessageLifecycle, ModelSettings } from "./types";
import Anthropic from "@anthropic-ai/sdk";

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

export async function generateEmbeddings(
  embeddingModelSettings: ModelSettings,
  embeddingModelKey: string,
  message: string
): Promise<number[]> {
  switch (embeddingModelSettings?.provider) {
    case "openai":
      const client = new OpenAI({
        apiKey: embeddingModelKey,
        baseURL: embeddingModelSettings.endpoint,
        dangerouslyAllowBrowser: true,
      });

      const embedding = await client.embeddings.create({
        model: embeddingModelSettings.name,
        input: message,
      });
      return embedding.data[0].embedding;
      break;
    case "anthropic":
      throw new Error("Anthropic embedding not implemented");
      break;
  }
}

export async function generateText(
  generationModelSettings: ModelSettings,
  generationModelKey: string,
  userMessage: string
): Promise<string> {
  switch (generationModelSettings?.provider) {
    case "openai":
      const openai = new OpenAI({
        apiKey: generationModelKey,
        baseURL: generationModelSettings.endpoint,
        dangerouslyAllowBrowser: true,
      });

      const openaiResponse = await openai.chat.completions.create({
        model: generationModelSettings.name,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        temperature: generationModelSettings.temperature,
        max_completion_tokens: generationModelSettings.maxTokens,
      });

      return openaiResponse.choices[0].message.content ?? "";
      break;
    case "anthropic":
      const anthropic = new Anthropic({
        apiKey: generationModelKey,
        baseURL: generationModelSettings.endpoint,
      });

      const anthropicResponse = await anthropic.messages.create({
        model: generationModelSettings.name,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: userMessage,
          },
        ],
        max_tokens: generationModelSettings.maxTokens ?? 1000,
        temperature: generationModelSettings.temperature ?? 0.2,
      });

      return anthropicResponse.content.join("\n");
      break;
  }
}

export function createPrompt(lifecycle: IMessageLifecycle): string {
  return `
  # Name
  ${lifecycle.daemonName}

  # Identity Prompt
  ${lifecycle.identityPrompt}

  # User Message
  ${lifecycle.message}
  
  # Context
  ${lifecycle.context?.join("\n")}

  # Tools
  ${lifecycle.tools?.join("\n")}
  `;
}
