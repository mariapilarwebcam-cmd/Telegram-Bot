"use client"

let webAppInstance: any = null
let sdkPromise: Promise<any> | null = null

export function loadTelegramSdk(): Promise<any> {
  if (webAppInstance) return Promise.resolve(webAppInstance)
  if (sdkPromise) return sdkPromise

  sdkPromise = import('@twa-dev/sdk')
    .then((mod) => {
      const WebApp = mod.default
      try { WebApp.ready() } catch {}
      try { WebApp.expand() } catch {}
      webAppInstance = WebApp
      return WebApp
    })
    .catch((err) => {
      console.error('Failed to load Telegram SDK:', err)
      sdkPromise = null
      throw err
    })

  return sdkPromise
}

export function getWebApp(): any {
  return webAppInstance
}

export function getTelegramUser(): any | null {
  return webAppInstance?.initDataUnsafe?.user || null
}

export function getStartParam(): string | null {
  return webAppInstance?.initDataUnsafe?.start_param || null
}