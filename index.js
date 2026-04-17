import express from "express";
import cors from "cors";
import {
  getSnapshot,
  resetDemoState,
  saveWorker,
  simulateDisruption,
} from "./store.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);

// Allow all origins - TEMPORARY for debugging CORS issues
app.use(cors());

app.use(express.json());

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    service: "truedelivery-demo-api",
    time: new Date().toISOString(),
  });
});

app.get("/api/bootstrap", async (_request, response, next) => {
  try {
    response.json(await getSnapshot());
  } catch (error) {
    next(error);
  }
});

app.put("/api/worker", async (request, response, next) => {
  try {
    response.json(await saveWorker(request.body || {}));
  } catch (error) {
    next(error);
  }
});

app.post("/api/simulate-disruption", async (request, response, next) => {
  try {
    response.json(await simulateDisruption(request.body?.disruptionId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/reset-demo", async (_request, response, next) => {
  try {
    response.json(await resetDemoState());
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode || 500;
  response.status(statusCode).json({
    error: error.message || "Unexpected server error",
  });
});

app.listen(PORT, () => {
  console.log(`TrueDelivery API listening on http://127.0.0.1:${PORT}`);
});
