const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const vm = require("vm");
const https = require("https");

const MEMORY_FILE = path.join(__dirname, "..", ".memory.json");
const ROOT_DIR = path.resolve(__dirname, "..");

function safeResolve(target) {
  const resolved = path.resolve(ROOT_DIR, target);
  if (!resolved.startsWith(ROOT_DIR)) {
    throw new Error(`Path '${target}' is outside the agent workspace.`);
  }
  return resolved;
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "ai-agent/1.0 (+https://replit.com)" } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("Request timed out after 15s"));
    });
  });
}

async function loadMemory() {
  try {
    const raw = await fsp.readFile(MEMORY_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function saveMemory(memory) {
  await fsp.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2), "utf8");
}

const handlers = {
  async calculator({ expression }) {
    if (typeof expression !== "string" || !expression.trim()) {
      throw new Error("'expression' must be a non-empty string.");
    }
    if (!/^[0-9+\-*/%().,\s\w]*$/.test(expression)) {
      throw new Error("Expression contains disallowed characters.");
    }
    const sandbox = {
      sqrt: Math.sqrt,
      pow: Math.pow,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      log: Math.log,
      log2: Math.log2,
      log10: Math.log10,
      exp: Math.exp,
      abs: Math.abs,
      min: Math.min,
      max: Math.max,
      round: Math.round,
      floor: Math.floor,
      ceil: Math.ceil,
      PI: Math.PI,
      E: Math.E,
    };
    const context = vm.createContext(sandbox);
    const script = new vm.Script(`(${expression})`);
    const result = script.runInContext(context, { timeout: 1000 });
    if (typeof result !== "number" || Number.isNaN(result)) {
      throw new Error(`Expression did not produce a finite number: ${result}`);
    }
    return { expression, result };
  },

  async datetime({ timezone = "UTC", format = "iso" } = {}) {
    const now = new Date();
    if (format === "epoch") {
      return { epoch: now.getTime(), epochSeconds: Math.floor(now.getTime() / 1000), timezone };
    }
    if (format === "human") {
      const human = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now);
      return { datetime: human, timezone };
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    const iso = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    return { datetime: iso, timezone, utc: now.toISOString() };
  },

  async read_file({ path: filePath, encoding = "utf-8" }) {
    const resolved = safeResolve(filePath);
    const content = await fsp.readFile(resolved, encoding);
    const stat = await fsp.stat(resolved);
    return { path: filePath, bytes: stat.size, content };
  },

  async write_file({ path: filePath, content, append = false }) {
    const resolved = safeResolve(filePath);
    await fsp.mkdir(path.dirname(resolved), { recursive: true });
    if (append) {
      await fsp.appendFile(resolved, content, "utf8");
    } else {
      await fsp.writeFile(resolved, content, "utf8");
    }
    const stat = await fsp.stat(resolved);
    return { path: filePath, bytes: stat.size, mode: append ? "append" : "overwrite" };
  },

  async list_directory({ path: dirPath = "." } = {}) {
    const resolved = safeResolve(dirPath);
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(resolved, entry.name);
        let size = null;
        if (entry.isFile()) {
          try {
            size = (await fsp.stat(full)).size;
          } catch {
            size = null;
          }
        }
        return {
          name: entry.name,
          type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
          size,
        };
      }),
    );
    return { path: dirPath, count: items.length, entries: items };
  },

  async web_search({ query }) {
    if (!query || typeof query !== "string") {
      throw new Error("'query' must be a non-empty string.");
    }
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const data = await httpGetJson(url);
    const related = Array.isArray(data.RelatedTopics)
      ? data.RelatedTopics.filter((t) => t && t.Text)
          .slice(0, 5)
          .map((t) => ({ text: t.Text, url: t.FirstURL }))
      : [];
    return {
      query,
      heading: data.Heading || null,
      abstract: data.AbstractText || null,
      abstractSource: data.AbstractSource || null,
      abstractUrl: data.AbstractURL || null,
      answer: data.Answer || null,
      definition: data.Definition || null,
      relatedTopics: related,
    };
  },

  async run_javascript({ code }) {
    if (!code || typeof code !== "string") {
      throw new Error("'code' must be a non-empty string.");
    }
    const logs = [];
    const sandbox = {
      console: {
        log: (...args) =>
          logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")),
        error: (...args) =>
          logs.push("[error] " + args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")),
      },
      Math,
      Date,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Set,
      Map,
    };
    const context = vm.createContext(sandbox);
    let result;
    try {
      const script = new vm.Script(`(function(){ ${code} })()`);
      result = script.runInContext(context, { timeout: 5000 });
    } catch (err) {
      return { ok: false, error: err.message, logs };
    }
    return {
      ok: true,
      result: result === undefined ? null : JSON.parse(JSON.stringify(result ?? null)),
      logs,
    };
  },

  async get_weather({ location, units = "metric" }) {
    if (!location || typeof location !== "string") {
      throw new Error("'location' must be a non-empty string.");
    }
    const unitFlag = units === "imperial" ? "u" : "m";
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&${unitFlag}`;
    const data = await httpGetJson(url);
    const current = (data.current_condition && data.current_condition[0]) || {};
    const area = (data.nearest_area && data.nearest_area[0]) || {};
    return {
      location,
      resolvedLocation:
        (area.areaName && area.areaName[0] && area.areaName[0].value) || location,
      country: (area.country && area.country[0] && area.country[0].value) || null,
      temperature:
        units === "imperial" ? `${current.temp_F}°F` : `${current.temp_C}°C`,
      feelsLike:
        units === "imperial" ? `${current.FeelsLikeF}°F` : `${current.FeelsLikeC}°C`,
      conditions:
        (current.weatherDesc && current.weatherDesc[0] && current.weatherDesc[0].value) || null,
      humidity: `${current.humidity}%`,
      wind:
        units === "imperial"
          ? `${current.windspeedMiles} mph ${current.winddir16Point}`
          : `${current.windspeedKmph} km/h ${current.winddir16Point}`,
      observedAt: current.observation_time || null,
    };
  },

  async memory_store({ key, value }) {
    if (!key || typeof key !== "string") {
      throw new Error("'key' must be a non-empty string.");
    }
    const memory = await loadMemory();
    memory[key] = value;
    await saveMemory(memory);
    return { stored: true, key, totalKeys: Object.keys(memory).length };
  },

  async memory_recall({ key } = {}) {
    const memory = await loadMemory();
    if (!key) {
      return { keys: Object.keys(memory), count: Object.keys(memory).length };
    }
    if (!(key in memory)) {
      return { key, found: false };
    }
    return { key, found: true, value: memory[key] };
  },
};

async function executeTool(name, input) {
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return await handler(input || {});
}

module.exports = { handlers, executeTool };
