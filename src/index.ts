import "dotenv/config";
import cors from "cors";
import express from "express";
import bridgeRouter from "./routes/bridge.js";
import swapRouter from "./routes/swap.js";

const app = express();
const PORT = Number(process.env.PORT || 10000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/bridge", bridgeRouter);
app.use("/api/swap", swapRouter);

app.listen(PORT, () => {
  console.log(`dripz-bridge-backend listening on http://localhost:${PORT}`);
});