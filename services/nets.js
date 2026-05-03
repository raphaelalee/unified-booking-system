// services/nets.js
const NETS_BASE = "https://sandbox.nets.openapipaas.com";
const NETS_REQUEST_URL = `${NETS_BASE}/api/v1/common/payments/nets-qr/request`;
const NETS_ENQUIRY_URL =
  process.env.NETS_ENQUIRY_URL ||
  `${NETS_BASE}/api/v1/common/payments/nets-qr/query`;

const API_KEY = process.env.API_KEY;
const PROJECT_ID = process.env.Project_Id || process.env.PROJECT_ID;
const NETS_MID = process.env.NETS_MID || process.env.NETS_MERCHANT_ID || "";
const NETS_TID = process.env.NETS_TID || process.env.NETS_TERMINAL_ID || "";
const NETS_NOTIFY_MOBILE = process.env.NETS_NOTIFY_MOBILE || "";
const NETS_SANDBOX_MERCHANT_ID = process.env.NETS_SANDBOX_MERCHANT_ID || "";

function mustHaveEnv(name, value) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing environment variable: ${name}`);
  }
}

mustHaveEnv("API_KEY", API_KEY);
mustHaveEnv("PROJECT_ID", PROJECT_ID);

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (process.env.NETS_DEBUG === "true") {
      console.log("NETS request", {
        url,
        headers: {
          "api-key": API_KEY ? `${API_KEY.slice(0, 6)}...` : "",
          "project-id": PROJECT_ID ? `${PROJECT_ID.slice(0, 6)}...` : "",
        },
        body,
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": API_KEY,
        "project-id": PROJECT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));

    if (process.env.NETS_DEBUG === "true") {
      console.log("NETS response", {
        status: res.status,
        body: data,
      });
    }

    if (!res.ok) {
      throw new Error(`NETS request failed with status ${res.status}: ${JSON.stringify(data)}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Create NETS QR request (Sandbox)
 * @param {number|string} amount - total amount in dollars, e.g. 12.00
 * @param {string} txnId - sandbox txn_id string (required by NETS sandbox)
 * @returns {object} - { qr_code, txn_retrieval_ref, response_code, txn_status, ... }
 */
async function requestNetsQr(amount, txnId) {
  const amt = Number(amount);

  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error(`Invalid amount for NETS QR: ${amount}`);
  }

  if (!txnId || !String(txnId).trim()) {
    throw new Error("Missing txnId for NETS QR request");
  }

  const body = {
    txn_id: String(txnId),
    amt_in_dollars: Number(amt.toFixed(2)),
  };

  if (NETS_NOTIFY_MOBILE) {
    body.notify_mobile = NETS_NOTIFY_MOBILE;
  }

  if (NETS_MID) {
    body.mid = NETS_MID;
    body.merchant_id = NETS_MID;
  }

  if (NETS_TID) {
    body.tid = NETS_TID;
    body.terminal_id = NETS_TID;
  }

  const data = await postJson(NETS_REQUEST_URL, body, 15000);

  const qrData = data?.result?.data;
  if (!qrData) {
    throw new Error(`Unexpected NETS response: ${JSON.stringify(data)}`);
  }

  return qrData;
}

function createSandboxTxnId() {
  if (!NETS_SANDBOX_MERCHANT_ID) {
    throw new Error("Missing environment variable: NETS_SANDBOX_MERCHANT_ID");
  }

  return `sandbox_nets|m|${NETS_SANDBOX_MERCHANT_ID}`;
}

function createPrototypeNetsQr(amount, txnId) {
  const amt = Number(amount);
  const txnRetrievalRef = `PROTO-${String(txnId).replace(/[^A-Za-z0-9-]/g, '').slice(-24)}`;

  return {
    response_code: "00",
    txn_status: 1,
    txn_retrieval_ref: txnRetrievalRef,
    qr_code: [
      "NETSQR",
      `TXN:${txnId}`,
      `AMT:${Number.isFinite(amt) ? amt.toFixed(2) : "0.00"}`,
      "MERCHANT:Vaniday",
      `REF:${txnRetrievalRef}`,
    ].join("|"),
    prototype: true,
  };
}

function isQrSuccess(qrData) {
  return (
    qrData?.response_code === "00" &&
    Number(qrData?.txn_status) === 1 &&
    !!qrData?.qr_code &&
    !!qrData?.txn_retrieval_ref
  );
}

/**
 * Poll NETS for transaction status
 * @param {string} txnRetrievalRef
 * @returns {{status: 'SUCCESS'|'FAIL'|'PENDING', data: object}}
 */
async function checkStatus(txnRetrievalRef) {
  if (!txnRetrievalRef || !String(txnRetrievalRef).trim()) {
    throw new Error("Missing txnRetrievalRef for NETS enquiry");
  }

  const body = {
    txn_retrieval_ref: String(txnRetrievalRef),
  };
  if (NETS_MID) body.mid = NETS_MID;

  const res = await postJson(NETS_ENQUIRY_URL, body, 8000);

  const data = res?.result?.data || {};
  const responseCode = data.response_code;
  const statusNum = Number(data.txn_status);
  const statusRaw = data.txn_status;

  const success =
    responseCode === "00" &&
    (statusNum === 1 ||
      statusNum === 0 ||
      statusRaw === "1" ||
      statusRaw === "0" ||
      typeof statusRaw === "undefined");
  const failed = Number.isFinite(statusNum) && statusNum !== 0 && statusNum !== 1;

  return {
    status: success ? "SUCCESS" : failed ? "FAIL" : "PENDING",
    data,
  };
}

module.exports = {
  requestNetsQr,
  createPrototypeNetsQr,
  createSandboxTxnId,
  isQrSuccess,
  checkStatus,
};
