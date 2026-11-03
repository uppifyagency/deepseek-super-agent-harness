// domain.ts: the harness's own vocabulary and its pure policy. No I/O, no Atomic import.
// Everything Atomic already models (run status, budgets, prompts, stage transcripts) is NOT here:
// it is read from Atomic. This file holds only what Atomic lacks.

type Brand<T, B extends string> = T & { readonly __brand: B }

export type Hash = Brand<string, 'Hash'>            // sha256 of canonical JSON, 32 hex
export type FactId = Brand<string, 'FactId'>        // = idOf(kind, by, body); no timestamp, replay-stable
export type TicketId = Brand<string, 'TicketId'>    // = hash('ticket', FactId of the opening `decided`)
export type RunId = Brand<string, 'RunId'>          // Atomic workflow run UUID; owned by Atomic
export type RepoSlug = Brand<string, 'RepoSlug'>    // "owner/name", parsed from config, checked against the allowlist
export type ThreadKey = Brand<string, 'ThreadKey'>  // "gh:owner/name#12"; GitHub issue and PR share the number space

/** Inline & Spill: anything longer than INLINE_CHARS keeps a preview here and its body in the blob table. */
export interface Text { preview: string; length: number; blob?: Hash }
export const INLINE_CHARS = 400

// ---------- roles ----------

/**
 * Who is acting, derived once per session by `roleOf` (extension.ts) and never passed by the model.
 * router: the process holding ~/.harness/router.lock (the long-lived main session)
 * worker / verifier: a stage of the `ticket` workflow (orchestrationContext.workflowStageName)
 * child: a pstack `agent` subprocess (no stage context, no lock): treated as a worker
 * watchdog: `atomic -p --harness-role watchdog` launched by launchd
 */
export type Role = 'router' | 'worker' | 'verifier' | 'child' | 'watchdog'

// ---------- facts: THE list (store.ts appends, views read) ----------

export interface Trigger {
  thread: ThreadKey
  repo: RepoSlug
  native: { id: string; updatedAt: string }  // GitHub node id + updated_at: an edit is a new trigger
  actor: string                               // GitHub login
  kind: 'issue' | 'comment' | 'review' | 'review_comment' | 'pr'
  text: Text                                  // untrusted
  mentionsBot: boolean
  url: string
}

export type AcceptMode = 'off' | 'observe' | 'auto'
export interface Policy {
  repos: Record<RepoSlug, { mode: AcceptMode; budget: Budget; baseBranch: string; path: string }>
  humans: string[]          // logins whose words can grant a Mandate (MVP: ['<utente>'])
  botLogin: string          // login replies are posted as; MVP = Vlad's own, so self-detection is by REPLY_MARKER
}

export interface Budget { maxDurationMs: number; maxCost: number }   // forwarded to Atomic RunOpts.budget

/** Immutable grant computed in code from the triggers, never from the model's say-so. */
export interface Mandate { repo: RepoSlug; grantedBy: string; basis: 'mention' | 'assigned' | 'followup'; policy: Hash }

export type Visibility = 'visible' | 'silent'  // silent = speculative "reproduce and fix" (no asks, no ack)

export type Decision =
  | { kind: 'open'; ticket: TicketId; title: string; brief: Text; visibility: Visibility }
  | { kind: 'observe'; wouldOpen: { title: string; brief: Text } }   // mode 'observe': recorded, never run
  | { kind: 'route'; ticket: TicketId }
  | { kind: 'ignore'; reason: string }

/** Built only by `independentVerdict()`: rejects a verdict whose session wrote the code. */
export type IndependentVerdict = Brand<{
  repo: RepoSlug; headSha: string; baseSha: string; patchId: string
  verdict: 'PASS' | 'PASS+NOTES' | 'FAIL'
  evidence: string; verifierSession: string; writerSession: string
  sameModel: true            // honest: every role is opus under Vlad's override
}, 'IndependentVerdict'>

export type ReplyPurpose = 'ack' | 'question' | 'result' | 'answer'
export type ReplyText = Brand<string, 'ReplyText'>     // only from composeReply

interface Kinds {
  'trigger':        { by: 'code';     body: Trigger }
  'decided':        { by: 'router';   body: { triggers: FactId[]; decision: Decision; mandate?: Mandate } }
  'run.linked':     { by: 'router';   body: { ticket: TicketId; run: RunId; attempt: number } }
  'subscribed':     { by: 'router';   body: { ticket: TicketId; thread: ThreadKey } }
  'input.routed':   { by: 'code';     body: { ticket: TicketId; trigger: FactId } }   // code-stage pass-through
  'input.taken':    { by: 'worker';   body: { input: FactId; run: RunId } }
  'progress':       { by: 'worker';   body: { run: RunId; stage: string; turn: number; diffHash: Hash } }
  'verdict':        { by: 'verifier'; body: IndependentVerdict }
  'reply.intended': { by: 'router';   body: { thread: ThreadKey; purpose: ReplyPurpose; text: ReplyText; ticket?: TicketId } }
  'reply.settled':  { by: 'code';     body: { intent: FactId; url?: string; error?: string } }
  'judged':         { by: 'watchdog'; body: { run: RunId; verdict: 'progressing' | 'stuck' | 'drifting'; why: string } }
  'closed':         { by: 'router';   body: { ticket: TicketId; outcome: 'delivered' | 'discarded' | 'stopped' | 'failed'; why: string } }
}
export type FactKind = keyof Kinds
export type BodyOf<K extends FactKind> = Kinds[K]['body']
export type Draft<K extends FactKind = FactKind> = K extends FactKind ? { kind: K; by: Kinds[K]['by']; body: BodyOf<K> } : never
export type Fact<K extends FactKind = FactKind> = K extends FactKind ? Draft<K> & { id: FactId; seq: number; at: string } : never
/** A role can only build drafts its kinds allow: a worker cannot write `reply.intended`. */
export type DraftBy<R extends Kinds[FactKind]['by']> = Extract<Draft, { by: R }>

// ---------- pure policy ----------

/**
 * Stage 1 of the two-stage filter (stage 2 is the router LLM). Runs in the poller, no model.
 * Order: drop own/bot/unknown actors -> pass through to a subscribed ticket -> batch for the router.
 */
export type Prefilter =
  | { to: 'drop'; reason: string }
  | { to: 'ticket'; ticket: TicketId }        // writes input.routed; the router gets a non-waking "seen" line
  | { to: 'router' }
export function prefilter(t: Trigger, policy: Policy, subscriberOf: (k: ThreadKey) => TicketId | undefined): Prefilter {
  // TODO: text carries REPLY_MARKER -> drop('self')  (MVP replies are posted as Vlad's own login,
  //       so the marker, not the login, tells our replies from Vlad's words)
  //       repo not in policy or mode 'off' -> drop('repo off')
  //       actor not in humans -> drop('not a human Vlad trusts')   (MVP: one person)
  //       subscriberOf(t.thread) -> ticket
  //       else router
  throw new Error('not implemented')
}

/** The Mandate comes from triggers, not from the router's claim. Undefined = the router may only ignore. */
export function mandateFor(triggers: Trigger[], policy: Policy): Mandate | undefined {
  throw new Error('not implemented')
}

/** GitHub reply norms: <= 1200 chars, starts with the purpose line, hidden marker, secrets redacted. */
export const REPLY_MARKER = '<!-- harness:reply -->'
export function composeReply(purpose: ReplyPurpose, body: string, ticket?: TicketId): ReplyText {
  throw new Error('not implemented')
}

export function independentVerdict(raw: Omit<IndependentVerdict, '__brand'>): IndependentVerdict {
  // TODO: reject when raw.verifierSession === raw.writerSession or writerSession is empty
  throw new Error('not implemented')
}

/** A verdict counts for publish only at the SHA it judged (pstack shipping.md:9). */
export function verdictStillValid(v: IndependentVerdict, headSha: string, patchId: string): boolean {
  return v.verdict !== 'FAIL' && v.headSha === headSha && v.patchId === patchId
}

/** Tool policy per role. One table, enforced by the guard in every session (extension.ts). */
export type ToolCheck = { allow: true; rewriteBash?: string } | { allow: false; reason: string }
export function checkTool(role: Role, tool: string, input: Record<string, unknown>): ToolCheck {
  // TODO router:   allow only 'harness' and 'workflow' with action in {status,list,stages,stage,transcript}
  //                (router never executes: no bash/edit/write/read of repos)
  //      verifier: deny edit/write/apply_patch; bash allowed but rewritten (below)
  //      worker/child: allow; bash rewritten
  //      watchdog: allow 'harness' (judge/status) and read-only workflow actions
  //      rewriteBash = `env -u GH_TOKEN -u GITHUB_TOKEN -u SSH_AUTH_SOCK GH_CONFIG_DIR=$HARNESS_HOME/empty
  //        GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0= GIT_TERMINAL_PROMPT=0
  //        GIT_SSH_COMMAND=false -- sh -c <quoted original>`
  //      plus deny on obvious strings (git push, gh pr, security find-*) as the second line.
  //      Speed bump, not a wall: same macOS user. See rationale "Tradeoffs".
  throw new Error('not implemented')
}
