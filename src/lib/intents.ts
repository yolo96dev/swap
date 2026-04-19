const INTENTS_BASE_URL =
  process.env.INTENTS_BASE_URL?.trim() || "https://1click.chaindefuser.com/v0";

const INTENTS_JWT = process.env.INTENTS_JWT?.trim() || "";

function authHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (INTENTS_JWT) {
    headers.Authorization = `Bearer ${INTENTS_JWT}`;
  }

  return headers;
}

async function readJson(res: Response) {
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      json?.message ||
        json?.error ||
        `1Click request failed (${res.status})`
    );
  }

  return json;
}

export async function fetch1ClickTokens() {
  const res = await fetch(`${INTENTS_BASE_URL}/tokens`);
  return readJson(res);
}

export async function create1ClickQuote(payload: {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  deadline: string;
}) {
  const res = await fetch(`${INTENTS_BASE_URL}/quote`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  return readJson(res);
}

export async function submit1ClickDeposit(params: {
  depositAddress: string;
  txHash: string;
}) {
  const res = await fetch(`${INTENTS_BASE_URL}/deposit/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  return readJson(res);
}

export async function fetch1ClickStatus(depositAddress: string) {
  const url =
    `${INTENTS_BASE_URL}/status?` +
    new URLSearchParams({ depositAddress }).toString();

  const res = await fetch(url);
  return readJson(res);
}