import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const port = Number(process.env.PORT || 8000);

const API_ROUTES = {
  "/api/proofread": { file: "proofread.ts", handler: "handleProofreadRequest" },
  "/api/transcribe": { file: "transcribe.ts", handler: "handleTranscribeRequest" },
  "/api/upload-audio": { file: "upload-audio.ts", handler: "handleUploadAudioRequest" },
};

function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

async function loadApiHandler(routeConfig) {
  const modulePath = path.join(rootDir, "api", routeConfig.file);
  const imported = await import(pathToFileURL(modulePath).href);
  return imported[routeConfig.handler];
}

function createMockResponse(res) {
  return {
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    status(code) {
      return {
        json(payload) {
          sendJson(res, code, payload);
        },
        end() {
          res.writeHead(code);
          res.end();
        },
      };
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const routeConfig = API_ROUTES[url.pathname];

  if (req.method === "OPTIONS" && routeConfig) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (routeConfig && req.method === "POST") {
    try {
      const handler = await loadApiHandler(routeConfig);
      const rawBody = await readBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      req.body = body;
      await handler(req, createMockResponse(res));
    } catch (err) {
      console.error(`dev-server ${url.pathname} error:`, err);
      sendJson(res, 500, { error: "Request failed" });
    }
    return;
  }

  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(rootDir, filePath);

  if (!absolutePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(absolutePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Dev server: http://localhost:${port}`);
  console.log(`API: /api/proofread, /api/transcribe, /api/upload-audio`);
});
