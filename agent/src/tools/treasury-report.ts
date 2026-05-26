import { tool } from "ai";
import { z } from "zod";
import { fetchWithAgentAuth } from "../utils/auth";

export const executeTreasuryReport = tool({
  description: "Executes a treasury report, aggregating data from payments and active links.",
  parameters: z.object({
    period: z.enum(["7d", "30d", "all"]).optional().describe("The time period for the report"),
  }),
  execute: async ({ period = "all" }) => {
    // In a real implementation we would pass the period to the backend.
    // For now we will fetch payments and links and aggregate them.
    const [paymentsRes, linksRes] = await Promise.all([
      fetchWithAgentAuth("/api/payments?limit=1000"),
      fetchWithAgentAuth("/api/links?limit=1000")
    ]);

    if (!paymentsRes.ok || !linksRes.ok) {
      throw new Error("Failed to fetch data for treasury report");
    }

    const paymentsData = await paymentsRes.json();
    const linksData = await linksRes.json();

    const payments = Array.isArray(paymentsData.data) ? paymentsData.data : [];
    const links = Array.isArray(linksData.data) ? linksData.data : [];

    const totalReceived: Record<string, number> = {};
    const totalFees: Record<string, number> = {};

    for (const p of payments) {
      const t = p.token || "UNKNOWN";
      totalReceived[t] = (totalReceived[t] || 0) + Number(p.amount || 0);
      totalFees[t] = (totalFees[t] || 0) + Number(p.fee || 0); // Assuming fee is available
    }

    const activeLinks = links.filter((l: any) => l.status === "active").length;

    // Convert numbers back to string for the return format
    const formatRecord = (rec: Record<string, number>) => {
      const res: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec)) res[k] = v.toString();
      return res;
    };

    return {
      totalReceived: formatRecord(totalReceived),
      totalFees: formatRecord(totalFees),
      paymentsCount: payments.length,
      activeLinks,
    };
  },
});
