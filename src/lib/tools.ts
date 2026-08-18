/**
 * tools.ts
 * -----------------------------------------------------------------------------
 * Tool registry + executor for the agentic tool-use loop.
 *
 * The proxy accepts OpenAI-shaped tool definitions in the request. When the
 * model responds with a tool call, we look the tool up here, execute it, and
 * return the result to be fed back to the model.
 *
 * v1 supports a single built-in tool: `bash` (run a shell command with a
 * timeout and output cap). Register more tools by adding to TOOL_REGISTRY.
 * -----------------------------------------------------------------------------
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** How long a single tool call may run before we kill it. */
export const TOOL_TIMEOUT_MS = 30_000;

/** Hard cap on captured output (stdout + stderr) per tool call. */
export const TOOL_MAX_OUTPUT = 1_000_000; // 1 MB

/** Safety valve: max provider round-trips in the tool loop. */
export const MAX_TOOL_ITERATIONS = 10;

/** A tool call emitted by the model, in our internal (OpenAI) representation. */
export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments object (the model sent a JSON string; we parse it). */
  arguments: Record<string, unknown>;
}

/** The result we feed back to the model after executing a tool call. */
export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error?: boolean;
}

/** An OpenAI-function tool definition as it appears in the request `tools` array. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

type ToolHandler = (input: Record<string, unknown>) => Promise<string> | string;

async function bashHandler(input: Record<string, unknown>): Promise<string> {
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command) return "Error: `command` must be a non-empty string.";

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: TOOL_MAX_OUTPUT,
      // Inherit a minimal, predictable env rather than the full process env.
      env: { ...process.env, PATH: process.env.PATH ?? "" },
    });
    const out = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n--- stderr ---\n");
    return out || "(command produced no output)";
  } catch (err: unknown) {
    if (err instanceof Error) {
      // exec rejects on non-zero exit OR timeout. Include any captured output.
      const parts: string[] = [err.message];
      if ((err as NodeJS.ErrnoException).code === "ETIMEDOUT") {
        parts.unshift(`Error: command timed out after ${TOOL_TIMEOUT_MS} ms`);
      }
      return parts.join("\n");
    }
    return `Error: ${String(err)}`;
  }
}

/** Built-in tools. Add entries here to expose new capabilities. */
const TOOL_REGISTRY: Record<string, ToolHandler> = {
  bash: bashHandler,
};

/**
 * Execute a single tool call by name. Unknown tools return an error result
 * instead of throwing, so the model can see the failure and recover.
 */
export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const handler = TOOL_REGISTRY[call.name];
  if (!handler) {
    return {
      tool_call_id: call.id,
      content: `Error: unknown tool '${call.name}'. Available: ${Object.keys(TOOL_REGISTRY).join(", ")}`,
      is_error: true,
    };
  }
  try {
    const content = await handler(call.arguments);
    return { tool_call_id: call.id, content };
  } catch (err: unknown) {
    return {
      tool_call_id: call.id,
      content: `Error executing '${call.name}': ${err instanceof Error ? err.message : String(err)}`,
      is_error: true,
    };
  }
}

/** Names of all registered tools — used to build error messages and logs. */
export function availableTools(): string[] {
  return Object.keys(TOOL_REGISTRY);
}
