// Payment verification lives in the durable x402 service. The old JSON proof
// middleware was removed: a caller-provided transaction hash is never payment.
export { x402Routes } from "../routes/x402.js";
