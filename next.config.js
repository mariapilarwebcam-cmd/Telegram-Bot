// next.config.js

const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.goddessgridhq.com',
      },
      {
        protocol: 'https',
        hostname: '**.r2.dev',
      },
      {
        protocol: 'https',
        hostname: '**.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: '**.wiro.ai',
      },
      {
        protocol: 'https',
        hostname: '**.deepinfra.com',
      },
    ],
  },
  
  // ✅ NUEVO: Le dice a Next.js que no empaquete "sharp" en el servidor, 
  // para que use el binario de Linux que instalamos con el postinstall.
  experimental: {
    serverComponentsExternalPackages: ['sharp'],
  },

  // ✅ Cabeceras CORS para que las wallets puedan leer el manifest
  async headers() {
    return [
      {
        source: '/tonconnect-manifest.json',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'X-Requested-With, content-type, Authorization' },
        ],
      },
    ]
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
