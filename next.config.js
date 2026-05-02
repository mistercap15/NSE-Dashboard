/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    MCP_URL: process.env.MCP_URL,
    MCP_SECRET: process.env.MCP_SECRET,
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false
    return config
  },
};

module.exports = nextConfig;
