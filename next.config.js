// next.config.js

const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // ✅ Restringido: solo los hosts que realmente usas.
      // Si añades otro CDN para imágenes, agrégalo aquí.
      {
        protocol: 'https',
        hostname: 'images.goddessgridhq.com',
      },
      {
        protocol: 'https',
        hostname: '**.r2.dev',        // Cloudflare R2
      },
      {
        protocol: 'https',
        hostname: '**.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: '**.wiro.ai',        // Wiro outputs
      },
      {
        protocol: 'https',
        hostname: '**.deepinfra.com',  // DeepInfra outputs
      },
    ],
  },
}

module.exports = withSentryConfig(
  nextConfig,
  {
    org: 'taboo-realm',
    project: 'javascript-nextjs',
    silent: true,
    widenClientFileUpload: true,
    hideSourceMaps: true,
    disableLogger: true,
  }
)
