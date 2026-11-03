---- MODULE issue_reply ----
EXTENDS Naturals

CONSTANTS Senders, MaxCrashes, MarkerLookup, StaleList

VARIABLES intended, settled, comments, pc, crashes

vars == <<intended, settled, comments, pc, crashes>>

TypeOK ==
  /\ intended \in BOOLEAN
  /\ settled \in BOOLEAN
  /\ comments \in 0..3
  /\ pc \in [Senders -> {"down", "idle", "found", "missing", "posted"}]
  /\ crashes \in 0..MaxCrashes

Init ==
  /\ intended = FALSE
  /\ settled = FALSE
  /\ comments = 0
  /\ pc = [p \in Senders |-> "idle"]
  /\ crashes = 0

RouterReplies ==
  /\ ~intended
  /\ intended' = TRUE
  /\ UNCHANGED <<settled, comments, pc, crashes>>

Seen == IF StaleList THEN {0, comments} ELSE {comments}

LookUpMarker(p) ==
  /\ pc[p] = "idle"
  /\ intended
  /\ ~settled
  /\ \E n \in Seen :
       pc' = [pc EXCEPT ![p] = IF MarkerLookup /\ n > 0 THEN "found" ELSE "missing"]
  /\ UNCHANGED <<intended, settled, comments, crashes>>

Post(p) ==
  /\ pc[p] = "missing"
  /\ comments' = comments + 1
  /\ pc' = [pc EXCEPT ![p] = "posted"]
  /\ UNCHANGED <<intended, settled, crashes>>

Settle(p) ==
  /\ pc[p] \in {"found", "posted"}
  /\ settled' = TRUE
  /\ pc' = [pc EXCEPT ![p] = "idle"]
  /\ UNCHANGED <<intended, comments, crashes>>

Crash(p) ==
  /\ intended
  /\ ~settled
  /\ pc[p] # "down"
  /\ crashes < MaxCrashes
  /\ pc' = [pc EXCEPT ![p] = "down"]
  /\ crashes' = crashes + 1
  /\ UNCHANGED <<intended, settled, comments>>

Restart(p) ==
  /\ pc[p] = "down"
  /\ pc' = [pc EXCEPT ![p] = "idle"]
  /\ UNCHANGED <<intended, settled, comments, crashes>>

Done ==
  /\ settled
  /\ \A p \in Senders : pc[p] = "idle"
  /\ UNCHANGED vars

Next ==
  \/ RouterReplies
  \/ \E p \in Senders : LookUpMarker(p) \/ Post(p) \/ Settle(p) \/ Crash(p) \/ Restart(p)
  \/ Done

Spec == Init /\ [][Next]_vars

AtMostOneComment == comments <= 1

SettledMeansPosted == settled => comments >= 1

====
