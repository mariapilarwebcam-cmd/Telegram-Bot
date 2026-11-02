import { Address, Cell, Dictionary, loadMessage, loadTransaction } from '@ton/core'
import type { VipPaymentInput } from './vip-payments'

// Mainnet only. Same USDT master as the existing VIP route; never client supplied.
const USDT_MASTER = Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs')
const MAX_NODES = 64
type Json = Record<string, unknown>
type CryptoEvidence = Extract<VipPaymentInput, { method: 'crypto' }>

export interface TonVipInvoice {
  reference: string
  telegramId: string
  plan: CryptoEvidence['plan']
  expectedAmountUnits: number
}

export interface TonVipVerifierDependencies {
  fetch: typeof fetch
  recipient: string
  apiKey?: string
  // Advisory duplicate check only. The permanent ledger's UNIQUE constraints
  // and interactive transaction remain authoritative against concurrent calls.
  isPaymentProcessed: (scope: string, paymentId: string) => Promise<boolean>
}

export type TonVipVerification =
  | { status: 'verified'; evidence: CryptoEvidence }
  | { status: 'rejected'; reason: string }

class VerificationError extends Error {}
function fail(reason: string): never { throw new VerificationError(reason) }
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_provider_data')
  return value as Json
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) fail('invalid_hash')
  return value.toLowerCase()
}
function boc(value: unknown): Cell {
  if (typeof value !== 'string' || value.length > 2000000 || !/^(?:[0-9a-fA-F]{2})+$/.test(value)) {
    fail('invalid_boc')
  }
  const cells = Cell.fromBoc(Buffer.from(value, 'hex'))
  if (cells.length !== 1 || cells[0].isExotic) fail('invalid_boc')
  return cells[0]
}
function address(value: unknown): Address {
  if (typeof value !== 'string') fail('invalid_address')
  // Friendly testnet flags must not be silently stripped on a mainnet verifier.
  if (Address.isFriendly(value) && Address.parseFriendly(value).isTestOnly) fail('wrong_network')
  return Address.parse(value)
}

interface Node {
  id: string
  account: Address
  tx: ReturnType<typeof loadTransaction>
  incoming?: Cell
  outgoing: Cell[]
  children: Node[]
}

/**
 * Trust boundary: TonAPI's MAINNET blockchain index/get-method service is the
 * chain authority (not a light-client proof verifier). No event actions or
 * decoded_body fields are trusted. Sources reviewed for this implementation:
 * tonkeeper/opentonapi api/openapi.yml: Trace, Transaction.raw (hex BOC),
 * MethodExecutionResult; docs.tonapi.io/academy/transaction-tracking;
 * ton-blockchain/TEPs text/0074-jettons-standard.md.
 * Finality means non-emulated, on-chain transactions and every outgoing
 * internal message consumed by a linked child, recursively. Missing data is
 * NEVER interpreted as payment success. This does not invent confirmations
 * from elapsed time or claim independent validator-signature verification.
 *
 * invoice MUST be loaded by the caller from vip_invoices using authenticated
 * identity. traceId is only a discovery hint, never payment authority.
 */
export async function verifyTonVipPayment(
  dependencies: TonVipVerifierDependencies,
  invoice: TonVipInvoice,
  traceId: string
): Promise<TonVipVerification> {
  try {
    if (!['weekly', 'monthly', 'quarterly', 'annual'].includes(invoice.plan) ||
        !/^\d+$/.test(invoice.telegramId) ||
        !invoice.reference.startsWith(`VIP_${invoice.plan}_${invoice.telegramId}_`) ||
        !Number.isSafeInteger(invoice.expectedAmountUnits) || invoice.expectedAmountUnits <= 0) {
      fail('invalid_invoice')
    }
    const recipient = address(dependencies.recipient)
    const scope = `ton:mainnet:jetton:${USDT_MASTER.toRawString()}`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (dependencies.apiKey) headers.Authorization = `Bearer ${dependencies.apiKey}`
    async function get(path: string): Promise<Json> {
      const response = await dependencies.fetch(`https://tonapi.io/v2${path}`, {
        headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
      })
      if (response.status === 404) fail('not_found_or_incomplete')
      if (!response.ok) fail('provider_unavailable')
      return object(await response.json())
    }

    // Ask the real USDT MASTER for the configured owner's jetton wallet.
    // A wallet that merely claims USDT in get_wallet_data is not sufficient.
    const method = await get(`/blockchain/accounts/${encodeURIComponent(USDT_MASTER.toRawString())}` +
      `/methods/get_wallet_address?args=${encodeURIComponent(recipient.toRawString())}`)
    if (method.success !== true || method.exit_code !== 0 ||
        !Array.isArray(method.stack) || method.stack.length !== 1) fail('wallet_unproven')
    const item = object(method.stack[0])
    if (item.type !== 'cell' || typeof item.cell !== 'string') fail('wallet_unproven')
    const walletSlice = boc(item.cell).beginParse()
    const wallet = walletSlice.loadAddress()
    walletSlice.endParse()

    const seenTransactions = new Set<string>()
    const seenMessages = new Set<string>()
    const all: Node[] = []
    async function readNode(value: unknown, depth: number): Promise<Node> {
      if (depth > MAX_NODES || all.length >= MAX_NODES) fail('trace_too_large')
      const data = object(value)
      if (data.emulated !== undefined && data.emulated !== false) fail('trace_not_finalized')
      const summary = object(data.transaction)
      const id = hash(summary.hash)
      if (seenTransactions.has(id)) fail('duplicate_transaction')
      seenTransactions.add(id)
      // A trace can contain emulation: independently require the immutable
      // transaction from the blockchain endpoint, not just emulated:false.
      const chain = await get(`/blockchain/transactions/${id}`)
      if (hash(chain.hash) !== id || chain.success !== true || chain.aborted !== false ||
          chain.destroyed !== false || typeof chain.block !== 'string' || !chain.block) {
        fail('unsuccessful_transaction')
      }
      const cell = boc(chain.raw)
      if (cell.hash().toString('hex') !== id) fail('transaction_hash_mismatch')
      const tx = loadTransaction(cell.beginParse())
      const account = address(object(chain.account).address)
      if (tx.address !== BigInt(`0x${account.hash.toString('hex')}`)) fail('account_mismatch')
      const d = tx.description
      if (d.type !== 'generic' || d.aborted || d.destroyed ||
          d.computePhase.type !== 'vm' || !d.computePhase.success ||
          ![0, 1].includes(d.computePhase.exitCode) ||
          (d.actionPhase && (!d.actionPhase.success || !d.actionPhase.valid ||
            d.actionPhase.noFunds || d.actionPhase.resultCode !== 0 ||
            d.actionPhase.skippedActions !== 0)) || d.bouncePhase) fail('unsuccessful_transaction')

      // Keep ORIGINAL message cells. Re-serializing loadMessage() can change
      // inline/ref layout and therefore its hash even with identical contents.
      const fields = cell.beginParse()
      fields.skip(4 + 256 + 64 + 256 + 64 + 32 + 15 + 2 + 2)
      const messages = fields.loadRef().beginParse()
      const incoming = messages.loadBit() ? messages.loadRef() : undefined
      const dictionary = messages.loadDict(Dictionary.Keys.Uint(15), Dictionary.Values.Cell())
      messages.endParse()
      const outgoing = [...dictionary.values()]
      if (outgoing.length !== tx.outMessagesCount) fail('message_count_mismatch')
      for (const message of outgoing) {
        const parsed = loadMessage(message.beginParse())
        if (parsed.info.type === 'internal' &&
            (!parsed.info.src.equals(account) || parsed.info.bounced)) fail('invalid_message')
      }
      const node: Node = { id, account, tx, incoming, outgoing, children: [] }
      all.push(node)
      if (data.children !== undefined && !Array.isArray(data.children)) fail('invalid_trace')
      for (const child of (data.children || []) as unknown[]) node.children.push(await readNode(child, depth + 1))

      const internal = outgoing.filter(c => loadMessage(c.beginParse()).info.type === 'internal')
      if (internal.length !== node.children.length) fail('trace_not_finalized')
      const remaining = new Map(internal.map(c => [c.hash().toString('hex'), c]))
      if (remaining.size !== internal.length) fail('duplicate_message')
      for (const child of node.children) {
        if (!child.incoming) fail('unlinked_child')
        const messageId = child.incoming.hash().toString('hex')
        const original = remaining.get(messageId)
        if (!original || seenMessages.has(messageId)) fail('unlinked_or_duplicate_message')
        const info = loadMessage(original.beginParse()).info
        if (info.type !== 'internal' || !info.dest.equals(child.account)) fail('destination_mismatch')
        seenMessages.add(messageId)
        remaining.delete(messageId)
      }
      return node
    }
    await readNode(await get(`/traces/${hash(traceId)}`), 0)

    const candidates: Array<{ id: string; amount: number }> = []
    for (const node of all) {
      if (!node.account.equals(wallet) || !node.incoming) continue
      const msg = loadMessage(node.incoming.beginParse())
      if (msg.info.type !== 'internal' || msg.info.bounced || !msg.info.dest.equals(wallet)) continue
      const body = msg.body.beginParse()
      if (body.remainingBits < 32 || body.loadUint(32) !== 0x178d4519) continue
      // internal_transfer (TEP-74 reference implementation), processed by the
      // authentic recipient wallet. Successful execution authenticates sender.
      body.loadUintBig(64) // query_id is NOT a unique payment identity
      const amount = body.loadCoins()
      body.loadAddress() // original sender/owner, not the authenticated app user
      body.loadMaybeAddress() // response address
      body.loadCoins() // forward TON; receipt does not require a notification
      const payload = body.loadBit() ? body.loadRef().beginParse() : body
      if (payload !== body) body.endParse()
      if (payload.remainingBits < 32 || payload.loadUint(32) !== 0) continue
      const reference = payload.loadStringTail()
      if (reference !== invoice.reference) continue
      if (amount <= BigInt(0) || amount > BigInt(Number.MAX_SAFE_INTEGER)) fail('invalid_amount')
      candidates.push({ id: node.id, amount: Number(amount) })
    }
    if (candidates.length === 0) fail('payment_not_found')
    if (candidates.length !== 1) fail('ambiguous_payment')
    const payment = candidates[0]
    if (payment.amount < invoice.expectedAmountUnits - 1000) fail('amount_mismatch')
    // A TON transaction consumes exactly one inbound message. The receiving
    // wallet transaction hash uniquely identifies this individual transfer,
    // including multiple transfers within the same trace. No action index.
    const providerPaymentId = payment.id
    if (await dependencies.isPaymentProcessed(scope, providerPaymentId)) fail('duplicate_payment')
    return {
      status: 'verified', evidence: {
        method: 'crypto', reference: invoice.reference, telegramId: invoice.telegramId,
        plan: invoice.plan, currency: 'USDT', paidAmountUnits: payment.amount,
        paymentScope: scope, providerPaymentId,
      },
    }
  } catch (error) {
    return { status: 'rejected', reason: error instanceof VerificationError
      ? error.message : 'verification_unavailable_or_malformed' }
  }
}