import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {installDigest, sha256} from '../src/digest.ts'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

test('SHA-256 matches the standard at every padding boundary', () => {
  for (const length of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 100_000]) {
    const bytes = Uint8Array.from({length}, (_, index) => (index * 31 + length) & 0xff)
    assert.equal(hex(sha256(bytes)), createHash('sha256').update(bytes).digest('hex'), `${length} bytes`)
  }
  assert.equal(hex(sha256(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('a context without crypto.subtle gets digest for SHA-256 only; one with it is left alone', async () => {
  const scope = {crypto: {} as Crypto}
  assert.equal(installDigest(scope), true)
  const data = new TextEncoder().encode('projections')
  const digest = await scope.crypto.subtle.digest('SHA-256', data.subarray(2))
  assert.equal(hex(new Uint8Array(digest)), createHash('sha256').update('ojections').digest('hex'))
  await assert.rejects(scope.crypto.subtle.digest('SHA-1', data), {name: 'NotSupportedError'})
  assert.equal(installDigest(globalThis), false)
})
