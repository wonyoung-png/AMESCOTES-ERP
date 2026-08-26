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
import sessionRouter from "./session.js";
import dailyBridgeRouter from "./daily-bridge.js";
import vendorOcrRouter from "./vendor-ocr.js";
import pixelRouter from "./pixel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // 배포용 헬스체크 — Basic Auth 게이트보다 먼저 등록해야 SHARE_PASS 활성 시에도 200 응답
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, uptime: process.uptime() });
  });

  // Shopify 웹픽셀 수집 — 외부 브라우저가 무인증 POST하므로 Basic Auth 게이트보다 먼저
  app.use(pixelRouter);

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

  // 서버 검증 로그인
  app.use(sessionRouter);

  // Daily 데이터 브리지 (플랫폼 간 연계)
  app.use(dailyBridgeRouter);

  // OCR 라우터
  app.use(yardageOcrRouter);
  app.use(vendorOcrRouter);

  // AI 에이전트 API 라우터 — Supabase service key 없으면 스킵
  try {
    const { default: agentRoutes } = await import("./agent-routes.js");
    app.use(agentRoutes);
  } catch (err) {
    console.warn("[server] Agent routes 비활성화:", String(err).split("\n")[0]);
  }

  // Serve static files from dist/public
  // dist/index.js 실행 시 __dirname === <project>/dist 이므로 항상 dist/public
  const staticPath = path.resolve(__dirname, "public");
  const indexHtml = path.join(staticPath, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.error(`[server] UI 빌드 없음: ${indexHtml} — npm run build 후 재시작 필요`);
  }

  // 해시 파일명(assets/*)은 1년 불변 캐시 — 재방문 시 재다운로드 없음
  app.use(express.static(staticPath, { maxAge: "365d", immutable: true, index: false }));

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
    console.log(`[server] AMESCOTES ERP 서버 시작 — port ${port}`);
  });
}

startServer().catch(console.error);
