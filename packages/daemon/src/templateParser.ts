import type { IMessageLifecycle } from "./types";

const MESSAGE_ALLOWED_VARIABLES = [
  "name",
  "identity",
  "message",
  "context",
  "tools",
] as const;

type TemplateData = {
  lifecycle: IMessageLifecycle;
  message: { role: "user" | "assistant"; content: string };
};

type MessageAllowedVariable = (typeof MESSAGE_ALLOWED_VARIABLES)[number];

function validateTemplate(template: string): string[] {
  const variablePattern = /\{\{(\w+)\}\}/g;
  const matches = Array.from(template.matchAll(variablePattern));
  const usedVars = matches.map((match) => match[1]);

  const invalidVars = usedVars.filter(
    (v) => !MESSAGE_ALLOWED_VARIABLES.includes(v as MessageAllowedVariable)
  );

  return invalidVars;
}

export function parseTemplate(
  data: TemplateData,
  template: string
): { role: "user" | "assistant"; content: string } {
  const invalidVars = validateTemplate(template);
  if (invalidVars.length > 0) {
    throw new Error(
      `Template contains invalid variables: ${invalidVars.join(", ")}`
    );
  }

  const variableMap = {
    name: data.lifecycle.daemonName,
    identity: data.lifecycle.identityPrompt,
    message: data.message.content,
    context: data.lifecycle.context?.join("\n") ?? "",
    tools: data.lifecycle.tools?.join("\n") ?? "",
  };

  return {
    role: data.message.role,
    content: template.replace(
      /\{\{(\w+)\}\}/g,
      (_, variable: MessageAllowedVariable) => {
        if (MESSAGE_ALLOWED_VARIABLES.includes(variable)) {
          return variableMap[variable] as string;
        }
        return `{{${variable}}}`;
      }
    ),
  };
}
