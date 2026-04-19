const BRIDGE_RPC_URL =
  process.env.BRIDGE_RPC_URL?.trim() || "https://bridge.chaindefuser.com/rpc";

type JsonRpcSuccess<T> = {
  jsonrpc: "2.0";
  id: number | string | null;
  result: T;
};

type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

async function callBridgeRpc<T>(
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const body = {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params: [params],
  };

  const res = await fetch(BRIDGE_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => null)) as JsonRpcResponse<T> | null;

  if (!res.ok) {
    throw new Error(
      (json as any)?.error?.message ||
        `Bridge RPC HTTP ${res.status}`
    );
  }

  if (!json) {
    throw new Error("Bridge RPC returned an empty response");
  }

  if ("error" in json) {
    throw new Error(json.error?.message || "Bridge RPC returned an error");
  }

  return json.result;
}

export type SupportedToken = {
  defuse_asset_identifier: string;
  near_token_id: string;
  decimals: number;
  asset_name: string;
  min_deposit_amount: string;
  min_withdrawal_amount: string;
  withdrawal_fee: string;
};

export type SupportedTokensResult = {
  tokens: SupportedToken[];
};

export type DepositAddressResult = {
  address: string;
  chain: string;
};

export type RecentDeposit = {
  tx_hash?: string;
  chain: string;
  defuse_asset_identifier: string;
  decimals: number;
  amount: string;
  account_id: string;
  address: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
};

export type RecentDepositsResult = {
  deposits: RecentDeposit[];
};

export type WithdrawalStatusResult = {
  status:
    | "COMPLETED"
    | "PENDING"
    | "FAILED"
    | "NOT_FOUND"
    | "AWAITING"
    | "REJECTED"
    | "RETURNING"
    | "RETURNED";
  data?: {
    tx_hash: string;
    transfer_tx_hash?: string;
    chain: string;
    defuse_asset_identifier: string;
    decimals: number;
    amount: string;
    account_id: string;
    address: string;
  };
};

export type WithdrawalEstimateResult = {
  tokenAddress?: string | null;
  userAddress?: string;
  withdrawalFee?: string;
  withdrawalFeeDecimals?: number;
  token?: unknown;
  [key: string]: unknown;
};

export async function getSupportedTokens(chains?: string[]) {
  return callBridgeRpc<SupportedTokensResult>("supported_tokens", {
    ...(Array.isArray(chains) && chains.length ? { chains } : {}),
  });
}

export async function getDepositAddress(params: {
  account_id: string;
  chain: string;
}) {
  return callBridgeRpc<DepositAddressResult>("deposit_address", params);
}

export async function getRecentDeposits(params: {
  account_id: string;
  chain: string;
}) {
  return callBridgeRpc<RecentDepositsResult>("recent_deposits", params);
}

export async function notifyDeposit(params: {
  deposit_address: string;
  tx_hash: string;
}) {
  return callBridgeRpc<Record<string, unknown>>("notify_deposit", params);
}

export async function getWithdrawalStatus(params: {
  withdrawal_hash: string;
}) {
  return callBridgeRpc<WithdrawalStatusResult>("withdrawal_status", params);
}

export async function getWithdrawalEstimate(params: {
  chain: string;
  token: string;
  address: string;
}) {
  return callBridgeRpc<WithdrawalEstimateResult>("withdrawal_estimate", params);
}
