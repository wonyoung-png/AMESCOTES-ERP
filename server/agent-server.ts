// AI 에이전트 전용 API 서버 — 포트 3001 (Vite dev와 분리)
import express from "express";
import agentRoutes from "./agent-routes.js";

const app = express();
app.use(express.json());
app.use(agentRoutes);

const port = Number(process.env.AGENT_PORT) || 3001;
app.listen(port, () => {
  console.log(`AI 에이전트 서버 실행 중: http://localhost:${port}`);
});
