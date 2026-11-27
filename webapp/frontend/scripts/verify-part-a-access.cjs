// Pure access-boundary checks: no server, user records or model requests.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require('typescript'), crypto = require('node:crypto')
const token = 'a'.repeat(64), actor = 'parta_link_' + 'b'.repeat(32)
const env = { HUMANOS_PARTA_MODE: '1', HUMANOS_PARTA_LINK_HASH: crypto.createHash('sha256').update(token).digest('hex'), HUMANOS_PARTA_LINK_ACTOR: actor }
let cookie
const context = { exports: {}, Buffer, process: {env}, require: (name) => {
  if (name === 'node:crypto') return crypto
  if (name === 'next/headers') return { cookies: () => ({get: () => cookie === undefined ? undefined : {value: cookie}}) }
  throw new Error(name)
}}
const code = ts.transpileModule(fs.readFileSync('src/lib/server/part-a-access.ts','utf8'), {compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
vm.runInNewContext(code, context)
const {validPartALink, getPartAActor} = context.exports
assert.equal(validPartALink(token),true)
for (const value of [undefined,'','a', 'b'.repeat(64),token+'/', 'a'.repeat(129)]) assert.equal(validPartALink(value),false)
assert.equal(getPartAActor(),null)
cookie=token;assert.equal(getPartAActor(),actor)
cookie='b'.repeat(64);assert.equal(getPartAActor(),null)
cookie=token;env.HUMANOS_PARTA_MODE='0';assert.equal(getPartAActor(),null)
env.HUMANOS_PARTA_MODE='1';env.HUMANOS_PARTA_LINK_HASH='';assert.equal(getPartAActor(),null)
env.HUMANOS_PARTA_LINK_HASH=crypto.createHash('sha256').update(token).digest('hex');env.HUMANOS_PARTA_LINK_ACTOR='';assert.equal(getPartAActor(),null)
console.log('Part A access checks passed: valid/invalid/missing token, missing config, disabled mode, cookie and actor.')
