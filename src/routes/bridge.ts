import express from "express";
import {
  getDepositAddress,
  getRecentDeposits,
  getSupportedTokens,
  getWithdrawalEstimate,
  getWithdrawalStatus,
  notifyDeposit,
} from "../lib/bridgeRpc.js";

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

router.get("/tokens", async (req, res) => {
  try {
    const chainsRaw = asString(req.query.chains);
    const chains = chainsRaw
      ? chainsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    log("BRIDGE TOKENS REQUEST", { chains });

    const result = await getSupportedTokens(chains);

    log("BRIDGE TOKENS RESPONSE", {
      count: result.tokens?.length || 0,
      chains,
      tokens: result.tokens || [],
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("BRIDGE TOKENS ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to fetch supported bridge tokens",
    });
  }
});

router.post("/deposit-address", async (req, res) => {
  try {
    const account_id = asString(req.body?.account_id);
    const chain = asString(req.body?.chain);

    log("BRIDGE DEPOSIT_ADDRESS REQUEST", {
      account_id,
      chain,
      rawBody: req.body,
    });

    if (!account_id || !chain) {
      return res.status(400).json({
        error: "account_id and chain are required",
      });
    }

    const result = await getDepositAddress({ account_id, chain });

    log("BRIDGE DEPOSIT_ADDRESS RESPONSE", {
      account_id,
      chain,
      result,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("BRIDGE DEPOSIT_ADDRESS ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to create deposit address",
    });
  }
});

router.get("/recent-deposits", async (req, res) => {
  try {
    const account_id = asString(req.query.account_id);
    const chain = asString(req.query.chain);

    log("BRIDGE RECENT_DEPOSITS REQUEST", {
      account_id,
      chain,
    });

    if (!account_id || !chain) {
      return res.status(400).json({
        error: "account_id and chain are required",
      });
    }

    const result = await getRecentDeposits({ account_id, chain });
    const deposits = Array.isArray(result.deposits) ? result.deposits : [];

    log("BRIDGE RECENT_DEPOSITS RESPONSE", {
      count: deposits.length,
      account_id,
      chain,
      deposits,
      summarized: deposits.map((d) => ({
        address: d.address,
        status: d.status,
        amount: d.amount,
        tx_hash: d.tx_hash || null,
        defuse_asset_identifier: d.defuse_asset_identifier,
        decimals: d.decimals,
        account_id: d.account_id,
        chain: d.chain,
      })),
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("BRIDGE RECENT_DEPOSITS ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to fetch recent deposits",
    });
  }
});

router.post("/notify-deposit", async (req, res) => {
  try {
    const deposit_address = asString(req.body?.deposit_address);
    const tx_hash = asString(req.body?.tx_hash);

    log("BRIDGE NOTIFY_DEPOSIT REQUEST", {
      deposit_address,
      tx_hash,
      rawBody: req.body,
    });

    if (!deposit_address || !tx_hash) {
      return res.status(400).json({
        error: "deposit_address and tx_hash are required",
      });
    }

    const result = await notifyDeposit({ deposit_address, tx_hash });

    log("BRIDGE NOTIFY_DEPOSIT RESPONSE", {
      deposit_address,
      tx_hash,
      result,
    });

    return res.json({
      ok: true,
      result,
    });
  } catch (err: any) {
    console.error("BRIDGE NOTIFY_DEPOSIT ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to notify deposit",
    });
  }
});

router.get("/withdrawal-status", async (req, res) => {
  try {
    const withdrawal_hash = asString(req.query.withdrawal_hash);

    log("BRIDGE WITHDRAWAL_STATUS REQUEST", {
      withdrawal_hash,
    });

    if (!withdrawal_hash) {
      return res.status(400).json({
        error: "withdrawal_hash is required",
      });
    }

    const result = await getWithdrawalStatus({ withdrawal_hash });

    log("BRIDGE WITHDRAWAL_STATUS RESPONSE", {
      withdrawal_hash,
      status: result.status,
      data: result.data,
      fullResult: result,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("BRIDGE WITHDRAWAL_STATUS ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to fetch withdrawal status",
    });
  }
});

router.post("/withdrawal-estimate", async (req, res) => {
  try {
    const chain = asString(req.body?.chain);
    const token = asString(req.body?.token);
    const address = asString(req.body?.address);

    log("BRIDGE WITHDRAWAL_ESTIMATE REQUEST", {
      chain,
      token,
      address,
      rawBody: req.body,
    });

    if (!chain || !token || !address) {
      return res.status(400).json({
        error: "chain, token, and address are required",
      });
    }

    const result = await getWithdrawalEstimate({ chain, token, address });

    log("BRIDGE WITHDRAWAL_ESTIMATE RESPONSE", {
      chain,
      token,
      address,
      result,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("BRIDGE WITHDRAWAL_ESTIMATE ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to estimate withdrawal",
    });
  }
});

export default router;