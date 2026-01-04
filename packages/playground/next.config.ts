import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Expose environment variables to the client
  env: {
    NEXT_PUBLIC_DEFAULT_AGENT_NAME: process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME,
    NEXT_PUBLIC_DEFAULT_AGENT_URL: process.env.NEXT_PUBLIC_DEFAULT_AGENT_URL,
  },
};

export default nextConfig;

// added by create cloudflare to enable calling `getCloudflareContext()` in `next dev`
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
