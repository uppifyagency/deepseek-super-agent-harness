// config.ts: the harness home and its config file, parsed once at the boundary.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Budget, Repo } from './domain.ts'

/**
 * How a repo's events reach the router (article 3.1, per source):
 *   explicit:   only messages that address the harness (handle) from an allowed actor, plus follow-ups
 *   candidates: every human message from an allowed actor is a candidate for the LLM stage
 *   ignore:     nothing passes
 */
export type Listen = 'explicit' | 'candidates' | 'ignore'

export interface Speculative { maxPerDay: number; budget: Budget }

export interface RepoConfig {
  repo: Repo; listen: Listen; base: string
  speculative?: Speculative
  candidateMatch?: string
}

export interface HarnessConfig {
  home: string
  repos: readonly RepoConfig[]
  /** Logins whose messages may start work. Vlad first; bots never start work in the MVP. */
  allowedActors: readonly string[]
  /** How a message addresses the harness. `/harness` until a bot account exists (no @-mention of strangers). */
  handles: readonly string[]
  /** Hidden marker the harness appends to everything it posts; how its own comments are recognized. */
  marker: string
  /** Rotate the router session when a wake costs more than this (USD). Default in router.ts. */
  routerRotateAboveUsd?: number
  /** Frozen into each run.intended. Worker: Sol on the Codex login (Vlad, 02/11). */
  models: { worker: string; verifier: string }
  budget: Budget
  /** Keychain service holding the bot's GitHub token (unit 6 publish). */
  botKeychainService: string
  /** Attempts per ticket: a verifier FAIL starts the next one, up to this. */
  maxAttempts: number
  serviceLabel: string
  pstackDir: string
  /** The watchdog judges a live run after this many awake minutes without progress. */
  stuckAfterMin: number
}

export const DEFAULT_MODELS = { worker: 'openai-codex/gpt-6.1-sol:high', verifier: 'opus' }
export const DEFAULT_BUDGET: Budget = { maxCostUsd: 5, maxDurationMs: 45 * 60_000 }
export const DEFAULT_SPECULATIVE: Speculative = { maxPerDay: 3, budget: { maxCostUsd: 1, maxDurationMs: 20 * 60_000 } }

export const MARKER = '<!-- harness:'

const defaultHome = () => join(homedir(), '.harness')

export function harnessHome(): string {
  return process.env.HARNESS_HOME ?? defaultHome()
}

/** One label per home, so installing a second home never boots out the first one's daemon. */
function defaultServiceLabel(home: string): string {
  const path = resolve(home)
  return path === defaultHome() ? 'it.delera.harness' : `it.delera.harness.${createHash('sha256').update(path).digest('hex').slice(0, 8)}`
}

export const DEFAULT_PSTACK_DIR = join(homedir(), 'src/pstack-claude/plugins/pstack')

export function loadConfig(home = harnessHome()): HarnessConfig {
  return parseConfig(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as Record<string, unknown>, home)
}

export function parseConfig(raw: Record<string, unknown>, home: string): HarnessConfig {
  const repos = raw.repos
  if (!Array.isArray(repos) || repos.length === 0) throw new Error(`${home}/config.json: "repos" must be a non-empty array`)
  const parsed = repos.map((r) => {
    const x = typeof r === 'string' ? { repo: r, listen: 'explicit' } : (r as { repo: string; listen?: string; base?: string; candidateMatch?: string; speculative?: { enabled?: boolean; maxPerDay?: number; budget?: Partial<Budget> } })
    if (!/^[\w.-]+\/[\w.-]+$/.test(x.repo) || x.repo.split('/').some((part) => part === '.' || part === '..')) throw new Error(`bad repo "${x.repo}", expected owner/name`)
    const listen = (x.listen ?? 'explicit') as Listen
    if (!['explicit', 'candidates', 'ignore'].includes(listen)) throw new Error(`bad listen "${listen}" for ${x.repo}`)
    const out: RepoConfig = { repo: x.repo as Repo, listen, base: 'base' in x && x.base ? x.base : 'main' }
    if ('candidateMatch' in x && x.candidateMatch !== undefined) {
      try { new RegExp(x.candidateMatch) } catch (e) { throw new Error(`bad candidateMatch for ${x.repo}: ${(e as Error).message}`) }
      out.candidateMatch = x.candidateMatch
    }
    const sp = 'speculative' in x ? x.speculative : undefined
    if (sp !== undefined && typeof sp?.enabled !== 'boolean') throw new Error(`speculative on ${x.repo}: "enabled" must be true or false`)
    if (sp?.enabled) {
      if (listen !== 'candidates') throw new Error(`speculative on ${x.repo} needs listen "candidates", not "${listen}"`)
      const s: Speculative = { maxPerDay: sp.maxPerDay ?? DEFAULT_SPECULATIVE.maxPerDay, budget: { ...DEFAULT_SPECULATIVE.budget, ...sp.budget } }
      if (!Number.isInteger(s.maxPerDay) || s.maxPerDay <= 0) throw new Error(`speculative on ${x.repo}: "maxPerDay" must be a positive integer`)
      for (const [k, v] of Object.entries(s.budget)) {
        if (typeof v !== 'number' || !(v > 0) || !Number.isFinite(v)) throw new Error(`speculative on ${x.repo}: "budget.${k}" must be a positive number`)
      }
      out.speculative = s
    }
    return out
  })
  const models = (raw.models ?? {}) as Partial<HarnessConfig['models']>
  const budget = (raw.budget ?? {}) as Partial<Budget>
  const allowedActors = (raw.allowedActors ?? []) as string[]
  if (!Array.isArray(allowedActors) || allowedActors.length === 0) throw new Error(`${home}/config.json: "allowedActors" must list at least one login`)
  const serviceLabel = raw.serviceLabel ?? defaultServiceLabel(home)
  if (typeof serviceLabel !== 'string' || !/^[\w.-]+$/.test(serviceLabel)) throw new Error(`${home}/config.json: bad serviceLabel "${String(serviceLabel)}"`)
  // setup.ts writes it into a `security -i` line, which splits on spaces.
  const botKeychainService = raw.botKeychainService ?? 'harness-bot-github'
  if (typeof botKeychainService !== 'string' || !/^[\w.-]+$/.test(botKeychainService)) throw new Error(`${home}/config.json: bad botKeychainService "${String(botKeychainService)}"`)
  const pstackDir = typeof raw.pstackDir === 'string' ? resolve(raw.pstackDir) : raw.pstackDir ?? DEFAULT_PSTACK_DIR
  if (typeof pstackDir !== 'string' || !pstackDir.endsWith('/plugins/pstack')) throw new Error(`${home}/config.json: bad pstackDir "${String(raw.pstackDir)}", expected <pstack-claude clone>/plugins/pstack`)
  return {
    home,
    repos: parsed,
    allowedActors,
    handles: (raw.handles as string[] | undefined) ?? ['/harness'],
    marker: MARKER,
    routerRotateAboveUsd: typeof raw.routerRotateAboveUsd === 'number' ? raw.routerRotateAboveUsd : undefined,
    models: { ...DEFAULT_MODELS, ...models },
    budget: { ...DEFAULT_BUDGET, ...budget },
    botKeychainService,
    maxAttempts: typeof raw.maxAttempts === 'number' ? raw.maxAttempts : 2,
    serviceLabel,
    pstackDir,
    stuckAfterMin: typeof raw.stuckAfterMin === 'number' && raw.stuckAfterMin > 0 ? raw.stuckAfterMin : 15,
  }
}
