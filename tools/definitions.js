const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "calculator",
      description:
        "Evaluate a mathematical expression and return the numeric result. Supports +, -, *, /, %, **, parentheses, and common Math functions like sqrt, pow, sin, cos, log, abs, min, max, round, floor, ceil, PI, E.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "The math expression to evaluate, e.g. '2 * (3 + 4)' or 'sqrt(144) + sin(PI / 2)'.",
          },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "datetime",
      description:
        "Return the current date and time. Optionally accepts an IANA timezone (e.g. 'America/New_York', 'UTC', 'Asia/Tokyo') and a format ('iso', 'human', or 'epoch').",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone identifier. Defaults to UTC.",
          },
          format: {
            type: "string",
            enum: ["iso", "human", "epoch"],
            description: "Output format. Defaults to 'iso'.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a text file from the local filesystem. Paths are resolved relative to the agent's working directory and constrained to the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative or absolute path to the file to read.",
          },
          encoding: {
            type: "string",
            description: "File encoding. Defaults to 'utf-8'.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write text content to a file on the local filesystem, creating parent directories as needed. Overwrites existing files. Restricted to the agent's workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative or absolute path of the file to write.",
          },
          content: {
            type: "string",
            description: "The text content to write to the file.",
          },
          append: {
            type: "boolean",
            description: "If true, append to the file instead of overwriting. Defaults to false.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List entries in a directory. Returns each entry's name, type (file/dir), and size in bytes for files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path to list. Defaults to '.'.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web using DuckDuckGo's instant-answer API and return the abstract, related topics, and a result URL when available. Best for quick factual lookups.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_javascript",
      description:
        "Execute a snippet of JavaScript in a sandboxed VM and return the result of the last expression along with anything written to console.log. No filesystem, network, or require access. 5-second timeout.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The JavaScript code to execute.",
          },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "Look up current weather for a city or location using the free wttr.in service. Returns temperature, conditions, humidity, and wind.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City name or 'lat,lon' coordinates, e.g. 'San Francisco' or '37.77,-122.42'.",
          },
          units: {
            type: "string",
            enum: ["metric", "imperial"],
            description: "Units system. Defaults to 'metric'.",
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_store",
      description:
        "Save a key/value fact to the agent's persistent memory store (a JSON file on disk). Use this to remember user preferences, facts, or anything you want to recall in future turns.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The key under which to store the value.",
          },
          value: {
            description: "The value to store. Can be a string, number, boolean, object, or array.",
          },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_recall",
      description:
        "Retrieve a value from persistent memory. If 'key' is omitted, returns a list of all stored keys.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The key to retrieve. Omit to list all keys.",
          },
        },
      },
    },
  },
];

module.exports = { toolDefinitions };
