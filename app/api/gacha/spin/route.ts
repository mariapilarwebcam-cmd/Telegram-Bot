// app/api/gacha/spin/route.ts
import { NextResponse } from 'next/server'
import { db, queryOne, execute } from '@/lib/turso'
import { ensureUser, insertGemTransaction } from '@/lib/db-queries'

const COST_GEMS = 50

const GACHA_CHARACTERS_FEMALE = ['succubus', 'fallen_angel', 'werewolf_f', 'cyborg_assassin']
const GACHA_CHARACTERS_MALE = ['demon_lord', 'dragon_lord', 'werewolf_m', 'incubus_lord']

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const user = await ensureUser(tid)
    if (!user) return NextResponse.json({ error: 'Error cargando cuenta' }, { status: 500 })

    const tx = await db.transaction('write')

    try {
      // 1. Cobrar las gemas
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
        // ✅ MEJORA PITY: En la tirada 10, aumentamos un poco la probabilidad de Legendario/Mítico
        const pityRoll = Math.random() * 100
        if (pityRoll < 1.5) {
          tier = 'mythic'      // 1.5% en la tirada 10
        } else if (pityRoll < 15.0) {
          tier = 'legendary'   // 13.5% en la tirada 10
        } else {
          tier = 'epic'        // 85% en la tirada 10
        }
      } else if (roll < 0.5) {
        tier = 'mythic' // 0.5%
      } else if (roll < 1.5) {
        tier = 'legendary' // 1.0%
      } else if (roll < 6.0) {
        tier = 'epic' // 4.5%
      } else if (roll < 30.0) {
        tier = 'rare' // 24%
      } else {
        tier = 'common' // 70%
      }

      // 4. Asignar Premio
      if (tier === 'mythic' || tier === 'legendary') {
        const isFemale = user.interested_in !== 'male'
        const pool = isFemale ? GACHA_CHARACTERS_FEMALE : GACHA_CHARACTERS_MALE
        const char = pool[Math.floor(Math.random() * pool.length)]

        // ✅ FIX: Verificar si ya tiene este personaje
        const alreadyOwned = await tx.execute({
          sql: `SELECT id FROM user_inventory WHERE user_id = ? AND item_type = 'gacha_character' AND item_key = ? LIMIT 1`,
          args: [tid, char]
        })

        if (alreadyOwned.rows.length > 0) {
          // Ya lo tiene: Le damos una compensación de 100 Gemas de Chat
          const compensation = 100 
          await tx.execute({
            sql: `UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ? WHERE telegram_id = ?`,
            args: [compensation, tid]
          })
          rewardType = 'bonus_gems'
          rewardDetails = `¡Ya tenías a ${char}! Te compensamos con ${compensation} Mensajes de Chat.`
          itemKey = String(compensation)
        } else {
          // Es nuevo: Lo guardamos
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
          // ✅ OUTFIT PONDERADO POR RAREZA (Usando la DB)
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

            // ✅ FIX: Verificar si ya tiene este outfit
            const alreadyOwnedOutfit = await tx.execute({
              sql: `SELECT id FROM user_inventory WHERE user_id = ? AND item_type = 'outfit' AND item_key = ? LIMIT 1`,
              args: [tid, outfitId]
            })

            if (alreadyOwnedOutfit.rows.length > 0) {
              // Ya lo tiene: Compensación de 40 Gemas de Chat
              const compensation = 40 
              await tx.execute({
                sql: `UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ? WHERE telegram_id = ?`,
                args: [compensation, tid]
              })
              rewardType = 'bonus_gems'
              rewardDetails = `¡Ya tenías el Outfit "${o.name}"! Te compensamos con ${compensation} Mensajes de Chat.`
              itemKey = String(compensation)
            } else {
              // Es nuevo: Lo guardamos
              await tx.execute({
                sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'outfit', ?)`,
                args: [tid, outfitId]
              })

              const rarityPrefix =
                targetRarity === 'legendary' ? '🔥 ¡OUTFIT LEGENDARIO! ' :
                targetRarity === 'epic'      ? '💜 ' : ''

              rewardType = 'outfit'
              rewardDetails = `${rarityPrefix}¡${o.name}!`
              itemKey = outfitId
            }
          } else {
            // Fallback final si la tabla gacha_outfits está vacía
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
          // 33% Foto Nivel 3/4
          await tx.execute({
            sql: `INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'photo_token', 'level_34')`,
            args: [tid]
          })
          rewardType = 'photo_token'
          rewardDetails = '¡Foto Sorpresa (Nivel 3 o 4)!'
        } else if (rareRoll < 66) {
          // 33% Audio Token (1 o 2)
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
          // 34% Gemas de Chat
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
        // Común: 15 a 50 Gemas de Chat
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

      await tx.execute({
        sql: `INSERT INTO gacha_history (user_id, cost_gems, reward_tier, reward_details) VALUES (?, ?, ?, ?)`,
        args: [tid, COST_GEMS, tier, `${rewardType}:${rewardDetails}`]
      })

      await tx.commit()

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
