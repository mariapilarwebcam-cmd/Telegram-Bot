// No credentials, network, DB, env loading or application routes.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const core = require('@ton/core')
const { Address, beginCell, Dictionary, storeTransaction, storeMessage } = core
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(readFileSync(
  path.resolve(__dirname, '../lib/ton-vip-verifier.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  exports: exportsObject, Buffer, AbortSignal,
  require(name) {
    assert.equal(name, '@ton/core')
    return core
  },
})
const { verifyTonVipPayment } = exportsObject
const addr = n => new Address(0, Buffer.alloc(32, n))
const owner = addr(1)
const wallet = addr(2)
const sender = addr(3)
const invoice = {
  reference: 'VIP_weekly_123_987', telegramId: '123', plan: 'weekly', expectedAmountUnits: 2000000,
}

function transfer(reference = invoice.reference, amount = 2000000n, nonce = 1, inline = false) {
  const payload = beginCell().storeUint(0, 32).storeStringTail(reference).endCell()
  const builder = beginCell().storeUint(0x178d4519, 32).storeUint(99, 64)
    .storeCoins(amount).storeAddress(sender).storeAddress(null).storeCoins(0).storeBit(!inline)
  if (inline) builder.storeSlice(payload.beginParse())
  else builder.storeRef(payload)
  return {
    info: {
      type: 'internal', ihrDisabled: true, bounce: true, bounced: false,
      src: sender, dest: wallet, value: { coins: 1000000n },
      ihrFee: 0n, forwardFee: 0n, createdLt: BigInt(nonce), createdAt: 100,
    },
    body: builder.endCell(),
  }
}

let lt = 1n
function transaction(account, incoming, outgoing = [], patch = {}) {
  const dict = Dictionary.empty(Dictionary.Keys.Uint(15), {
    serialize(message, builder) {
      builder.storeRef(beginCell().store(storeMessage(message)).endCell())
    },
    parse(slice) { return core.loadMessage(slice.loadRef().beginParse()) },
  })
  outgoing.forEach((msg, i) => dict.set(i, msg))
  const description = {
    type: 'generic', creditFirst: false, aborted: false, destroyed: false,
    computePhase: {
      type: 'vm', success: true, messageStateUsed: false, accountActivated: false,
      gasFees: 0n, gasUsed: 1n, gasLimit: 100n, mode: 0, exitCode: 0,
      vmSteps: 1, vmInitStateHash: 0n, vmFinalStateHash: 0n,
    },
  }
  const data = {
    address: BigInt(`0x${account.hash.toString('hex')}`), lt: lt++,
    prevTransactionHash: 0n, prevTransactionLt: 0n, now: 100,
    outMessagesCount: outgoing.length, oldStatus: 'active', endStatus: 'active',
    inMessage: incoming, outMessages: dict, totalFees: { coins: 0n },
    stateUpdate: { oldHash: Buffer.alloc(32), newHash: Buffer.alloc(32) },
    description, ...patch,
  }
  const cell = beginCell().store(storeTransaction(data)).endCell()
  return {
    hash: cell.hash().toString('hex'), success: true, aborted: false, destroyed: false,
    account: { address: account.toRawString() }, block: '(0,8000000000000000,123)',
    raw: cell.toBoc().toString('hex'),
  }
}

function fixture(messages = [transfer()], options = {}) {
  const children = messages.map(message => ({
    transaction: transaction(message.info.dest, message), children: [],
  }))
  const root = {
    transaction: transaction(sender, undefined, messages), children,
  }
  const transactions = new Map([root, ...children].map(node => [node.transaction.hash, node.transaction]))
  const calls = []
  const dependencies = {
    recipient: owner.toString(),
    isPaymentProcessed: async () => false,
    async fetch(url, init) {
      const u = new URL(url)
      assert.equal(u.origin, 'https://tonapi.io')
      assert.equal(init.redirect, 'error')
      calls.push(u.pathname)
      let body
      let status = 200
      if (u.pathname.endsWith('/methods/get_wallet_address')) {
        assert.equal(u.searchParams.get('args'), owner.toRawString())
        assert.ok(decodeURIComponent(u.pathname).includes(
          Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs').toRawString()))
        body = { success: true, exit_code: 0, stack: [{
          type: 'cell', cell: beginCell().storeAddress(wallet).endCell().toBoc().toString('hex'),
        }] }
      } else if (u.pathname.includes('/traces/')) body = root
      else if (u.pathname.includes('/blockchain/transactions/')) {
        body = transactions.get(u.pathname.split('/').pop())
        if (!body) status = 404
      } else assert.fail(`Unexpected request ${url}`)
      if (options.response) ({ body, status } = options.response(u, body, status))
      return { ok: status === 200, status, json: async () => body }
    },
  }
  return { root, transactions, dependencies, calls,
    verify: (inv = invoice) => verifyTonVipPayment(dependencies, inv, root.transaction.hash) }
}

test('valid receiving transaction yields canonical per-transfer identity and actual amount', async () => {
  const f = fixture()
  const result = await f.verify()
  assert.equal(result.status, 'verified')
  assert.equal(result.evidence.providerPaymentId, f.root.children[0].transaction.hash)
  assert.equal(result.evidence.paidAmountUnits, 2000000)
  assert.equal(result.evidence.telegramId, '123')
  assert.ok(result.evidence.paymentScope.startsWith('ton:mainnet:jetton:'))
})

test('inline forward payload and tolerance boundary accepted, no new upper cap', async () => {
  for (const amount of [1999000n, 9000000000n]) {
    const f = fixture([transfer(invoice.reference, amount, 1, true)])
    assert.equal((await f.verify()).status, 'verified')
  }
})

test('underpayment, zero and unsafe amount rejected', async () => {
  for (const amount of [1998999n, 0n, 9007199254740992n]) {
    assert.equal((await fixture([transfer(invoice.reference, amount)]).verify()).status, 'rejected')
  }
})

test('reference and receiving wallet must match; forged action annotations ignored', async () => {
  assert.equal((await fixture([transfer('VIP_weekly_999_987')]).verify()).status, 'rejected')
  const message = transfer()
  message.info.dest = addr(9)
  const f = fixture([message])
  f.root.actions = [{ type: 'JettonTransfer', status: 'ok', JettonTransfer: { comment: invoice.reference } }]
  assert.equal((await f.verify()).status, 'rejected')
})

test('multiple transfers in one trace keep independent transaction identities, unaffected by reordering', async () => {
  const second = { ...invoice, reference: 'VIP_weekly_123_other' }
  const f = fixture([transfer(), transfer(second.reference, 2500000n, 2)])
  const a = await f.verify()
  const b = await f.verify(second)
  assert.equal(a.status, 'verified')
  assert.equal(b.status, 'verified')
  assert.notEqual(a.evidence.providerPaymentId, b.evidence.providerPaymentId)
  f.root.children.reverse()
  assert.equal((await f.verify()).evidence.providerPaymentId, a.evidence.providerPaymentId)
})

test('multiple transfers for one invoice rejected as ambiguous; same query_id is not identity', async () => {
  assert.equal((await fixture([transfer(), transfer(invoice.reference, 2000000n, 2)]).verify()).reason,
    'ambiguous_payment')
})

test('already processed identity rejected; lookup errors fail closed', async () => {
  const f = fixture()
  f.dependencies.isPaymentProcessed = async (scope, id) => {
    assert.equal(id, f.root.children[0].transaction.hash)
    assert.ok(scope.includes('mainnet'))
    return true
  }
  assert.equal((await f.verify()).reason, 'duplicate_payment')
  f.dependencies.isPaymentProcessed = async () => { throw new Error('DB unavailable') }
  assert.equal((await f.verify()).status, 'rejected')
})

test('duplicate transaction nodes rejected', async () => {
  const f = fixture()
  f.root.children.push(f.root.children[0])
  assert.equal((await f.verify()).reason, 'duplicate_transaction')
})

test('emulated root or child rejected', async () => {
  for (const child of [false, true]) {
    const f = fixture()
    ;(child ? f.root.children[0] : f.root).emulated = true
    assert.equal((await f.verify()).reason, 'trace_not_finalized')
  }
})

test('missing children, omitted chain transactions or unlinked messages cannot imply finality', async () => {
  const f = fixture()
  f.root.children = []
  assert.equal((await f.verify()).reason, 'trace_not_finalized')
  const g = fixture()
  g.transactions.delete(g.root.children[0].transaction.hash)
  assert.equal((await g.verify()).reason, 'not_found_or_incomplete')
  const h = fixture()
  const replaced = transaction(wallet, transfer(invoice.reference, 2000000n, 333))
  h.transactions.set(replaced.hash, replaced)
  h.root.children[0].transaction = replaced
  assert.equal((await h.verify()).reason, 'unlinked_or_duplicate_message')
})

test('provider success false or raw BOC tampering rejected', async () => {
  const f = fixture()
  f.root.children[0].transaction.success = false
  assert.equal((await f.verify()).reason, 'unsuccessful_transaction')
  const g = fixture()
  g.root.children[0].transaction.raw = g.root.transaction.raw
  assert.equal((await g.verify()).reason, 'transaction_hash_mismatch')
})

test('failed underlying VM rejected even if provider claims success', async () => {
  const f = fixture()
  const failed = transaction(wallet, transfer(), [], {
    description: {
      type: 'generic', creditFirst: false, aborted: true, destroyed: false,
      computePhase: { type: 'skipped', reason: 'no-gas' },
    },
  })
  f.transactions.set(failed.hash, failed)
  f.root.children[0].transaction = failed
  assert.equal((await f.verify()).reason, 'unsuccessful_transaction')
})

test('bounced inbound message rejected', async () => {
  const msg = transfer()
  msg.info.bounced = true
  assert.equal((await fixture([msg]).verify()).status, 'rejected')
})

test('unproven USDT wallet, provider outage and malformed responses fail closed', async () => {
  for (const change of [
    () => ({ body: { success: false }, status: 200 }),
    () => ({ body: {}, status: 503 }),
    () => ({ body: null, status: 200 }),
  ]) assert.equal((await fixture(undefined, { response: change }).verify()).status, 'rejected')
})

test('invalid invoice or testnet recipient rejected before provider calls', async () => {
  const f = fixture()
  assert.equal((await f.verify({ ...invoice, expectedAmountUnits: NaN })).reason, 'invalid_invoice')
  assert.equal(f.calls.length, 0)
  f.dependencies.recipient = owner.toString({ testOnly: true })
  assert.equal((await f.verify()).reason, 'wrong_network')
  assert.equal(f.calls.length, 0)
})