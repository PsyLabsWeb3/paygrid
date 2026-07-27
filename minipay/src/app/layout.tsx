import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Paygrid",
  description: "Agent-ready stablecoin checkout for Celo.",
  other: {
    "talentapp:project_verification":
      "ae5ce65c56741bac78bc8448079a2ff79e942d3d81fe1f07e11c0621a7dc6a9e16c59df0a368a66da5a4cd9e5fca3064b315400dd4f231959662e027e7f7742a",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#050604",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
