import { Helmet } from "react-helmet-async";
import { faqs, site } from "../data/site";

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Celo PayGrid",
    url: "https://celopaygrid.xyz",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Celo PayGrid",
    applicationCategory: "DeveloperApplication",
    description: "MCP-based payment execution infrastructure for AI agents on Celo Mainnet.",
    url: "https://celopaygrid.xyz",
    featureList: [
      "Remote MCP server",
      "Payment request generation",
      "Transaction verification",
      "Celo Mainnet settlement",
      "Agent capability discovery",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: "Celo PayGrid MCP",
    description: "Remote MCP server for AI agent payment actions on Celo Mainnet.",
    endpointUrl: site.mcpEndpoint,
    documentation: site.docsUrl,
    provider: {
      "@type": "Organization",
      name: "Celo PayGrid",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  },
];

export function Seo() {
  return (
    <Helmet>
      <title>{site.title}</title>
      <meta name="description" content={site.description} />
      <meta
        name="keywords"
        content="Celo PayGrid, AI agent payments, MCP payment server, payment links for AI agents, Celo agent payments, stablecoin payments for agents, agent-to-human payments, AI payment infrastructure, transaction verification MCP, agent commerce infrastructure, Celo MCP payments, agent payment execution layer"
      />
      <link rel="canonical" href={site.canonical} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={site.title} />
      <meta property="og:description" content={site.description} />
      <meta property="og:url" content={site.canonical} />
      <meta property="og:site_name" content="Celo PayGrid" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={site.title} />
      <meta name="twitter:description" content={site.description} />
      {structuredData.map((data, index) => (
        <script key={index} type="application/ld+json">
          {JSON.stringify(data)}
        </script>
      ))}
    </Helmet>
  );
}

