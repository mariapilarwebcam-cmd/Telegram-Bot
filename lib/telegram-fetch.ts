// lib/telegram-fetch.ts
"use client"

// Variable global del módulo: se rellena desde UserContext
let cachedInitData: string | null = null

export function setInitDataRaw(data: string) {
  cachedInitData = data
}

export function getInitDataRaw(): string | null {
  return cachedInitData
}

/**
 * fetch() con header Authorization: tma <initData>
 * Úsalo en lugar de fetch() para endpoints protegidos.
 */
export function tgFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {})

  if (cachedInitData) {
    headers.set('Authorization', `tma ${cachedInitData}`)
  }

  return fetch(url, { ...options, headers })
}