/**
 * In-page `window.ethereum` mock for Alice / Mallory.
 *
 * Serialized as an init script (runs before app code): serves
 * eth_requestAccounts / eth_chainId from injected constants, and relays
 * signing/broadcasting to the sidecar signer. Receipt reads go straight to
 * the node's JSON-RPC (Anvil sends permissive CORS headers, and the app's own
 * viem client already relies on that).
 */
export function injectedWalletInitScript(input: { address: string; sidecarUrl: string; chainId: number; rpcUrl: string }): string {
  return `(() => {
  const config = ${JSON.stringify(input)};
  const rpcCall = async (method, params) => {
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || "RPC error");
    return payload.result;
  };
  const sidecar = async (route, body) => {
    const response = await fetch(config.sidecarUrl + route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "sidecar request failed");
      error.code = 4001;
      throw error;
    }
    return payload;
  };
  window.ethereum = {
    isMetaMask: true,
    on() {},
    removeListener() {},
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [config.address];
        case "eth_chainId":
          return "0x" + config.chainId.toString(16);
        case "eth_sendTransaction":
          return (await sidecar("/sendTransaction", (params && params[0]) || {})).hash;
        case "eth_getTransactionReceipt":
          return rpcCall(method, params);
        case "eth_signTypedData_v4":
          return (await sidecar("/signTypedData", { address: params && params[0], payload: params && params[1] })).signature;
        default:
          throw new Error("mock wallet: unsupported method " + method);
      }
    },
  };
})();`;
}
