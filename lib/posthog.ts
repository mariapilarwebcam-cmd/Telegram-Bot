// lib/posthog.ts
"use client"

import posthog from 'posthog-js'

let initialized = false

// ═══════════════════════════════════════════════════════════════
// Inicialización (una sola vez)
// ═══════════════════════════════════════════════════════════════
export function initPostHog() {
  if (initialized) return
  if (typeof window === 'undefined') return

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST

  if (!key || !host) {
    console.warn('[PostHog] Missing env vars — analytics disabled')
    return
  }

  posthog.init(key, {
    api_host: host,
    capture_pageview: false, // lo controlamos manualmente
    capture_pageleave: true,
    autocapture: true,
    persistence: 'localStorage',
    loaded: (ph) => {
      if (process.env.NODE_ENV === 'development') ph.debug()
    },
  })

  initialized = true
}

// ═══════════════════════════════════════════════════════════════
// Helpers base
// ═══════════════════════════════════════════════════════════════
export function identifyUser(
  userId: string,
  properties?: Record<string, any>
) {
  if (typeof window === 'undefined') return
  if (!initialized) return
  posthog.identify(userId, properties)
}

export function capture(event: string, properties?: Record<string, any>) {
  if (typeof window === 'undefined') return
  if (!initialized) return
  posthog.capture(event, properties)
}

export function capturePageView() {
  if (typeof window === 'undefined') return
  if (!initialized) return
  posthog.capture('$pageview')
}

export function resetUser() {
  if (typeof window === 'undefined') return
  if (!initialized) return
  posthog.reset()
}

// ═══════════════════════════════════════════════════════════════
// Eventos predefinidos — 12 eventos clave del proyecto
// ═══════════════════════════════════════════════════════════════
export const Analytics = {
  // ─── Onboarding ───
  userRegistered: (props: { telegram_id: string; language: string }) => {
    capture('user_registered', props)
  },

  onboardingCompleted: (props: {
    gender: string
    interested_in: string
    time_seconds: number
  }) => {
    capture('onboarding_completed', props)
  },

  // ─── Personajes ───
  characterSelected: (props: {
    archetype: string
    gender: string
    is_vip_archetype: boolean
  }) => {
    capture('character_selected', props)
  },

  // ─── Chat ───
  firstMessageSent: (props: {
    character_id: number
    archetype: string
    level: number
  }) => {
    capture('first_message_sent', props)
  },

  levelUp: (props: {
    character_id: number
    new_level: number
    total_messages: number
  }) => {
    capture('level_up', props)
  },

  // ─── Imagen / Audio ───
  imageGenerated: (props: {
    character_id: number
    source: 'r2' | 'generated'
    image_index: number | null
    cost: number
    free: boolean
    level: number
  }) => {
    capture('image_generated', props)
  },

  audioGenerated: (props: {
    character_id: number
    cost: number
    level: number
  }) => {
    capture('audio_generated', props)
  },

  // ─── Monetización ───
  vipPageViewed: (props: { is_vip: boolean }) => {
    capture('vip_page_viewed', props)
  },

  vipPurchased: (props: {
    plan: 'weekly' | 'monthly' | 'quarterly'
    method: 'stars' | 'crypto'
    price_usd: number
    stars: number
  }) => {
    capture('vip_purchased', props)
  },

  gemsPurchased: (props: {
    package_index: number
    gems: number
    method: 'stars' | 'crypto'
    amount: number
  }) => {
    capture('gems_purchased', props)
  },

  // ─── Referidos ───
  referralShared: (props: { channel: 'copy' | 'share' }) => {
    capture('referral_shared', props)
  },
}