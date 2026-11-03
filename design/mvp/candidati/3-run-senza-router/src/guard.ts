// guard.ts: an Atomic extension installed as a package (`atomic install ./guard`). Atomic loads it in
// every stage session (ground-pstack-on-atomic.md section 2; atomic-stage-session.ts:100-120), so one
// policy covers router, work, verify and judge stages. Second line of defence only: the first line is
// that the supervisor process holds no push/PR credentials (bash strings are bypassable,
// ground-atomic-host.md 1.2 gap b).
//
// tool_call can block: ToolCallEventResult {block, reason}  AT/coding-agent/src/core/extensions/event-results.ts:17-26
// registered via pi.on('tool_call', ...)                     AT/coding-agent/src/core/extensions/api-types.ts:190

export type StageRole = 'route' | 'work' | 'verify' | 'judge'

/** Pure, unit-tested. `reason` tells the model what to do instead, so a block steers, not stalls. */
export function decide(role: StageRole, tool: string, input: Record<string, unknown>): { block: false } | { block: true; reason: string } {
  throw new Error('not implemented')
  // route, judge: allow only 'recall'
  // verify: block edit/write; bash allowed (tests, builds) but not git commit/push/reset
  // work: block `git push`, `gh pr|issue|release|api -X`, `rm -rf` outside the worktree, reads of
  //   ~/.atomic/agent/auth.json and the Keychain (`security`). Reason text:
  //   "pause-always action. Stop and return {status:'needs_human', gate:{kind:'irreversible', question}}"
}

/** Role comes from ctx.orchestrationContext (stage name); no orchestration context = not a harness stage = allow. */
export default function guardExtension(pi: { on(e: 'tool_call', h: (ev: { toolName: string; input: Record<string, unknown> }, ctx: { orchestrationContext?: { stageName?: string } }) => unknown): void }): void {
  throw new Error('not implemented')
}
