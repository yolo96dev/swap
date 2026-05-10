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

function isSafeNearAccountId(accountId: string) {
  const value = accountId.trim().toLowerCase();

  if (!value) return false;
  if (value.length < 2 || value.length > 64) return false;
  if (value.includes("attacker")) return false;
  if (value.includes("test_user")) return false;
  if (value.includes("security_test")) return false;

  // NEAR implicit accounts are 64 lowercase hex chars.
  if (/^[a-f0-9]{64}$/.test(value)) return true;

  // Named NEAR accounts: basic validation good enough for API input filtering.
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.(near|testnet)$/.test(value);
}

function isSafeAmountString(amount: string) {
  const value = amount.trim();
  if (!value) return false;
  if (!/^\d+$/.test(value)) return false;

  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function normalizeDbStatus(status: unknown) {
  const rawStatus = asString(status).toUpperCase();

  if (["SUCCESS", "COMPLETED", "FILLED"].includes(rawStatus)) {
    return "SUCCESS";
  }

  if (["FAILED", "ERROR", "EXPIRED", "REFUNDED", "INCOMPLETE_DEPOSIT"].includes(rawStatus)) {
    return "FAILED";
  }

  if (["SUBMITTED", "PROCESSING", "PENDING", "WAITING_DEPOSIT", "WAITING"].includes(rawStatus)) {
    return rawStatus === "SUBMITTED" ? "SUBMITTED" : "PROCESSING";
  }

  return "PROCESSING";
}

function assetLabelFromOriginAsset(originAsset: string) {
  const value = originAsset.toLowerCase();
  if (value.includes("sol")) return "SOL";
  if (value.includes("usdc")) return "USDC";
  if (value.includes("eth")) return "ETH";
  if (value.includes("btc")) return "BTC";
  if (value.includes("near")) return "NEAR";
  return "SOL";
}

function pickQuoteDepositAddress(quote: any) {
  return (
    asNullableString(quote?.depositAddress) ||
    asNullableString(quote?.deposit_address) ||
    asNullableString(quote?.deposit?.address)
  );
}

function pickQuoteAmountOut(quote: any) {
  return (
    asNullableString(quote?.amountOut) ||
    asNullableString(quote?.amount_out) ||
    asNullableString(quote?.minAmountOut) ||
    asNullableString(quote?.min_amount_out) ||
    asNullableString(quote?.expectedAmountOut) ||
    asNullableString(quote?.expected_amount_out)
  );
}

function pickStatusDestinationTxHash(result: any) {
  return (
    asNullableString(result?.destinationTxHash) ||
    asNullableString(result?.destination_tx_hash) ||
    asNullableString(result?.transferTxHash) ||
    asNullableString(result?.transfer_tx_hash) ||
    asNullableString(result?.txHash) ||
    asNullableString(result?.tx_hash) ||
    asNullableString(result?.data?.destinationTxHash) ||
    asNullableString(result?.data?.destination_tx_hash) ||
    asNullableString(result?.data?.transferTxHash) ||
    asNullableString(result?.data?.transfer_tx_hash) ||
    asNullableString(result?.data?.txHash) ||
    asNullableString(result?.data?.tx_hash)
  );
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

    if (!isSafeNearAccountId(nearAccountId)) {
      return res.status(400).json({
        error: "Invalid nearAccountId",
      });
    }

    if (!isSafeAmountString(amount)) {
      return res.status(400).json({
        error: "Invalid amount",
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
    const depositAddress = pickQuoteDepositAddress(quote);
    const quoteAmountOut = pickQuoteAmountOut(quote);

    if (!quote || !depositAddress) {
      return res.status(502).json({
        error: "1Click quote did not return a deposit address",
        quote,
        correlationId: result?.correlationId ?? null,
      });
    }

    const { data: transaction, error: insertError } = await supabaseAdmin
      .from(SWAP_TABLE)
      .insert({
        account_id: nearAccountId,
        direction: "TO_NEAR",
        asset: assetLabelFromOriginAsset(originAsset),
        amount,
        status: "PENDING",
        deposit_address: depositAddress,
        destination_address: nearAccountId,
        refund_address: refundTo,
        near_tx_hash: null,
        destination_tx_hash: null,
        quote_amount_out: quoteAmountOut,
        quote_expiry: deadline,
        error: null,
        meta: {
          source: "render-backend",
          createdBy: "quote",
          originAsset,
          destinationAsset: "nep141:wrap.near",
          slippageTolerance: payload.slippageTolerance,
          correlationId: result?.correlationId ?? null,
          quoteRequest: result?.quoteRequest ?? null,
        },
      })
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    log("SWAP QUOTE RESPONSE", {
      nearAccountId,
      originAsset,
      amount,
      depositAddress,
      amountOut: quoteAmountOut,
      transactionId: transaction?.id || null,
      result,
    });

    return res.json({
      ok: true,
      quote,
      transaction,
      quoteRequest: result?.quoteRequest ?? null,
      signature: result?.signature ?? null,
      timestamp: result?.timestamp ?? null,
      correlationId: result?.correlationId ?? null,
    });
  } catch (err: any) {
    console.error("SWAP QUOTE ERROR:", {
      message: err?.message,
      details: err?.details,
      hint: err?.hint,
      code: err?.code,
      stack: err?.stack,
      name: err?.name,
    });

    return res.status(500).json({
      error: err?.message || "Failed to create swap quote",
    });
  }
});

// Intentionally disabled. Database rows must be created from /quote only,
// after the backend receives a real 1Click quote.
router.post("/transactions/create", async (_req, res) => {
  return res.status(410).json({
    error: "This endpoint is disabled. Create swap records through /api/swap/quote.",
  });
});

// Intentionally disabled. Status updates must come from /deposit-submit or /status,
// where the backend checks the 1Click flow first.
router.post("/transactions/update", async (_req, res) => {
  return res.status(410).json({
    error: "This endpoint is disabled. Swap records are updated through verified swap status routes.",
  });
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

    if (!isSafeNearAccountId(account_id)) {
      return res.status(400).json({
        error: "Invalid account_id",
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
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from(SWAP_TABLE)
        .select("id, account_id, deposit_address, meta")
        .eq("id", transactionId)
        .eq("account_id", accountId)
        .eq("deposit_address", depositAddress)
        .maybeSingle();

      if (lookupError) {
        console.error("SWAP DEPOSIT_SUBMIT DB LOOKUP ERROR:", lookupError);
      }

      if (existing) {
        const { error } = await supabaseAdmin
          .from(SWAP_TABLE)
          .update({
            status: "SUBMITTED",
            near_tx_hash: txHash,
            updated_at: new Date().toISOString(),
            meta: {
              ...(typeof existing.meta === "object" && existing.meta ? existing.meta : {}),
              source: "render-backend",
              depositSubmitResult: result,
            },
          })
          .eq("id", transactionId)
          .eq("account_id", accountId)
          .eq("deposit_address", depositAddress);

        if (error) {
          console.error("SWAP DEPOSIT_SUBMIT DB UPDATE ERROR:", error);
        }
      } else {
        console.warn("SWAP DEPOSIT_SUBMIT DB UPDATE SKIPPED: no matching transaction", {
          transactionId,
          accountId,
          depositAddress,
        });
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
    const dbStatus = normalizeDbStatus(result?.status);

    if (transactionId && accountId) {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from(SWAP_TABLE)
        .select("id, account_id, deposit_address, meta")
        .eq("id", transactionId)
        .eq("account_id", accountId)
        .eq("deposit_address", depositAddress)
        .maybeSingle();

      if (lookupError) {
        console.error("SWAP STATUS DB LOOKUP ERROR:", lookupError);
      }

      if (existing) {
        const destinationTxHash = pickStatusDestinationTxHash(result);

        const updatePayload: Record<string, unknown> = {
          status: dbStatus,
          updated_at: new Date().toISOString(),
          meta: {
            ...(typeof existing.meta === "object" && existing.meta ? existing.meta : {}),
            source: "render-backend",
            lastStatusResult: result,
          },
        };

        if (destinationTxHash) {
          updatePayload.destination_tx_hash = destinationTxHash;
        }

        const { error } = await supabaseAdmin
          .from(SWAP_TABLE)
          .update(updatePayload)
          .eq("id", transactionId)
          .eq("account_id", accountId)
          .eq("deposit_address", depositAddress);

        if (error) {
          console.error("SWAP STATUS DB UPDATE ERROR:", error);
        }
      } else {
        console.warn("SWAP STATUS DB UPDATE SKIPPED: no matching transaction", {
          transactionId,
          accountId,
          depositAddress,
        });
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
