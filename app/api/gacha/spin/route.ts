// app/api/gacha/spin/route.ts
import { NextResponse } from 'next/server'
import { db, queryOne, execute } from '@/lib/turso'
import { ensureUser, insertGemTransaction } from '@/lib/db-queries'

const COST_GEMS = 50

// Catálogo de personajes exclusivos de la ruleta
const GACHA_CHARACTERS_FEMALE = ['succubus', 'vampire_lady', 'kitsune', 'demon_girl', 'fallen_angel', 'witch']
const GACHA_CHARACTERS_MALE = ['vampire_lord', 'demon_lord', 'dragon_lord', 'oni_male', 'dark_hunter', 'elf_prince']

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const user = await ensureUser(tid)
    if (!user) return NextResponse.json({ error: 'Error cargando cuenta' }, { status: 500 })

    const tx = await db.transaction('write')

    try {
      // 1. Cobrar las gemas de pago (Solo purchased_gems)
      const debit = await tx.execute({
        sql: `UPDATE users 
              SET purchased_gems = purchased_gems - ?, gems = gems - ? 
              WHERE telegram_id = ? AND purchased_gems >= ? 
              RETURNING purchased_gems, gems`,
        args: [COST_GEMS, COST_GEMS, tid, COST_GEMS]
      })

      if (debit.rowsAffected === 0) {
        await tx.rollback()
        return NextResponse.json({ error: 'insufficient_gems', message: 'Necesitas 50 gemas compradas.' }, { status: 402 })
      }

      // 2. Verificar el Sistema de Pity (Lástima)
      // Buscamos las últimas 9 tiradas. Si no hay épicos+, forzamos uno.
      const last9 = await tx.execute({
        sql: `SELECT reward_tier FROM gacha_history WHERE user_id = ? ORDER BY id DESC LIMIT 9`,
        args: [tid]
      })

      let forceEpic = false
      if (last9.rows.length === 9) {
        const hasEpic = last9.rows.some(r => ['epic', 'legendary', 'mythic'].includes(String(r.reward_tier)))
        if (!hasEpic) forceEpic = true
      }

      // 3. El RNG (Random Number Generator)
      const roll = Math.random() * 100
      let tier: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' = 'common'
      let rewardType = ''
      let rewardDetails = ''
      let itemKey = ''

      if (forceEpic) {
        // Si se activa el Pity, le damos un Épico garantizado
        tier = Math.random() < 0.4 ? 'epic' : 'epic' // 100% épico
      } else if (roll < 0.1) {
        tier = 'mythic'
      } else if (roll < 2.0) {
        tier = 'legendary'
      } else if (roll < 10.0) {
        tier = 'epic'
      } else if (roll < 40.0) {
        tier = 'rare'
      } else {
        tier = 'common'
      }

      // 4. Asignar el Premio según la rareza
      if (tier === 'mythic' || tier === 'legendary') {
        // Personajes Exclusivos
        const isFemale = user.interested_in !== 'male' // Si le gustan mujeres o ambos
        const pool = isFemale ? GACHA_CHARACTERS_FEMALE : GACHA_CHARACTERS_MALE
        const char = pool[Math.floor(Math.random() * pool.length)]

        // Insertar en el inventario como personaje
        await tx.execute({
          sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'gacha_character', ?)`,
          args: [tid, char]
        })

        rewardType = 'gacha_character'
        rewardDetails = `¡Has desbloqueado al personaje exclusivo ${char}!`
        itemKey = char

      } else if (tier === 'epic') {
        // Pase de Fantasía (Foto Nivel 5) o Outfit
        const isFantasyPass = Math.random() < 0.6 // 60% foto nivel 5, 40% outfit

        if (isFantasyPass) {
          await tx.execute({
            sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'fantasy_pass', 'level_5')`,
            args: [tid]
          })
          rewardType = 'fantasy_pass'
          rewardDetails = '¡Pase de Fantasía! (Foto Nivel 5 Ultra-Secreta)'
          itemKey = 'level_5'
        } else {
          const outfit = await tx.execute({ sql: `SELECT id, name FROM gacha_outfits ORDER BY RANDOM() LIMIT 1` })
          const o = outfit.rows[0]
          await tx.execute({
            sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'outfit', ?)`,
            args: [tid, String(o.id)]
          })
          rewardType = 'outfit'
          rewardDetails = `¡Outfit Exclusivo: ${o.name}!`
          itemKey = String(o.id)
        }

      } else if (tier === 'rare') {
        // Pase de 24h (150 msgs) o Foto Nivel 3/4
        if (Math.random() < 0.5) {
          const expiresAt = Math.floor(Date.now() / 1000) + 86400
          await tx.execute({
            sql: `INSERT INTO message_passes (user_id, expires_at, messages_limit) VALUES (?, ?, 150)`,
            args: [tid, expiresAt]
          })
          rewardType = 'message_pass'
          rewardDetails = '¡Pase de 24h (150 mensajes gratis)!'
        } else {
          await tx.execute({
            sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'photo_token', 'level_34')`,
            args: [tid]
          })
          rewardType = 'photo_token'
          rewardDetails = '¡Foto Sorpresa (Nivel 3 o 4)!'
        }

      } else {
        // Común: Gemas de Chat (Bonus Gems)
        // 36% 20, 12% 30, 6% 35, 4.8% 40, 1.2% 50
        let bonus = 20
        const cRoll = Math.random() * 100
        if (cRoll > 98.8) bonus = 50
        else if (cRoll > 94) bonus = 40
        else if (cRoll > 88) bonus = 35
        else if (cRoll > 76) bonus = 30

        await tx.execute({
          sql: `UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ? WHERE telegram_id = ?`,
          args: [bonus, tid]
        })
        rewardType = 'bonus_gems'
        rewardDetails = `¡Has ganado ${bonus} Mensajes de Chat gratis!`
        itemKey = String(bonus)
      }

      // 5. Guardar en el historial
      await tx.execute({
        sql: `INSERT INTO gacha_history (user_id, cost_gems, reward_tier, reward_details) VALUES (?, ?, ?, ?)`,
        args: [tid, COST_GEMS, tier, `${rewardType}:${rewardDetails}`]
      })

      await tx.commit()

      // Registrar transacción de gemas
      await insertGemTransaction({
        telegram_id: tid,
        amount: -COST_GEMS,
        transaction_type: 'gacha_spin',
        description: `Tirada de ruleta (${tier})`
      })

      return NextResponse.json({
        success: true,
        tier,
        reward_type: rewardType,
        reward_details: rewardDetails,
        item_key: itemKey,
        remaining_gems: Number(debit.rows[0]?.gems || 0)
      })

    } catch (txError) {
      await tx.rollback().catch(() => {})
      throw txError
    }
  } catch (error: any) {
    console.error('[gacha/spin] error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}