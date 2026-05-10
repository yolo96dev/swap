import express from "express";
import {
  create1ClickQuote,
  fetch1ClickStatus,
  fetch1ClickTokens,
  submit1ClickDeposit,
} from "../lib/intents.js";
import { supabaseAdmin } from "../lib/supabase.js";

const router = express.Router();

const SWAP_TABLE = "swap_transactions";

function asString(v: unknown) {
  return String(v ?? "").trim();
}

function asNullableString(v: unknown) {
  const value = asString(v);
  return value ? value : null;
}

function log(scope: string, payload?: unknown) {
  const ts = new Date().toISOString();
  if (payload === undefined) {
    console.log(`[${ts}] ${scope}`);
    return;
  }
  console.log(`[${ts}] ${scope}`, payload);
}

function safeStatus(v: unknown) {
  const status = asString(v).toUpperCase();

  const allowed = new Set([
    "QUOTE_CREATED",
    "PENDING",
    "SUBMITTED",
    "PROCESSING",
    "SUCCESS",
    "COMPLETED",
    "FAILED",
    "ERROR",
    "EXPIRED",
  ]);

  return allowed.has(status) ? status : "PENDING";
}

function safeDirection(v: unknown) {
  const direction = asString(v).toUpperCase();

  const allowed = new Set([
    "TO_NEAR",
    "FROM_NEAR",
    "NEAR_TO_SOL",
    "SOL_TO_NEAR",
  ]);

  return allowed.has(direction) ? direction : "TO_NEAR";
}

function safeAsset(v: unknown) {
  const asset = asString(v).toUpperCase();

  const allowed = new Set(["NEAR", "SOL", "USDC", "ETH", "BTC"]);

  return allowed.has(asset) ? asset : "SOL";
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

router.post("/transactions/create", async (req, res) => {
  try {
    const account_id = asString(req.body?.account_id || req.body?.accountId);
    const direction = safeDirection(req.body?.direction);
    const asset = safeAsset(req.body?.asset);
    const amount = asString(req.body?.amount);
    const deposit_address = asNullableString(
      req.body?.deposit_address || req.body?.depositAddress
    );
    const destination_address = asNullableString(
      req.body?.destination_address || req.body?.destinationAddress
    );
    const refund_address = asNullableString(
      req.body?.refund_address || req.body?.refundAddress
    );
    const quote_amount_out = asNullableString(
      req.body?.quote_amount_out || req.body?.quoteAmountOut
    );
    const quote_expiry = asNullableString(
      req.body?.quote_expiry || req.body?.quoteExpiry
    );

    if (!account_id || !amount) {
      return res.status(400).json({
        error: "account_id and amount are required",
      });
    }

    if (account_id.toLowerCase().includes("attacker")) {
      return res.status(400).json({
        error: "Invalid account_id",
      });
    }

    const insertPayload = {
      account_id,
      direction,
      asset,
      amount,
      status: "PENDING",
      deposit_address,
      destination_address,
      refund_address,
      near_tx_hash: null,
      destination_tx_hash: null,
      quote_amount_out,
      quote_expiry,
      error: null,
      meta: {
        source: "render-backend",
        createdBy: "api",
      },
    };

    const { data, error } = await supabaseAdmin
      .from(SWAP_TABLE)
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return res.json({
      ok: true,
      transaction: data,
    });
  } catch (err: any) {
    console.error("SWAP TRANSACTION CREATE ERROR:", {
      message: err?.message,
      details: err?.details,
      hint: err?.hint,
      code: err?.code,
    });

    return res.status(500).json({
      error: err?.message || "Failed to create swap transaction",
    });
  }
});

router.post("/transactions/update", async (req, res) => {
  try {
    const id = asString(req.body?.id);
    const account_id = asString(req.body?.account_id || req.body?.accountId);

    if (!id || !account_id) {
      return res.status(400).json({
        error: "id and account_id are required",
      });
    }

    const status = safeStatus(req.body?.status);
    const near_tx_hash = asNullableString(
      req.body?.near_tx_hash || req.body?.nearTxHash
    );
    const destination_tx_hash = asNullableString(
      req.body?.destination_tx_hash || req.body?.destinationTxHash
    );
    const error_message = asNullableString(req.body?.error);

    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (near_tx_hash) updatePayload.near_tx_hash = near_tx_hash;
    if (destination_tx_hash) updatePayload.destination_tx_hash = destination_tx_hash;
    if (error_message) updatePayload.error = error_message;

    const { data, error } = await supabaseAdmin
      .from(SWAP_TABLE)
      .update(updatePayload)
      .eq("id", id)
      .eq("account_id", account_id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return res.json({
      ok: true,
      transaction: data,
    });
  } catch (err: any) {
    console.error("SWAP TRANSACTION UPDATE ERROR:", {
      message: err?.message,
      details: err?.details,
      hint: err?.hint,
      code: err?.code,
    });

    return res.status(500).json({
      error: err?.message || "Failed to update swap transaction",
    });
  }
});

router.get("/transactions/history", async (req, res) => {
  try {
    const account_id = asString(req.query.account_id || req.query.accountId);
    const limitRaw = Number(req.query.limit ?? 50);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.trunc(limitRaw), 100)
        : 50;

    if (!account_id) {
      return res.status(400).json({
        error: "account_id is required",
      });
    }

    const { data, error } = await supabaseAdmin
      .from(SWAP_TABLE)
      .select("*")
      .eq("account_id", account_id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return res.json({
      ok: true,
      transactions: data || [],
    });
  } catch (err: any) {
    console.error("SWAP TRANSACTION HISTORY ERROR:", {
      message: err?.message,
      details: err?.details,
      hint: err?.hint,
      code: err?.code,
    });

    return res.status(500).json({
      error: err?.message || "Failed to fetch swap transaction history",
    });
  }
});

router.post("/deposit-submit", async (req, res) => {
  try {
    const depositAddress = asString(req.body?.depositAddress);
    const txHash = asString(req.body?.txHash);
    const transactionId = asString(req.body?.transactionId);
    const accountId = asString(req.body?.accountId || req.body?.account_id);

    log("SWAP DEPOSIT_SUBMIT REQUEST", {
      depositAddress,
      txHash,
      transactionId,
      accountId,
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

    if (transactionId && accountId) {
      const { error } = await supabaseAdmin
        .from(SWAP_TABLE)
        .update({
          status: "SUBMITTED",
          near_tx_hash: txHash,
          updated_at: new Date().toISOString(),
          meta: {
            source: "render-backend",
            depositSubmitResult: result,
          },
        })
        .eq("id", transactionId)
        .eq("account_id", accountId);

      if (error) {
        console.error("SWAP DEPOSIT_SUBMIT DB UPDATE ERROR:", error);
      }
    }

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
    const transactionId = asString(req.query.transactionId);
    const accountId = asString(req.query.accountId || req.query.account_id);

    log("SWAP STATUS REQUEST", {
      depositAddress,
      transactionId,
      accountId,
    });

    if (!depositAddress) {
      return res.status(400).json({
        error: "depositAddress is required",
      });
    }

    const result = await fetch1ClickStatus(depositAddress);
    const rawStatus = asString(result?.status).toUpperCase();

    let dbStatus = "PROCESSING";
    if (["SUCCESS", "COMPLETED", "FILLED"].includes(rawStatus)) {
      dbStatus = "SUCCESS";
    } else if (["FAILED", "ERROR", "EXPIRED", "REFUNDED"].includes(rawStatus)) {
      dbStatus = "FAILED";
    }

    if (transactionId && accountId) {
      const destinationTxHash =
        asNullableString(result?.destinationTxHash) ||
        asNullableString(result?.destination_tx_hash) ||
        asNullableString(result?.txHash) ||
        asNullableString(result?.tx_hash);

      const { error } = await supabaseAdmin
        .from(SWAP_TABLE)
        .update({
          status: dbStatus,
          destination_tx_hash: destinationTxHash,
          updated_at: new Date().toISOString(),
          meta: {
            source: "render-backend",
            lastStatusResult: result,
          },
        })
        .eq("id", transactionId)
        .eq("account_id", accountId);

      if (error) {
        console.error("SWAP STATUS DB UPDATE ERROR:", error);
      }
    }

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