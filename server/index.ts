import dotenv from "dotenv";
// .env 파일을 가장 먼저 로드 (override: true → 쉘 빈값 무시)
dotenv.config({ override: true });

import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // JSON 파싱 미들웨어
  app.use(express.json({ limit: "10mb" }));

  // 요청 로깅 미들웨어
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // AI 에이전트 API 라우터 (OCR 포함) — Supabase service key 없으면 스킵
  try {
    const { default: agentRoutes } = await import("./agent-routes.js");
    app.use(agentRoutes);
    console.log("✓ Agent routes mounted (OCR, AI agent team)");
  } catch (err) {
    console.warn("⚠ Agent routes 비활성화 — 원인:", String(err).split("\n")[0]);
    console.warn("  → OCR/AI 기능을 쓰려면 .env에 SUPABASE_SERVICE_ROLE_KEY 설정");
  }

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 4000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`Anthropic API key loaded: ${!!process.env.ANTHROPIC_API_KEY}`);
  });
}

startServer().catch(console.error);
