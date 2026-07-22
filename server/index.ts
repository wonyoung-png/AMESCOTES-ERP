import dotenv from "dotenv";
// .env 파일을 가장 먼저 로드 (override: true → 쉘 빈값 무시)
dotenv.config({ override: true });

import express from "express";
import compression from "compression";
import { createServer } from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yardageOcrRouter from "./yardage-ocr.js";
import vendorOcrRouter from "./vendor-ocr.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // ─── 공개 배포 접근 보호 (SHARE_PASS 설정 시에만 활성) ───
  // 외부 URL로 열 때 원가·거래처·재무 데이터 노출 방지용 1차 관문.
  // 로컬/사내 LAN에서는 SHARE_PASS 미설정 → 게이트 없음(그대로 접속).
  const SHARE_USER = process.env.SHARE_USER || "atlm";
  const SHARE_PASS = process.env.SHARE_PASS;
  if (SHARE_PASS) {
    app.use((req, res, next) => {
      const header = req.headers.authorization || "";
      const [scheme, encoded] = header.split(" ");
      if (scheme === "Basic" && encoded) {
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        const sep = decoded.indexOf(":");
        const user = decoded.slice(0, sep);
        const pass = decoded.slice(sep + 1);
        if (user === SHARE_USER && pass === SHARE_PASS) return next();
      }
      res.set("WWW-Authenticate", 'Basic realm="AMESCOTES ERP", charset="UTF-8"');
      res.status(401).send("접근하려면 인증이 필요합니다. (Authorization required)");
    });
    console.log("🔒 공개 접근 보호 활성화 (Basic Auth)");
  }

  // JSON 파싱 미들웨어
  app.use(compression());
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
  app.use(vendorOcrRouter);
  console.log("✓ Vendor OCR router mounted (/api/vendor/ocr)");

  // AI 에이전트 API 라우터 (AI 에이전트 팀, SSE) — Supabase service key 없으면 스킵
  try {
    const { default: agentRoutes } = await import("./agent-routes.js");
    app.use(agentRoutes);
    console.log("✓ Agent routes mounted (AI agent team)");
  } catch (err) {
    console.warn("⚠ Agent routes 비활성화 — 원인:", String(err).split("\n")[0]);
    console.warn("  → AI 에이전트 팀 기능을 쓰려면 .env에 SUPABASE_SERVICE_ROLE_KEY 설정");
  }

  // Serve static files from dist/public
  // dist/index.js 실행 시 __dirname === <project>/dist 이므로 항상 dist/public
  const staticPath = path.resolve(__dirname, "public");
  const indexHtml = path.join(staticPath, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.error(`✗ UI 빌드 없음: ${indexHtml}`);
    console.error("  → npm run build 후 다시 시작하세요 (ERP_시작.bat)");
  }

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  // index.html은 캐시 금지 (새 빌드 즉시 반영 — 로그인 비번 변경 등)
  app.get("*", (_req, res) => {
    if (!fs.existsSync(indexHtml)) {
      res.status(503).type("text/plain").send(
        "UI 빌드가 없습니다. npm run build 실행 후 서버를 다시 시작하세요.",
      );
      return;
    }
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.sendFile(indexHtml);
  });

  const port = process.env.PORT || 4000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`Anthropic API key loaded: ${!!process.env.ANTHROPIC_API_KEY}`);
  });
}

startServer().catch(console.error);
