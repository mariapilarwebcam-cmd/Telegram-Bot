// app/api/gacha/spin/route.ts
import { NextResponse } from 'next/server'
import { db, queryOne, execute } from '@/lib/turso'
import { ensureUser, insertGemTransaction, getActiveSubscription } from '@/lib/db-queries'

const BASE_COST_GEMS = 50

const GACHA_CHARACTERS_FEMALE = ['succubus', 'fallen_angel', 'werewolf_f', 'cyborg_assassin']
const GACHA_CHARACTERS_MALE = ['demon_lord', 'dragon_lord', 'werewolf_m', 'incubus_lord']

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const user = await ensureUser(tid)
    if (!user) return NextResponse.json({ error: 'Error cargando cuenta' }, { status: 500 })

    // ✅ NUEVO: Verificar si es VIP y si tiene su tirada gratis semanal
    const vipSub = await getActiveSubscription(tid)
    const isVip = !!vipSub
    let cost = BASE_COST_GEMS
    let isFreeSpin = false

    if (isVip) {
      // Buscar si ya hizo una tirada gratis en los últimos 7 días
      const recentFreeSpin = await queryOne<{ id: number }>(
        `SELECT id FROM gacha_history 
         WHERE user_id = ? AND cost_gems = 0 AND created_at >= datetime('now', '-7 days') 
         LIMIT 1`,
        [tid]
      )
      
      if (!recentFreeSpin) {
        cost = 0
        isFreeSpin = true
      }
    }

    const tx = await db.transaction('write')

    try {
      // 1. Cobrar las gemas (si no es gratis)
      let debit = { rowsAffected: 1, rows: [{ purchased_gems: user.purchased_gems, gems: user.gems }] }
      
      if (cost > 0) {
        const res = await tx.execute({
          sql: `UPDATE users 
                SET purchased_gems = purchased_gems - ?, gems = gems - ? 
                WHERE telegram_id = ? AND purchased_gems >= ? 
                RETURNING purchased_gems, gems`,
          args: [cost, cost, tid, cost]
        })
        
        if (res.rowsAffected === 0) {
          await tx.rollback()
          return NextResponse.json({ error: 'insufficient_gems', message: 'Necesitas 50 gemas compradas.' }, { status: 402 })
        }
        debit = res as any
      }

      // 2. Pity System (Garantía cada 10 tiradas)
      const last9 = await tx.execute({
        sql: `SELECT reward_tier FROM gacha_history WHERE user_id = ? ORDER BY id DESC LIMIT 9`,
        args: [tid]
      })

      let forceEpic = false
      if (last9.rows.length === 9) {
        const hasEpic = last9.rows.some(r => ['epic', 'legendary', 'mythic'].includes(String(r.reward_tier)))
        if (!hasEpic) forceEpic = true
      }

      // 3. RNG Principal
      const roll = Math.random() * 100
      let tier: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' = 'common'
      let rewardType = ''
      let rewardDetails = ''
      let itemKey = ''

      if (forceEpic) {
        const pityRoll = Math.random() * 100
        if (pityRoll < 1.5) tier = 'mythic'
        else if (pityRoll < 15.0) tier = 'legendary'
        else tier = 'epic'
      } else if (roll < 0.5) {
        tier = 'mythic'
      } else if (roll < 1.5) {
        tier = 'legendary'
      } else if (roll < 6.0) {
        tier = 'epic'
      } else if (roll < 30.0) {
        tier = 'rare'
      } else {
        tier = 'common'
      }

      // 4. Asignar Premio
      if (tier === 'mythic' || tier === 'legendary') {
        const isFemale = user.interested_in !== 'male'
        const pool = isFemale ? GACHA_CHARACTERS_FEMALE : GACHA_CHARACTERS_MALE
        const char = pool[Math.floor(Math.random() * pool.length)]

        const alreadyOwned = await tx.execute({
          sql: `SELECT id FROM user_inventory WHERE user_id = ? AND item_type = 'gacha_character' AND item_key = ? LIMIT 1`,
          args: [tid, char]
        })

        if (alreadyOwned.rows.length > 0) {
          const compensation = 100 
          await tx.execute({
            sql: `UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ? WHERE telegram_id = ?`,
            args: [compensation, tid]
          })
          rewardType = 'bonus_gems'
          rewardDetails = `¡Ya tenías a ${char}! Te compensamos con ${compensation} Mensajes de Chat.`
          itemKey = String(compensation)
        } else {
          await tx.execute({
            sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'gacha_character', ?)`,
            args: [tid, char]
          })
          rewardType = 'gacha_character'
          rewardDetails = `¡Has desbloqueado al personaje exclusivo ${char}!`
          itemKey = char
        }

      } else if (tier === 'epic') {
        const isFantasyPass = Math.random() < 0.5

        if (isFantasyPass) {
          await tx.execute({
            sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'fantasy_pass', 'level_5')`,
            args: [tid]
          })
          rewardType = 'fantasy_pass'
          rewardDetails = '¡Pase de Fantasía! (Foto Nivel 5 Ultra-Secreta)'
          itemKey = 'level_5'
        } else {
          const outfitRoll = Math.random() * 100
          let targetRarity: 'rare' | 'epic' | 'legendary'
          if (outfitRoll < 5) targetRarity = 'legendary'
          else if (outfitRoll < 20) targetRarity = 'epic'
          else targetRarity = 'rare'

          let outfit = await tx.execute({
            sql: `SELECT id, name FROM gacha_outfits WHERE rarity = ? ORDER BY RANDOM() LIMIT 1`,
            args: [targetRarity]
          })

          if (outfit.rows.length === 0) {
            outfit = await tx.execute({
              sql: `SELECT id, name FROM gacha_outfits ORDER BY RANDOM() LIMIT 1`,
              args: []
            })
          }

          if (outfit.rows.length > 0) {
            const o = outfit.rows[0]
            const outfitId = String(o.id)

            const alreadyOwnedOutfit = await tx.execute({
              sql: `SELECT id FROM user_inventory WHERE user_id = ? AND item_type = 'outfit' AND item_key = ? LIMIT 1`,
              args: [tid, outfitId]
            })

            if (alreadyOwnedOutfit.rows.length > 0) {
              const compensation = 40 
              await tx.execute({
                sql: `UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ? WHERE telegram_id = ?`,
                args: [compensation, tid]
              })
              rewardType = 'bonus_gems'
              rewardDetails = `¡Ya tenías el Outfit "${o.name}"! Te compensamos con ${compensation} Mensajes de Chat.`
              itemKey = String(compensation)
            } else {
              await tx.execute({
                sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'outfit', ?)`,
                args: [tid, outfitId]
              })
              const rarityPrefix = targetRarity === 'legendary' ? '🔥 ¡OUTFIT LEGENDARIO! ' : targetRarity === 'epic' ? '💜 ' : ''
              rewardType = 'outfit'
              rewardDetails = `${rarityPrefix}¡${o.name}!`
              itemKey = outfitId
            }
          } else {
            await tx.execute({
              sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'fantasy_pass', 'level_5')`,
              args: [tid]
            })
            rewardType = 'fantasy_pass'
            rewardDetails = '¡Pase de Fantasía! (Foto Nivel 5 Ultra-Secreta)'
            itemKey = 'level_5'
          }
        }

      } else if (tier === 'rare') {
        const rareRoll = Math.random() * 100
        
        if (rareRoll < 33) {
          await tx.execute({
            sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'photo_token', 'level_34')`,
            args: [tid]
          })
          rewardType = 'photo_token'
          rewardDetails = '¡Foto Sorpresa (Nivel 3 o 4)!'
        } else if (rareRoll < 66) {
          const audioAmount = Math.random() < 0.5 ? 1 : 2
          for (let i = 0; i < audioAmount; i++) {
            await tx.execute({
              sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'audio_token', 'free')`,
              args: [tid]
            })
          }
          rewardType = 'audio_token'
          rewardDetails = `¡Has ganado ${audioAmount} Audio(s) Gratis!`
        } else {
          let randomMsg = 15
          const gemRoll = Math.random() * 100
          
          if (gemRoll < 80) {
            const opts = [15, 20, 25, 30]
            randomMsg = opts[Math.floor(Math.random() * opts.length)]
          } else if (gemRoll < 94) {
            randomMsg = Math.random() < 0.5 ? 35 : 40
          } else if (gemRoll < 99) {
            randomMsg = 45
          } else {
            const opts = [50, 60, 75]
            randomMsg = opts[Math.floor(Math.random() * opts.length)]
          }

          await tx.execute({
            sql: `UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ? WHERE telegram_id = ?`,
            args: [randomMsg, tid]
          })
          rewardType = 'bonus_gems'
          rewardDetails = `¡Has ganado ${randomMsg} Mensajes de Chat!`
          itemKey = String(randomMsg)
        }

      } else {
        let bonus = 15
        const cRoll = Math.random() * 100
        if (cRoll > 95) bonus = 50
        else if (cRoll > 85) bonus = 40
        else if (cRoll > 65) bonus = 30
        else if (cRoll > 40) bonus = 25
        else bonus = 15

        await tx.execute({
          sql: `UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ? WHERE telegram_id = ?`,
          args: [bonus, tid]
        })
        rewardType = 'bonus_gems'
        rewardDetails = `¡Has ganado ${bonus} Mensajes de Chat!`
        itemKey = String(bonus)
      }

      // ✅ Registramos la tirada (si es gratis, cost_gems será 0)
      await tx.execute({
        sql: `INSERT INTO gacha_history (user_id, cost_gems, reward_tier, reward_details) VALUES (?, ?, ?, ?)`,
        args: [tid, cost, tier, `${rewardType}:${rewardDetails}`]
      })

      await tx.commit()

      if (cost > 0) {
        await insertGemTransaction({
          telegram_id: tid,
          amount: -cost,
          transaction_type: 'gacha_spin',
          description: `Tirada de ruleta (${tier})`
        })
      }

      return NextResponse.json({
        success: true,
        tier,
        reward_type: rewardType,
        reward_details: rewardDetails,
        item_key: itemKey,
        remaining_gems: Number(debit.rows[0]?.gems || 0),
        is_free_spin: isFreeSpin // ✅ Enviamos esto al frontend por si quieres mostrarlo
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
