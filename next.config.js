/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    MCP_URL: process.env.MCP_URL,
    MCP_SECRET: process.env.MCP_SECRET,
  },
};

module.exports = nextConfig;
