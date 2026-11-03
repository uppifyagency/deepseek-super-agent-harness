// Lane g1 only, after Atomic's examples/extensions/permission-gate.ts: every file write asks select("Allow ...?", ["Yes", "No"]).
const WRITES = /(>|\btee\b|\bmv\b|\bcp\b|\btouch\b|\bchmod\b|\bmkdir\b)/
export default function (pi: any) {
  pi.on('tool_call', async (event: any, ctx: any) => {
    const cmd = event.toolName === 'bash' ? String(event.input?.command ?? '') : ''
    if (event.toolName !== 'write' && event.toolName !== 'edit' && !WRITES.test(cmd)) return
    const choice = await ctx.ui.select(`Allow ${event.toolName}: ${cmd || event.input?.path || ''}?`, ['Yes', 'No'])
    if (choice !== 'Yes') return { block: true, reason: `Blocked: the requester did not allow it (${choice ?? 'cancelled'})` }
  })
}
