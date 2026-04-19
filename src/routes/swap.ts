import express from "express";
import {
  create1ClickQuote,
  fetch1ClickStatus,
  fetch1ClickTokens,
  submit1ClickDeposit,
} from "../lib/intents.js";

const router = express.Router();

function asString(v: unknown) {
  return String(v ?? "").trim();
}

function log(scope: string, payload?: unknown) {
  const ts = new Date().toISOString();
  if (payload === undefined) {
    console.log(`[${ts}] ${scope}`);
    return;
  }
  console.log(`[${ts}] ${scope}`, payload);
}

router.get("/tokens", async (_req, res) => {
  try {
    log("SWAP TOKENS REQUEST");

    const result = await fetch1ClickTokens();

    log("SWAP TOKENS RESPONSE", {
      count: Array.isArray(result) ? result.length : 0,
    });

    return res.json({
      ok: true,
      tokens: result,
    });
  } catch (err: any) {
    console.error("SWAP TOKENS ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });

    return res.status(500).json({
      error: err?.message || "Failed to fetch swap tokens",
    });
  }
});

router.post("/quote", async (req, res) => {
  try {
    const nearAccountId = asString(req.body?.nearAccountId);
    const originAsset = asString(req.body?.originAsset);
    const amount = asString(req.body?.amount);
    const refundTo = asString(req.body?.refundTo);
    const slippageTolerance = Number(req.body?.slippageTolerance ?? 100);

    log("SWAP QUOTE REQUEST", {
      nearAccountId,
      originAsset,
      amount,
      refundTo,
      slippageTolerance,
      rawBody: req.body,
    });

    if (!nearAccountId || !originAsset || !amount || !refundTo) {
      return res.status(400).json({
        error: "nearAccountId, originAsset, amount, and refundTo are required",
      });
    }

    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const payload = {
      dry: false,
      swapType: "EXACT_INPUT" as const,
      slippageTolerance:
        Number.isFinite(slippageTolerance) && slippageTolerance > 0
          ? Math.trunc(slippageTolerance)
          : 100,
      originAsset,
      depositType: "ORIGIN_CHAIN" as const,
      destinationAsset: "nep141:wrap.near",
      amount,
      recipient: nearAccountId,
      recipientType: "DESTINATION_CHAIN" as const,
      refundTo,
      refundType: "ORIGIN_CHAIN" as const,
      deadline,
    };

    const result = await create1ClickQuote(payload);
    const quote = result?.quote ?? null;

    log("SWAP QUOTE RESPONSE", {
      nearAccountId,
      originAsset,
      amount,
      depositAddress: quote?.depositAddress || null,
      amountOut: quote?.amountOut || null,
      result,
    });

    return res.json({
      ok: true,
      quote,
      quoteRequest: result?.quoteRequest ?? null,
      signature: result?.signature ?? null,
      timestamp: result?.timestamp ?? null,
      correlationId: result?.correlationId ?? null,
    });
  } catch (err: any) {
    console.error("SWAP QUOTE ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });

    return res.status(500).json({
      error: err?.message || "Failed to create swap quote",
    });
  }
});

router.post("/deposit-submit", async (req, res) => {
  try {
    const depositAddress = asString(req.body?.depositAddress);
    const txHash = asString(req.body?.txHash);

    log("SWAP DEPOSIT_SUBMIT REQUEST", {
      depositAddress,
      txHash,
      rawBody: req.body,
    });

    if (!depositAddress || !txHash) {
      return res.status(400).json({
        error: "depositAddress and txHash are required",
      });
    }

    const result = await submit1ClickDeposit({
      depositAddress,
      txHash,
    });

    log("SWAP DEPOSIT_SUBMIT RESPONSE", {
      depositAddress,
      txHash,
      result,
    });

    return res.json({
      ok: true,
      result,
    });
  } catch (err: any) {
    console.error("SWAP DEPOSIT_SUBMIT ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });

    return res.status(500).json({
      error: err?.message || "Failed to submit deposit tx",
    });
  }
});

router.get("/status", async (req, res) => {
  try {
    const depositAddress = asString(req.query.depositAddress);

    log("SWAP STATUS REQUEST", {
      depositAddress,
    });

    if (!depositAddress) {
      return res.status(400).json({
        error: "depositAddress is required",
      });
    }

    const result = await fetch1ClickStatus(depositAddress);

    log("SWAP STATUS RESPONSE", {
      depositAddress,
      status: result?.status || null,
      result,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("SWAP STATUS ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });

    return res.status(500).json({
      error: err?.message || "Failed to fetch swap status",
    });
  }
});

export default router;
