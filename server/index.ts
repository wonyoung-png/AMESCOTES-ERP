import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import yardageOcrRouter from "./yardage-ocr.js";

// .env 파일 로드 (override: true → 쉘에 빈 값이 있어도 .env 값으로 덮어쓰기)
dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // JSON 파싱
  app.use(express.json({ limit: "10mb" }));

  // API 라우터 (정적 파일보다 먼저 마운트)
  app.use(yardageOcrRouter);

  // Serve static files
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Client-side routing fallback
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
