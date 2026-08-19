/**
 * tools.ts
 * -----------------------------------------------------------------------------
 * Tool-use types for the proxy.
 *
 * The proxy is transparent about tool use: when a model requests a tool call,
 * the proxy forwards the tool call to the client (opencode, the OpenAI SDK, …)
 * and lets the client execute it. The client then sends the result back as a
 * `role: tool` message. The proxy itself never executes tools.
 *
 * These types describe the OpenAI-function tool shape the request `tools`
 * array accepts, and the tool-call / tool-result shapes used when a client
 * passes a conversation history that includes prior tool use back in.
 * -----------------------------------------------------------------------------
 */

/** An OpenAI-function tool definition as it appears in the request `tools` array. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** A tool call as the model emits it, in our internal (OpenAI) representation. */
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
