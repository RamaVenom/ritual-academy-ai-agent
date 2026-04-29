const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const COLORS = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
};

const LEVEL_COLORS = {
  debug: COLORS.gray,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const currentLevel = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] || LEVELS.info;

function timestamp() {
  return new Date().toISOString().split("T")[1].slice(0, -1);
}

function format(level, scope, message, data) {
  const color = LEVEL_COLORS[level] || COLORS.reset;
  const head = `${COLORS.gray}[${timestamp()}]${COLORS.reset} ${color}${level.toUpperCase().padEnd(5)}${COLORS.reset} ${COLORS.magenta}${scope}${COLORS.reset}`;
  if (data !== undefined) {
    const dataStr = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    return `${head} ${message}\n${COLORS.gray}${dataStr}${COLORS.reset}`;
  }
  return `${head} ${message}`;
}

function makeLogger(scope = "agent") {
  function log(level, message, data) {
    if (LEVELS[level] < currentLevel) return;
    const out = format(level, scope, message, data);
    if (level === "error" || level === "warn") {
      console.error(out);
    } else {
      console.log(out);
    }
  }

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
    child: (childScope) => makeLogger(`${scope}:${childScope}`),
    banner: (text) => {
      const line = "=".repeat(Math.max(40, text.length + 4));
      console.log(`\n${COLORS.bold}${COLORS.green}${line}\n  ${text}\n${line}${COLORS.reset}\n`);
    },
    user: (text) => {
      console.log(`\n${COLORS.bold}${COLORS.cyan}You${COLORS.reset} ${COLORS.gray}>${COLORS.reset} ${text}`);
    },
    assistant: (text) => {
      console.log(`\n${COLORS.bold}${COLORS.green}Assistant${COLORS.reset} ${COLORS.gray}>${COLORS.reset} ${text}\n`);
    },
    tool: (name, input) => {
      console.log(
        `${COLORS.gray}  -> tool ${COLORS.yellow}${name}${COLORS.reset}${COLORS.gray}(${JSON.stringify(input)})${COLORS.reset}`,
      );
    },
    toolResult: (name, result) => {
      const text = typeof result === "string" ? result : JSON.stringify(result);
      const trimmed = text.length > 200 ? `${text.slice(0, 200)}...` : text;
      console.log(`${COLORS.gray}  <- ${name}: ${trimmed}${COLORS.reset}`);
    },
  };
}

module.exports = { logger: makeLogger(), makeLogger };
