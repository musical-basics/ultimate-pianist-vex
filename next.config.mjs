/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Prevents double-mount leaking phantom WebGL canvases
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  serverActions: {
    bodySizeLimit: '100mb',
  },
}

export default nextConfig
