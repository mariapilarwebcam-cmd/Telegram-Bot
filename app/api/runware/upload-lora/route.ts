// app/api/runware/upload-lora/route.ts

import { NextResponse } from 'next/server'

const RUNWARE_API_KEY = process.env.RUNWARE_API_KEY

export async function GET() {
  try {
    if (!RUNWARE_API_KEY) {
      return NextResponse.json({ error: 'Falta RUNWARE_API_KEY' }, { status: 500 })
    }

    const payload = {
      taskType: "modelUpload",
      taskUUID: crypto.randomUUID(),
      category: "lora",
      architecture: "sdxl", // Z-Image usa esta arquitectura
      format: "safetensors",
      name: "ElusarcaAnimeStyle",
      version: "v1",
      // 👇 La URL que me mostraste en la captura de R2
      downloadURL: "https://pub-0d4ac23dc04f47f9b4357e8f42916526.r2.dev/elusarcaAnimeStyleC59fe.HM2v.safetensors",
      air: "taboorealm:elusarca@1", // ✅ Este será el ID que usaremos en el código
      private: true,
      positiveTriggerWords: "elusarca anime style, high quality anime illustration",
      defaultWeight: 0.85
    }

    const res = await fetch("https://api.runware.ai/v1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RUNWARE_API_KEY}`
      },
      body: JSON.stringify([payload])
    })

    const data = await res.json()
    return NextResponse.json(data)

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}