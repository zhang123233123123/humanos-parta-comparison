/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.HUMANOS_DEMO_MODE === '1' ? '.next-demo' : '.next',
  images: {
    domains: ['api.dicebear.com'],
  },
}

export default nextConfig
