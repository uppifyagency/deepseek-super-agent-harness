// policy.ts: every authority and channel rule, as pure functions over parsed settings.
// Ported from dsh policy.ts + admission.ts (gate, revalidate, admitsInferred, observe conversion),
// plus what the actor model adds: command validation per actor kind, speculative rules,
// pause-always classification, channel norms. No I/O; postbox.ts is the only caller.

import type {
  ActorId, Admission, ChannelRef, CommandFor, Gate, Mandate, PersonRef, Thread, Trigger, WorkerRecord,
} from "./domain";

/** zod-parsed at the boundary (dsh policy.ts:67-109), trimmed of executor config. */
export interface Settings {
  paused: boolean;
  mode: "off" | "observe" | "auto";
  rules: readonly { id: string; name: string; enabled: boolean; instruction: string; speculative?: boolean }[];
  sources: Readonly<Record<string, { allowed: readonly { id: string }[]; admission: Record<string, "explicit" | "inferred" | "ignore">; bots?: readonly string[] }>>;
  channels: Readonly<Record<string, ChannelNorm>>; // keyed by source kind
  budget: { usdPerWorker: number; turnMinutes: number; autoRaiseOnce: boolean };
}

/** Per-channel reply norm (article 4.2). IM: brief, hard 100-word cap. GitHub: structured, no cap. */
export interface ChannelNorm { style: "brief" | "structured"; maxWords?: number }

export interface Policy {
  readonly version: string; // key("mandate-v4", rules, mode, sources): replay-stable, no time

  /** Fast path (no LLM). Same contract as dsh gate(): source scope, allowlists, admission cells, mode. */
  admit(trigger: Trigger, thread: Thread): Admission;

  /**
   * Mint the Mandate for a Router `spawn`, from the Admissions stored on the batch letters.
   * Strongest admission wins; its actor is the Mandate actor (dsh trap 6).
   * Returns `observe` when mode is observe and strength is inferred: the spawn becomes a wouldSpawn record.
   */
  mint(admissions: readonly { trigger: Trigger; admission: Admission }[], scope: string):
    | { kind: "mandate"; mandate: Mandate }
    | { kind: "observe"; wouldSpawn: true }
    | { kind: "refused"; reason: string };

  /**
   * Called at EVERY worker turn claim, because in this model every turn is a resume.
   * valid: run. changed: run, and a policy.changed letter goes in the batch. revoked: end the worker.
   */
  revalidate(mandate: Mandate): { kind: "valid" } | { kind: "changed"; summary: string } | { kind: "revoked"; reason: string };

  /** Validate one command against the actor's facts. Pure; postbox.commit turns `reason` into a `rejected` letter. */
  check<A extends ActorId>(actor: A, cmd: CommandFor<A>, facts: CheckFacts): { ok: true } | { ok: false; reason: string };

  /** Classify an action the env hook intercepted. `gate` = pause-always (force-push, deploy, delete, merge). */
  classify(action: { tool: string; command: string }): "allow" | "gate" | "deny";

  norm(channel: ChannelRef): ChannelNorm;
}

/** What check() may consult. Assembled by postbox inside the commit txn. */
export interface CheckFacts {
  worker?: WorkerRecord;            // the acting worker, or the target worker of a Router command
  openGates: readonly Gate[];
  headSha?: string;                 // current head of the worker's env, for `done`
  verdict?: { pass: boolean; sha: string };
  triggerActor?: PersonRef;         // for `resolve` and `stop`: who wrote the trigger
  triggerStrength?: "explicit" | "inferred";
}

export function settingsPolicy(settings: Settings): Policy {
  // TODO: port dsh settingsPolicy (policy.ts:167-242) for admit/revalidate.
  // check() rules, Router:
  //   spawn: every trigger is in the Router's current batch and admitted; delivery "speculative"
  //          only if some enabled rule has speculative: true; `ack` forbidden when speculative.
  //   reply: text fits norm(channel) (Intl.Segmenter word count, dsh infra/text.ts);
  //          about a speculative worker only after its `done` report; purpose "ask" needs an open gate.
  //   stop: triggerStrength === "explicit" and worker not ended.
  // check() rules, Worker:
  //   report done: verdict.pass && verdict.sha === headSha.
  //   ask: forbidden for speculative workers (asking reveals them; they discard instead).
  //   resolve: gate open and owned; for kind "irreversible", triggerActor must be allowed by the mandate source.
  //   subscribe: role context only (ownership is the Router's call).
  throw new Error("not implemented");
}

/** Exhaustiveness helper so a new command kind fails the build in check(). */
export function assertNever(x: never): never { throw new Error(`unhandled: ${JSON.stringify(x)}`); }

