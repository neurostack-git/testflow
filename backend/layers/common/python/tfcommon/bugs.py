"""Bug status vocabulary and the transition matrix (LLD §8).

AUTHORITATIVE. The client mirror at frontend/src/lib/bug-status.ts exists only
to grey out unavailable options — it must never permit something this file
forbids. Keep the two in step.
"""

from .auth import Caller
from .http import ApiError

STATUS_OPEN = "Open"
STATUS_FIXED = "Fixed"
STATUS_REOPENED = "Reopened"
STATUS_CLOSED = "Closed"
STATUS_INVALID = "Invalid"

STATUSES = (STATUS_OPEN, STATUS_FIXED, STATUS_REOPENED, STATUS_CLOSED, STATUS_INVALID)

#  Every bug is born Open, whoever files it.
INITIAL_STATUS = STATUS_OPEN

#  Owner and Developer share one matrix — they differ only on people management.
DEVELOPER_TRANSITIONS = {
    STATUS_OPEN:     [STATUS_FIXED, STATUS_CLOSED, STATUS_INVALID],
    STATUS_FIXED:    [STATUS_OPEN, STATUS_REOPENED, STATUS_CLOSED, STATUS_INVALID],
    STATUS_REOPENED: [STATUS_FIXED, STATUS_CLOSED, STATUS_INVALID],
    STATUS_CLOSED:   [STATUS_OPEN, STATUS_FIXED, STATUS_INVALID],
    STATUS_INVALID:  [STATUS_OPEN, STATUS_FIXED, STATUS_CLOSED],
}

#  A Tester may only respond to a fix: confirm it, or say it still fails.
TESTER_TRANSITIONS = {
    STATUS_OPEN:     [],
    STATUS_FIXED:    [STATUS_REOPENED, STATUS_CLOSED],
    STATUS_REOPENED: [],
    STATUS_CLOSED:   [],
    STATUS_INVALID:  [],
}


def allowed_transitions(caller: Caller, current: str) -> list:
    matrix = DEVELOPER_TRANSITIONS if caller.is_developer else TESTER_TRANSITIONS
    return matrix.get(current, [])


def can_transition(caller: Caller, current: str, target: str) -> bool:
    return target in allowed_transitions(caller, current)


def require_transition(caller: Caller, current: str, target: str) -> None:
    if target not in STATUSES:
        raise ApiError(400, f"'{target}' is not a valid status.", "bad_status")
    if current == target:
        raise ApiError(400, f"This bug is already {target}.", "no_op_transition")
    if not can_transition(caller, current, target):
        raise ApiError(
            403,
            f"You can't move a bug from {current} to {target}.",
            "transition_forbidden",
        )


def can_edit_bug(caller: Caller, bug: dict) -> bool:
    """Developers and the Owner edit any bug; a Tester edits only their own,
    at any status (D10)."""
    return caller.is_developer or bug.get("reportedBy") == caller.sub


def require_can_edit_bug(caller: Caller, bug: dict) -> None:
    if not can_edit_bug(caller, bug):
        raise ApiError(403, "You can only change bugs you reported.", "not_your_bug")
