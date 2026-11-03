---- MODULE ticket_lifecycle ----
EXTENDS Naturals

CONSTANTS MaxAttempts, GatesSkipSilent

VARIABLES vis, stage, attempt, asked, pr, outcome, replies

vars == <<vis, stage, attempt, asked, pr, outcome, replies>>

Stages == {"waiting", "working", "asking", "prOpen", "failedFinal", "closed"}
Outcomes == {"none", "merged", "closed", "discarded", "stopped"}
NoReplies == [ack |-> 0, ask |-> 0, result |-> 0, link |-> 0]

Say(r, p) == [r EXCEPT ![p] = @ + 1]

TypeOK ==
  /\ vis \in {"visible", "silent"}
  /\ stage \in Stages
  /\ attempt \in 0..MaxAttempts
  /\ asked \in BOOLEAN
  /\ pr \in BOOLEAN
  /\ outcome \in Outcomes
  /\ replies \in [{"ack", "ask", "result", "link"} -> 0..3]

Init ==
  /\ vis \in {"visible", "silent"}
  /\ stage = "waiting"
  /\ attempt = 0
  /\ asked = FALSE
  /\ pr = FALSE
  /\ outcome = "none"
  /\ replies = IF vis = "visible" THEN Say(NoReplies, "ack") ELSE NoReplies

StartRun ==
  /\ stage = "waiting"
  /\ attempt < MaxAttempts
  /\ attempt' = attempt + 1
  /\ stage' = "working"
  /\ asked' = FALSE
  /\ UNCHANGED <<vis, pr, outcome, replies>>

Asks == vis = "visible" \/ ~GatesSkipSilent

WorkerAsks ==
  /\ stage = "working"
  /\ ~asked
  /\ asked' = TRUE
  /\ IF Asks
       THEN /\ stage' = "asking"
            /\ replies' = Say(replies, "ask")
            /\ UNCHANGED outcome
       ELSE /\ stage' = "closed"
            /\ outcome' = "discarded"
            /\ UNCHANGED replies
  /\ UNCHANGED <<vis, attempt, pr>>

HumanAnswers ==
  /\ stage = "asking"
  /\ stage' = "working"
  /\ UNCHANGED <<vis, attempt, asked, pr, outcome, replies>>

VerifierPasses ==
  /\ stage = "working"
  /\ stage' = "prOpen"
  /\ pr' = TRUE
  /\ replies' = IF vis = "visible" THEN Say(replies, "result") ELSE Say(replies, "link")
  /\ UNCHANGED <<vis, attempt, asked, outcome>>

AttemptFails ==
  /\ stage = "working"
  /\ IF vis = "silent"
       THEN /\ stage' = "closed"
            /\ outcome' = "discarded"
            /\ UNCHANGED replies
       ELSE IF attempt < MaxAttempts
         THEN /\ stage' = "waiting"
              /\ UNCHANGED <<outcome, replies>>
         ELSE /\ stage' = "failedFinal"
              /\ replies' = Say(replies, "result")
              /\ UNCHANGED outcome
  /\ UNCHANGED <<vis, attempt, asked, pr>>

VladStops ==
  /\ stage \in {"working", "asking"}
  /\ vis = "visible"
  /\ stage' = "closed"
  /\ outcome' = "stopped"
  /\ UNCHANGED <<vis, attempt, asked, pr, replies>>

VladPromotes ==
  /\ vis = "silent"
  /\ stage \in {"waiting", "working", "prOpen"}
  /\ vis' = "visible"
  /\ replies' = Say(replies, "ack")
  /\ UNCHANGED <<stage, attempt, asked, pr, outcome>>

PrMerged ==
  /\ stage = "prOpen"
  /\ stage' = "closed"
  /\ outcome' = "merged"
  /\ UNCHANGED <<vis, attempt, asked, pr, replies>>

IssueClosed ==
  /\ stage \in {"prOpen", "failedFinal"}
  /\ stage' = "closed"
  /\ outcome' = "closed"
  /\ UNCHANGED <<vis, attempt, asked, pr, replies>>

Done ==
  /\ stage = "closed"
  /\ UNCHANGED vars

Next ==
  \/ StartRun
  \/ WorkerAsks
  \/ HumanAnswers
  \/ VerifierPasses
  \/ AttemptFails
  \/ VladStops
  \/ VladPromotes
  \/ PrMerged
  \/ IssueClosed
  \/ Done

Spec == Init /\ [][Next]_vars

SilentStaysQuiet ==
  vis = "silent" =>
    /\ replies.ack = 0
    /\ replies.ask = 0
    /\ replies.result = 0
    /\ replies.link <= 1

DiscardedHasNoPR == outcome = "discarded" => ~pr

====
