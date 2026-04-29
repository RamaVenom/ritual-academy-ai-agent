require("dotenv").config();

const readline = require("readline");
const Groq = require("groq-sdk");

const { toolDefinitions } = require("./tools/definitions");
const { executeTool } = require("./tools/handlers");
const { logger } = require("./utils/logger");

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "4096", 10);
const MAX_TOOL_ITERATIONS = 10;
const MAX_TOOL_USE_RETRIES = 2;

const SYSTEM_PROMPT = `You are a helpful, capable AI assistant with access to a set of tools.

Guidelines:
- When a user asks for something a tool can help with, USE THE TOOL rather than guessing.
- Chain multiple tool calls when needed to complete a task.
- After getting tool results, summarize them clearly for the user in plain language.
- Use the memory tools to persist user preferences and facts across the conversation.
- For math, always use the calculator tool. For current dates/times, always use the datetime tool.
- Be concise. Don't over-explain.`;

function ensureApiKey() {
  if (!process.env.GROQ_API_KEY) {
    logger.error(
      "GROQ_API_KEY is not set. Add it to ai-agent/.env or export it in your shell.",
    );
    process.exit(1);
  }
}

function parseToolArgs(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === "object") return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch {
    throw new Error(`Tool arguments are not valid JSON: ${rawArgs}`);
  }
}

async function runToolCall(toolCall, log) {
  const name = toolCall.function.name;
  let input;
  try {
    input = parseToolArgs(toolCall.function.arguments);
  } catch (err) {
    log.toolResult(name, `ERROR: ${err.message}`);
    return {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: err.message }),
    };
  }

  log.tool(name, input);
  try {
    const result = await executeTool(name, input);
    log.toolResult(name, result);
    return {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(result),
    };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    log.toolResult(name, `ERROR: ${message}`);
    return {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: message }),
    };
  }
}

function extractToolUseFailure(err) {
  const status = err && err.status;
  if (status !== 400) return null;
  const body = (err && (err.error || err.response?.data)) || {};
  const inner = body.error || body;
  if (inner && inner.code === "tool_use_failed") {
    return {
      message: inner.message || "Malformed tool call",
      failedGeneration: inner.failed_generation || "",
    };
  }
  return null;
}

const KNOWN_TOOL_NAMES = new Set(toolDefinitions.map((t) => t.function.name));

function findBalancedJsonObjects(text) {
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        depth = 0;
      }
    }
  }
  return results;
}

function normalizeArgs(args) {
  if (!args || typeof args !== "object") return {};
  // Llama sometimes wraps actual args under "parameters" alongside a "function"/"name"/"type" sibling key.
  if (
    "parameters" in args &&
    ("function" in args || "name" in args || "type" in args)
  ) {
    return args.parameters || {};
  }
  return args;
}

function makeRecoveredCall(name, args, index) {
  return {
    id: `recovered_${index}_${Date.now()}`,
    type: "function",
    function: { name, arguments: JSON.stringify(normalizeArgs(args)) },
  };
}

function parseMalformedToolCalls(text) {
  if (!text || typeof text !== "string") return [];
  const calls = [];
  const seen = new Set();

  // Strategy 1: scan all balanced JSON blobs for {name|function, parameters|arguments|input}
  for (const blob of findBalancedJsonObjects(text)) {
    let obj;
    try {
      obj = JSON.parse(blob);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const name = obj.name || obj.function || (obj.type === "function" ? obj.name : null);
    const args = obj.parameters || obj.arguments || obj.input || {};
    if (typeof name !== "string" || !KNOWN_TOOL_NAMES.has(name)) continue;
    const key = `${name}:${JSON.stringify(args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push(makeRecoveredCall(name, args, calls.length));
  }

  // Strategy 2: scan <function=NAME...> XML-ish wrappers and pull the first JSON inside
  const xmlRegex = /<function=([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m;
  while ((m = xmlRegex.exec(text)) !== null) {
    const name = m[1];
    if (!KNOWN_TOOL_NAMES.has(name)) continue;
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 4000);
    const jsonBlobs = findBalancedJsonObjects(tail);
    let args = {};
    if (jsonBlobs.length > 0) {
      try {
        args = JSON.parse(jsonBlobs[0]);
      } catch {
        args = {};
      }
    }
    const key = `${name}:${JSON.stringify(normalizeArgs(args))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push(makeRecoveredCall(name, args, calls.length));
  }

  return calls;
}

async function callGroq(client, messages) {
  return await client.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages,
    tools: toolDefinitions,
    tool_choice: "auto",
  });
}

async function callGroqWithRecovery(client, conversation, log) {
  let retries = 0;
  while (true) {
    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...conversation];
    try {
      return { response: await callGroq(client, messages) };
    } catch (err) {
      const failure = extractToolUseFailure(err);
      if (!failure) throw err;

      const recovered = parseMalformedToolCalls(failure.failedGeneration);
      if (recovered.length > 0) {
        log.warn(
          `Recovered ${recovered.length} malformed tool call(s) from model output`,
          recovered.map((c) => c.function.name).join(", "),
        );
        return { synthesizedToolCalls: recovered };
      }

      if (retries >= MAX_TOOL_USE_RETRIES) throw err;
      retries++;
      log.warn(
        `Model emitted malformed tool call, retrying (${retries}/${MAX_TOOL_USE_RETRIES})`,
        failure.failedGeneration ? failure.failedGeneration.slice(0, 200) : failure.message,
      );
      conversation.push({
        role: "system",
        content:
          "Your previous response contained a malformed tool call and was rejected. " +
          "Do NOT embed function names or wrap arguments in custom XML/HTML-like syntax such as <function=...>. " +
          "Use the standard tool_calls field with a plain JSON object for `arguments` matching the tool's schema. " +
          "If you need to call multiple tools, emit each one as a separate entry in tool_calls. " +
          "Try again now.",
      });
    }
  }
}

async function chat(client, conversation, log) {
  let iterations = 0;
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    log.debug(`Calling Groq (iteration ${iterations})`);

    const { response, synthesizedToolCalls } = await callGroqWithRecovery(client, conversation, log);

    let toolCalls;
    if (synthesizedToolCalls) {
      toolCalls = synthesizedToolCalls;
      conversation.push({ role: "assistant", content: null, tool_calls: toolCalls });
    } else {
      const message = response.choices[0].message;
      if (message.tool_calls && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls;
        conversation.push({
          role: "assistant",
          content: message.content || null,
          tool_calls: message.tool_calls,
        });
      } else {
        // No formal tool_calls — but check if the model embedded tool calls in the text content.
        const recovered = parseMalformedToolCalls(message.content || "");
        if (recovered.length > 0) {
          log.warn(
            `Recovered ${recovered.length} tool call(s) from text response`,
            recovered.map((c) => c.function.name).join(", "),
          );
          toolCalls = recovered;
          conversation.push({ role: "assistant", content: null, tool_calls: recovered });
        } else {
          conversation.push({ role: "assistant", content: message.content || null });
          return (message.content || "").trim() || "(no response)";
        }
      }
    }

    for (const toolCall of toolCalls) {
      const result = await runToolCall(toolCall, log);
      conversation.push(result);
    }
  }
  return "(stopped: tool-call iteration limit reached)";
}

function prompt(rl, question) {
  return new Promise((resolve, reject) => {
    rl.question(question, (answer) => resolve(answer));
    rl.once("close", () => reject(new Error("readline closed")));
  });
}

async function main() {
  ensureApiKey();

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const log = logger;

  log.banner(`AI Agent ready (model: ${MODEL})`);
  log.info(`Loaded ${toolDefinitions.length} tools: ${toolDefinitions.map((t) => t.function.name).join(", ")}`);
  console.log("Type your message and press Enter. Commands: /reset, /tools, /exit\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  let conversation = [];

  while (!closed) {
    let userInput;
    try {
      userInput = (await prompt(rl, "> ")).trim();
    } catch {
      break;
    }
    if (closed) break;
    if (!userInput) continue;

    if (userInput === "/exit" || userInput === "/quit") {
      log.info("Goodbye.");
      rl.close();
      return;
    }
    if (userInput === "/reset") {
      conversation = [];
      log.info("Conversation history cleared.");
      continue;
    }
    if (userInput === "/tools") {
      console.log("\nAvailable tools:");
      for (const t of toolDefinitions) {
        console.log(`  - ${t.function.name}: ${t.function.description.split(".")[0]}.`);
      }
      console.log();
      continue;
    }

    conversation.push({ role: "user", content: userInput });

    try {
      const reply = await chat(client, conversation, log);
      log.assistant(reply);
    } catch (err) {
      log.error("Chat failed", err && err.message ? err.message : err);
      conversation.pop();
    }
  }
}

main().catch((err) => {
  logger.error("Fatal error", err && err.stack ? err.stack : err);
  process.exit(1);
});
