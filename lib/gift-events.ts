// B1 core. No routes, credentials, migrations or provider imports; disabled by default.
import { createHash, randomUUID } from 'node:crypto'
import type { Client, Transaction } from '@libsql/client'
import { getOutfitCompatibilityError } from './outfits'
type DB = Pick<Client, 'execute' | 'transaction'>
type SQL = Pick<Client, 'execute'>
type Row = Record<string, unknown>
export type Scope = { userId: string; characterId: number }
export type Identity = Scope & { eventId: number }
export type Artifact = { r2Key: string; blurR2Key: string; imageUrl: string; promptUsed: string; level: number }
export type Context = Readonly<Identity & { outfitKey: string; outfitName: string; outfitPrompt: string;
  characterName: string; archetype: string; gender: string }>
export type Claim = Readonly<{ kind: 'gift_claim' }>
export class GiftError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'GiftError' }
}
const stop = (code: string): never => { throw new GiftError(code) }
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const id = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
/** SQL INTEGER only: no strings, fractions or lossy bigint conversion. */
export function safeSqlId(value: unknown): number {
  if (id(value)) return value
  if (typeof value === 'bigint' && value > BigInt(0) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value)
  return stop('invalid_sql_id')
}
function scope(s: Scope) { if (!text(s.userId) || !id(s.characterId)) stop('invalid_identity') }
function identity(s: Identity) { scope(s); if (!id(s.eventId)) stop('invalid_identity') }
function exact(value: object, keys: string[]) {
  if (Object.keys(value).some(k => !keys.includes(k))) stop('unexpected_input')
}
const identityKeys = ['userId', 'characterId', 'eventId']
const expected: Record<string, string> = {
  gift_events: '9cb607925cfbd97e74c04c938eed2642de8248508e1828c1409a29b6104a84ab',
  gift_events_photo_recovery: '6857c9758f03876e5f76035fcca602e82678c7265850a3c8e03cfd8dbde3441f',
  gift_events_initial_state: '5221dfc63a2b92892fadf3b5018eba387017baa949722242fecb9b9f222a2fc9',
  gift_events_immutable_identity: '53b101ac09368c310b8b9c491c73133fe81c1c11ad0e047653233c76b3af50e3',
  gift_events_photo_transition: '76530073db874bf045a9aca7ea249c0e87e56c7a8c57207632e12e6c7571f061',
  gift_events_attempt_sequence: '90fb41a43ee53db363b2382b65efe47aa5bacda11aff922bf76f7cdb3a8a2e5c',
  gift_events_no_delete: '7c781163ef77537ce22e89ba71069a8772cb85148154826cf7861be24a78cf29',
  outfit_receipt_tracking: '179a09236c08e4a37a6e5102618e1baa26bc4e76d588a80ba99e2998e88e30f4',
  // Reviewed real export (B2); matching locally does not verify a remote destination.
  users: 'c27fae7f53c4b454ae66422adda0224f2830b28c343382c4e3be6d9bbf4bbfd3',
  user_inventory: 'daab08f22bcc479fa8e697ead3fe495b16e43c608271d09db9b5a71eacaf7db1',
  user_characters: 'd3294de703be9422683a023063bd738b1cb1ddae6a5cb9aef970b621a34e8788',
  conversation_history: '4df6bde3b058986bd23ac16ee19c75691d87e509b43b8cb2ca7b912229dd0f24',
  gacha_outfits: 'a446ea67904f988835184aad1fb4bf58a8e2f720a00af7b588966eb35d3107cb',
  generated_images: '653abc6cfe3408bbb5250eaece4303abd3eb240c398fbfa190c675eff17a0116',
  idx_conv_history_char: 'f7d68fcac82aef1904c245ae6e577a77bab9aecad613bba4c14f6d11c209faf7',
  idx_conv_history_created: '0632acf830809c7f1a9da5fe53f6825ff5936d391c4cc47c0b64bcde25d09d30',
  idx_conv_history_telegram: '657ace72ee74b67fecb9f16a9c1847129b5db5326d289e5c0400dd245c6387e1',
  idx_user_characters_active: '97a239bd834d1752246dae42fe84943fa3084fedc030c17b7d0202c262969e61',
  idx_user_characters_telegram_id: '93b5c08bc6da0777d3b1fe6e88cf95e1e07714ad1f13fb2a60c880b50d5c9a70',
  idx_users_age_verified: 'f47578c4bd7163b4f56940ec2a0f3a5ab010c26e1db0fcfb7da37de7274114e1',
  idx_users_referral_code: '25b1da4fee884247e166decf569a8250410ef78643266d938e2bc2780769771c',
  idx_users_telegram_id: '864a52517b0b845584a702d7584bb09071504ded338f794e973d82f9d9020cb7',
  idx_users_username: '6cb647ba449ccabf24e100820ba81d932f65d6e7dd4dfba9c062e0bed10d885e',
}
// Only this complete no-CASE definition is additionally reviewed. No remote repair.
// Equivalence relies on the unchanged NOT NULL status/count constraints in 007.
const reviewedAttemptSequence = `CREATE TRIGGER gift_events_attempt_sequence
BEFORE UPDATE ON gift_events
WHEN
    (
        NEW.photo_status = 'generating'
        AND (
            OLD.photo_status <> 'generating'
            OR NEW.claim_token IS NOT OLD.claim_token
        )
        AND NEW.attempt_count <> OLD.attempt_count + 1
    )
    OR
    (
        NOT (
            NEW.photo_status = 'generating'
            AND (
                OLD.photo_status <> 'generating'
                OR NEW.claim_token IS NOT OLD.claim_token
            )
        )
        AND NEW.attempt_count <> OLD.attempt_count
    )
BEGIN
    SELECT RAISE(ABORT, 'invalid gift attempt sequence');
END;`
function ddlHash(sql: string) {
  const normalized = sql.replace(/\bIF NOT EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim().replace(/;$/, '')
  return createHash('sha256').update(normalized).digest('hex')
}
const reviewedAttemptSequenceHash = ddlHash(reviewedAttemptSequence)
/** Read-only exact-DDL gate. Never migrates, repairs or caches success. */
export async function checkGiftSchema(db: SQL) {
  const rows = (await db.execute('SELECT name,type,tbl_name,sql FROM sqlite_schema')).rows as Row[]
  const issues: string[] = []
  for (const [name, hash] of Object.entries(expected)) {
    const row = rows.find(r => r.name === name)
    const actual = typeof row?.sql === 'string' ? ddlHash(row.sql) : ''
    const reviewedVariant = name === 'gift_events_attempt_sequence' && actual === reviewedAttemptSequenceHash
    if (!row || (actual !== hash && !reviewedVariant)) issues.push(`definition:${name}`)
  }
  for (const row of rows) {
    if (!(String(row.tbl_name) in expected) || String(row.name) in expected) continue
    if (row.type === 'index' && row.sql == null && String(row.name).startsWith('sqlite_autoindex_')) continue
    issues.push(`unreviewed:${String(row.name)}`)
  }
  return { compatible: issues.length === 0, issues, remoteVerified: false as const }
}
function view(row: Row) {
  return { id: safeSqlId(row.id), outfitKey: String(row.outfit_key), status: String(row.photo_status),
    attempts: Number(row.attempt_count), leaseUntil: row.lease_until == null ? null : Number(row.lease_until),
    thankYouMessageId: safeSqlId(row.thank_you_message_id), imageId: row.image_id == null ? null : safeSqlId(row.image_id),
    photoMessageId: row.photo_message_id == null ? null : safeSqlId(row.photo_message_id) }
}
async function owner(db: SQL, s: Scope): Promise<Row> {
  const row = (await db.execute({ sql: `SELECT c.*,u.first_name,u.language FROM user_characters c
    JOIN users u ON u.telegram_id=c.telegram_id WHERE c.id=? AND c.telegram_id=?`, args: [s.characterId, s.userId] })).rows[0]
  return row || stop('character_not_found')
}
async function event(db: SQL, s: Identity): Promise<Row> {
  const row = (await db.execute({ sql: 'SELECT * FROM gift_events WHERE id=? AND user_id=? AND character_id=?',
    args: [s.eventId, s.userId, s.characterId] })).rows[0]
  return row || stop('event_not_found')
}
async function message(tx: SQL, s: Scope, content: string) {
  const result = await tx.execute({ sql: `INSERT INTO conversation_history (telegram_id,character_id,role,content)
    VALUES (?,?,'assistant',?)`, args: [s.userId, s.characterId, content] })
  return safeSqlId(result.lastInsertRowid)
}
function wardrobe(row: Row): string[] {
  try {
    const value: unknown = JSON.parse(String(row.owned_outfits ?? '[]'))
    if (!Array.isArray(value) || value.some(v => !text(v))) return stop('invalid_wardrobe')
    return value
  } catch { return stop('invalid_wardrobe') }
}
const live = `id=? AND user_id=? AND character_id=? AND photo_status='generating'
  AND claim_token=? AND lease_until>unixepoch()`

type State = { identity: Identity; token: string; context: Context;
  phase: 'claimed' | 'running' | 'generated' | 'closed'; artifact?: Readonly<Artifact> }

/** Server identities only. Never expose worker or inject a generator from HTTP.
 * WeakMap capabilities cannot be reconstructed from JSON. SQL tokens stay here.
 * Artifacts are produced by the trusted generator, never accepted by finalize.
 */
export function createGiftEventService(db: DB, options: {
  env?: { GIFT_EVENTS_ENABLED?: string }; generate: (context: Context) => Promise<Artifact>
}) {
  const claims = new WeakMap<Claim, State>()
  async function transaction<T>(mode: 'read' | 'write', work: (tx: Transaction) => Promise<T>) {
    if ((options.env ?? process.env).GIFT_EVENTS_ENABLED !== 'true') stop('gift_events_disabled')
    const tx = await db.transaction(mode)
    try {
      if (!(await checkGiftSchema(tx)).compatible) stop('gift_schema_incompatible')
      const value = await work(tx)
      await tx.commit()
      return value
    } catch (error) {
      try { await tx.rollback() } catch { /* mandatory close below */ }
      throw error
    } finally { tx.close() }
  }
  function state(cap: Claim): State {
    const s = claims.get(cap)
    if (!s) return stop('claim_lost')
    if (s.phase === 'closed') return stop('claim_lost')
    return s
  }
  const args = (s: State) => [s.identity.eventId, s.identity.userId, s.identity.characterId, s.token]
  async function assertLive(tx: SQL, s: State) {
    await owner(tx, s.identity)
    if (!(await tx.execute({ sql: `SELECT id FROM gift_events WHERE ${live}`, args: args(s) })).rows[0]) stop('claim_lost')
  }
  async function markFailed(s: State, code: string) {
    const result = await transaction('write', async tx => {
      await assertLive(tx, s)
      const updated = await tx.execute({ sql: `UPDATE gift_events SET photo_status='failed',claim_token=NULL,
        lease_until=NULL,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE ${live} RETURNING *`, args: [code, ...args(s)] })
      if (!updated.rows[0]) return stop('claim_lost')
      return view(updated.rows[0])
    })
    s.phase = 'closed'
    return result
  }
  return {
    public: {
      async create(input: Scope & { outfitKey: string; idempotencyKey: string }) {
        exact(input, ['userId', 'characterId', 'outfitKey', 'idempotencyKey']); scope(input)
        if (!text(input.outfitKey) || !text(input.idempotencyKey)) stop('invalid_request')
        const s = { userId: input.userId, characterId: input.characterId,
          outfitKey: input.outfitKey, idempotencyKey: input.idempotencyKey }
        return transaction('write', async tx => {
          const c = await owner(tx, s)
          const keyed = (await tx.execute({ sql: 'SELECT * FROM gift_events WHERE user_id=? AND idempotency_key=?',
            args: [s.userId, s.idempotencyKey] })).rows[0]
          if (keyed) {
            if (safeSqlId(keyed.character_id) !== s.characterId || keyed.outfit_key !== s.outfitKey) stop('idempotency_conflict')
            return { kind: 'existing' as const, event: view(keyed) }
          }
          // A replay above is read-only recovery. Every new delivery/alternation must
          // pass this check inside the transaction before any inventory or character write.
          const compatibilityError = getOutfitCompatibilityError(s.outfitKey, c.gender)
          if (compatibilityError) stop(compatibilityError)
          const previous = (await tx.execute({ sql: 'SELECT * FROM gift_events WHERE user_id=? AND character_id=? AND outfit_key=?',
            args: [s.userId, s.characterId, s.outfitKey] })).rows[0]
          const owned = wardrobe(c)
          if (owned.includes(s.outfitKey)) {
            await tx.execute({ sql: 'UPDATE user_characters SET equipped_outfit=? WHERE id=? AND telegram_id=?',
              args: [s.outfitKey, s.characterId, s.userId] })
            return { kind: 'alternated' as const, event: previous ? view(previous) : null }
          }
          if (previous) stop('wardrobe_inconsistent')
          const outfit = (await tx.execute({ sql: 'SELECT name,prompt_tag FROM gacha_outfits WHERE id=?', args: [s.outfitKey] })).rows[0]
          if (!outfit || !text(outfit.name) || !text(outfit.prompt_tag, 10000)) stop('outfit_unavailable')
          const consumed = await tx.execute({ sql: `DELETE FROM user_inventory WHERE id=(SELECT id FROM user_inventory
            WHERE user_id=? AND item_type='outfit' AND item_key=? ORDER BY id LIMIT 1)
            AND user_id=? AND item_type='outfit' AND item_key=? RETURNING id`, args: [s.userId, s.outfitKey, s.userId, s.outfitKey] })
          if (consumed.rows.length !== 1) stop('inventory_unavailable')
          await tx.execute({ sql: 'UPDATE user_characters SET equipped_outfit=?,owned_outfits=? WHERE id=? AND telegram_id=?',
            args: [s.outfitKey, JSON.stringify([...owned, s.outfitKey]), s.characterId, s.userId] })
          const thanks = c.language === 'en'
            ? `${c.character_name}: Thank you, ${c.first_name || 'my dear'}, for ${outfit.name}! I want to show you how it looks on me.`
            : `${c.character_name}: ¡Gracias, ${c.first_name || 'cariño'}, por ${outfit.name}! Me hace ilusión enseñarte cómo me queda.`
          const thanksId = await message(tx, s, thanks)
          const inserted = await tx.execute({ sql: `INSERT INTO gift_events
            (user_id,character_id,outfit_key,idempotency_key,consumed_inventory_id,thank_you_message_id)
            VALUES (?,?,?,?,?,?) RETURNING *`, args: [s.userId, s.characterId, s.outfitKey, s.idempotencyKey, consumed.rows[0].id, thanksId] })
          return { kind: 'created' as const, event: view(inserted.rows[0]) }
        })
      },
      async get(input: Identity) {
        exact(input, identityKeys); identity(input)
        const s = { userId: input.userId, characterId: input.characterId, eventId: input.eventId }
        return transaction('read', async tx => { await owner(tx, s); return view(await event(tx, s)) })
      },
      async completed(input: Identity) {
        exact(input, identityKeys); identity(input)
        const s = { userId: input.userId, characterId: input.characterId, eventId: input.eventId }
        return transaction('read', async tx => {
          await owner(tx, s)
          const row = await event(tx, s)
          if (row.photo_status !== 'ready') stop('not_ready')
          const result = await tx.execute({ sql: `SELECT gi.r2_url,ch.content,ch.id FROM generated_images gi
            JOIN conversation_history ch ON ch.id=? AND ch.telegram_id=? AND ch.character_id=? AND ch.role='assistant'
            WHERE gi.id=?`, args: [safeSqlId(row.photo_message_id), s.userId, s.characterId, safeSqlId(row.image_id)] })
          if (!result.rows[0]) stop('reward_inconsistent')
          return { event: view(row), imageUrl: String(result.rows[0].r2_url),
            message: { id: safeSqlId(result.rows[0].id), content: String(result.rows[0].content) } }
        })
      },
      async list(input: Scope & { afterId?: number; limit?: number }) {
        exact(input, ['userId', 'characterId', 'afterId', 'limit']); scope(input)
        const s = { userId: input.userId, characterId: input.characterId }, after = input.afterId ?? 0, limit = input.limit ?? 50
        if (!Number.isSafeInteger(after) || after < 0 || !id(limit) || limit > 100) stop('invalid_page')
        return transaction('read', async tx => {
          await owner(tx, s)
          const rows = (await tx.execute({ sql: `SELECT * FROM gift_events WHERE user_id=? AND character_id=? AND id>?
            ORDER BY id LIMIT ?`, args: [s.userId, s.characterId, after, limit + 1] })).rows
          return { events: rows.slice(0, limit).map(view), nextAfterId: rows.length > limit ? safeSqlId(rows[limit - 1].id) : null }
        })
      },
    },
    worker: {
      async claim(input: Identity, leaseSeconds = 120) {
        exact(input, identityKeys); identity(input)
        const s = { userId: input.userId, characterId: input.characterId, eventId: input.eventId }
        if (!id(leaseSeconds) || leaseSeconds > 300) stop('invalid_lease')
        const result = await transaction('write', async tx => {
          const c = await owner(tx, s), row = await event(tx, s)
          if (row.photo_status === 'ready') return { kind: 'ready' as const, event: view(row) }
          const outfit = (await tx.execute({ sql: 'SELECT name,prompt_tag FROM gacha_outfits WHERE id=?', args: [String(row.outfit_key)] })).rows[0]
          if (!outfit || !text(outfit.prompt_tag, 10000)) stop('outfit_unavailable')
          const token = randomUUID()
          const updated = (await tx.execute({ sql: `UPDATE gift_events SET photo_status='generating',claim_token=?,
            lease_until=unixepoch()+?,attempt_count=attempt_count+1,last_error=NULL,updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND user_id=? AND character_id=? AND (photo_status IN ('pending','failed')
            OR (photo_status='generating' AND lease_until<=unixepoch())) RETURNING *`, args: [token, leaseSeconds, s.eventId, s.userId, s.characterId] })).rows[0]
          if (!updated) return { kind: 'busy' as const, event: view(row) }
          const context = Object.freeze({ ...s, outfitKey: String(row.outfit_key), outfitName: String(outfit.name),
            outfitPrompt: String(outfit.prompt_tag), characterName: String(c.character_name), archetype: String(c.archetype), gender: String(c.gender) })
          return { kind: 'claimed' as const, event: view(updated), state: { identity: s, token, context, phase: 'claimed' as const } }
        })
        if (result.kind !== 'claimed') return result
        const capability: Claim = Object.freeze({ kind: 'gift_claim' })
        claims.set(capability, result.state)
        return { kind: 'claimed' as const, event: result.event, capability }
      },
      async generate(cap: Claim) {
        const s = state(cap)
        if (s.phase !== 'claimed') stop('generation_already_started')
        s.phase = 'running'
        try {
          await transaction('read', tx => assertLive(tx, s))
          // No open DB transaction during generation or storage.
          const a = await options.generate(s.context)
          if (!a || !text(a.r2Key, 1000) || !text(a.blurR2Key, 1000) || !text(a.promptUsed, 30000) ||
              !text(a.imageUrl, 4000) || !/^https:\/\/[^\s)]+$/.test(a.imageUrl) || !id(a.level) || a.level > 5) stop('invalid_artifact')
          s.artifact = Object.freeze({ r2Key: a.r2Key, blurR2Key: a.blurR2Key, imageUrl: a.imageUrl, promptUsed: a.promptUsed, level: a.level })
          s.phase = 'generated'
        } catch (original) {
          try { await markFailed(s, 'generation_failed') }
          catch (cleanup) {
            if (!(cleanup instanceof GiftError && cleanup.code === 'claim_lost')) {
              throw new AggregateError([original, cleanup], 'generation_and_failure_persistence_failed')
            }
            s.phase = 'closed'
          }
          throw original
        }
      },
      async finalize(cap: Claim) {
        const s = state(cap)
        if (s.phase !== 'generated' || !s.artifact) stop('artifact_missing')
        const a = s.artifact ?? stop('artifact_missing')
        const result = await transaction('write', async tx => {
          await assertLive(tx, s) // No ready shortcut; every publication is fenced.
          const c = s.context
          const image = await tx.execute({ sql: `INSERT INTO generated_images
            (tag_key,archetype,gender,mood,level_bucket,r2_key,blur_r2_key,r2_url,prompt_used,status,max_level,character_key)
            VALUES (?,?,?,'gift',?,?,?,?,?,'active',?,?)`, args: [`gift:${s.identity.eventId}:${c.outfitKey}`,
            c.archetype, c.gender, String(a.level), a.r2Key, a.blurR2Key, a.imageUrl, a.promptUsed, a.level, `${c.gender}_${c.archetype}`] })
          const imageId = safeSqlId(image.lastInsertRowid)
          const photoId = await message(tx, s.identity, `${c.characterName}:\n\n![Regalo](${a.imageUrl})`)
          const updated = await tx.execute({ sql: `UPDATE gift_events SET photo_status='ready',claim_token=NULL,
            lease_until=NULL,image_id=?,photo_message_id=?,completed_at=unixepoch(),last_error=NULL,
            updated_at=CURRENT_TIMESTAMP WHERE ${live} RETURNING *`, args: [imageId, photoId, ...args(s)] })
          if (!updated.rows[0]) stop('claim_lost')
          return view(updated.rows[0])
        })
        s.phase = 'closed'
        return result
      },
      async fail(cap: Claim, code: string) {
        const s = state(cap)
        if (!/^[a-z0-9_]{1,80}$/.test(code)) stop('invalid_failure_code')
        return markFailed(s, code)
      },
    },
  }
}