/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained build for the Docker runner stage.
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
