"""Cognito PostAuthentication trigger — fires after every successful sign-in.

Under the org model this does almost nothing: the invite already wrote both the
membership and the profile (LLD §7.2), so there is no PENDING# conversion and no
per-project fan-out. All that remains is flipping a pending member to active and
picking up a display name set during onboarding.

This function is deliberately given ONLY TABLE_NAME. Passing USER_POOL_ID would
create a circular CloudFormation dependency, because the trigger is attached to
the very pool that would supply it.
"""

from tfcommon.db import PROFILE, get_item, member_sk, now_iso, org_pk, table, user_pk
from tfcommon.org import MEMBER_ACTIVE, MEMBER_PENDING


def lambda_handler(event: dict, context) -> dict:
    attrs = event.get("request", {}).get("userAttributes", {})
    sub = attrs.get("sub", "")
    if not sub:
        return event  # Triggers must always return the event unchanged.

    try:
        _activate(sub, attrs)
    except Exception as err:  # noqa: BLE001
        # Never block a login on bookkeeping — log and let the sign-in proceed.
        print(f"post_auth: {type(err).__name__}: {err}")

    return event


def _activate(sub: str, attrs: dict) -> None:
    profile = get_item(user_pk(sub), PROFILE)
    if not profile:
        # Owner who has confirmed signup but not yet called POST /org (LLD §7.1).
        # The frontend bootstraps the workspace on the next request.
        return

    org_id = profile.get("orgId")
    if not org_id:
        return

    name = (attrs.get("name") or "").strip()
    now = now_iso()

    member = get_item(org_pk(org_id), member_sk(sub))
    if member and member.get("status") == MEMBER_PENDING:
        table.update_item(
            Key={"PK": org_pk(org_id), "SK": member_sk(sub)},
            UpdateExpression="SET #s = :active, joinedAt = :now",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":active": MEMBER_ACTIVE, ":now": now},
        )

    # Adopt the display name the user set during onboarding, if any.
    if name and name != profile.get("name"):
        table.update_item(
            Key={"PK": user_pk(sub), "SK": PROFILE},
            UpdateExpression="SET #n = :n",
            ExpressionAttributeNames={"#n": "name"},
            ExpressionAttributeValues={":n": name},
        )
        table.update_item(
            Key={"PK": org_pk(org_id), "SK": member_sk(sub)},
            UpdateExpression="SET #n = :n",
            ExpressionAttributeNames={"#n": "name"},
            ExpressionAttributeValues={":n": name},
        )
