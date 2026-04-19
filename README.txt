Mount this router in your Express app, for example:

import bridgeRouter from "./routes/bridge.js";
app.use("/api/bridge", bridgeRouter);

Optional env:
BRIDGE_RPC_URL=https://bridge.chaindefuser.com/rpc
