/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    MCP_URL: process.env.MCP_URL,
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false
    return config
  },
};

module.exports = nextConfig;
