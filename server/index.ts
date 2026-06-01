import dotenv from "dotenv";
// .env 파일을 가장 먼저 로드 (override: true → 쉘 빈값 무시)
dotenv.config({ override: true });

import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import yardageOcrRouter from "./yardage-ocr.js";

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

  // OCR 전용 라우터 (항상 활성) — ANTHROPIC_API_KEY만 필요, agent-team 의존성 없음
  // agent-routes보다 먼저 마운트해서 /api/yardage/ocr 를 우선 처리
  app.use(yardageOcrRouter);
  console.log("✓ Yardage OCR router mounted (/api/yardage/ocr)");

  // AI 에이전트 API 라우터 (AI 에이전트 팀, SSE) — Supabase service key 없으면 스킵
  try {
    const { default: agentRoutes } = await import("./agent-routes.js");
    app.use(agentRoutes);
    console.log("✓ Agent routes mounted (AI agent team)");
  } catch (err) {
    console.warn("⚠ Agent routes 비활성화 — 원인:", String(err).split("\n")[0]);
    console.warn("  → AI 에이전트 팀 기능을 쓰려면 .env에 SUPABASE_SERVICE_ROLE_KEY 설정");
  }

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  // index.html은 캐시 금지 (새 빌드 즉시 반영 — 로그인 비번 변경 등)
  app.get("*", (_req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 4000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`Anthropic API key loaded: ${!!process.env.ANTHROPIC_API_KEY}`);
  });
}

startServer().catch(console.error);
