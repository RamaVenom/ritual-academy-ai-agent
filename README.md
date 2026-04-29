# ai-agent

A small, hackable Node.js AI agent built on the **Groq API** with tool-calling support.
It runs as an interactive REPL and gives the model 10 useful tools — math, time, files,
the web, the weather, a JS sandbox, and persistent memory.

## Features

- Powered by Groq's `llama-3.3-70b-versatile` model (configurable)
- 10 ready-to-use tools out of the box
- Robust **auto-recovery** when the model emits malformed tool calls
  (a known quirk of Llama models on Groq) — both XML-style `<function=...>` wrappers
  and embedded JSON in plain-text responses are parsed and executed automatically
- Workspace-restricted file I/O for safety
- Sandboxed JavaScript execution via Node's `vm` module
- Simple persistent memory in a local JSON file
- Colorized leveled logging

## Tools

| Name             | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `calculator`     | Evaluate math expressions (sqrt, pow, sin, cos, log, PI, E, …)       |
| `datetime`       | Current date/time with timezone (`Asia/Tokyo`, `UTC`, …) and format  |
| `read_file`      | Read a text file (workspace-restricted)                              |
| `write_file`     | Write or append a text file (workspace-restricted)                   |
| `list_directory` | List entries in a directory with type and size                       |
| `web_search`     | Search the web via DuckDuckGo's instant-answer API                   |
| `run_javascript` | Execute a JS snippet in a sandboxed VM (5-second timeout)            |
| `get_weather`    | Current weather for a city via wttr.in (no API key required)         |
| `memory_store`   | Persist a key/value to `.memory.json`                                |
| `memory_recall`  | Retrieve a stored value (or list all keys)                           |

## Project structure

```
ai-agent/
├── agent.js              # REPL + Groq chat loop + tool-call recovery
├── tools/
│   ├── definitions.js    # OpenAI-style tool schemas (10 tools)
│   └── handlers.js       # Implementations for each tool
├── utils/
│   └── logger.js         # Colorized leveled logger
├── package.json
├── .env                  # Configuration (GROQ_API_KEY can come from env instead)
└── README.md
```

## Setup

```bash
cd ai-agent
npm install
```

Set your Groq API key (get one for free at <https://console.groq.com/keys>):

```bash
export GROQ_API_KEY=your_key_here
```

…or add it to a `.env` file in this folder.

## Run

```bash
npm start
```

You'll get an interactive prompt:

```
> What's the weather in Jakarta right now?
  -> tool get_weather({"location":"Jakarta","units":"metric"})
  <- get_weather: {"temperature":"32°C","conditions":"Patchy rain nearby", ...}

Assistant > Jakarta is currently 32°C with patchy rain nearby, humidity 67%, wind 15 km/h NNE.
```

### REPL commands

- `/tools` — list all available tools
- `/reset` — clear the conversation history
- `/exit` — quit

## Configuration

Set via environment variables (or in `.env`):

| Variable          | Default                       | Description                              |
| ----------------- | ----------------------------- | ---------------------------------------- |
| `GROQ_API_KEY`    | _(required)_                  | Your Groq API key                        |
| `GROQ_MODEL`      | `llama-3.3-70b-versatile`     | Any Groq-supported chat model            |
| `MAX_TOKENS`      | `4096`                        | Max output tokens per response           |
| `LOG_LEVEL`       | `info`                        | `debug` / `info` / `warn` / `error`      |

## Example prompts to try

- *"What's `sqrt(2024)` plus the current year in Tokyo?"* — chains `calculator` + `datetime`
- *"Remember that my favorite language is Rust."* — uses `memory_store`
- *"What did I tell you about my favorite language?"* — uses `memory_recall`
- *"Run JavaScript that returns the first 10 fibonacci numbers."* — uses `run_javascript`
- *"Cuaca Jakarta sekarang gimana?"* — uses `get_weather` (works in any language)

## Tool-call recovery

Llama models on Groq sometimes emit tool calls in their training format
(`<function=NAME={...}></function>`) instead of OpenAI's `tool_calls` field.
This agent handles three failure modes automatically:

1. Groq returns a `tool_use_failed` error — the malformed output is parsed and the
   tool is executed with a synthesized `tool_calls` entry.
2. Groq accepts the response, but the assistant message contains tool-call-shaped
   JSON in the text content — those are parsed and executed.
3. If parsing fails entirely, the agent retries (up to 2 times) with a corrective
   system message asking the model to use the standard format.

## License

MIT
