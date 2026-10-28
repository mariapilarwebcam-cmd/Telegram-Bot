// next.config.js

const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.goddessgridhq.com' },
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: '**.cloudflarestorage.com' },
      { protocol: 'https', hostname: '**.wiro.ai' },
      { protocol: 'https', hostname: '**.deepinfra.com' },
    ],
  },
  
  // ✅ Mantiene 'sharp' fuera del empaquetado de Webpack (Next 14)
  experimental: {
    serverComponentsExternalPackages: ['sharp'],
  },

  // ✅ Ayuda a Vercel a manejar los binarios nativos en las funciones Serverless
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@swc/core-linux-x64-gnu',
      'node_modules/@swc/core-linux-x64-musl',
      'node_modules/esbuild/linux',
      'node_modules/webpack',
      'node_modules/rollup',
      'node_modules/terser',
      'node_modules/sharp/**/*',
    ],
  },

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
