"""
tfcommon — shared primitives for every TestFlow Lambda.

Published as a single Lambda Layer and attached to all functions. This package
holds authorisation and persistence primitives ONLY; business rules beyond the
RBAC matrix (LLD §3.1) and the bug transition table (LLD §8.3) do not belong here.

Import surface:

    from tfcommon.http import response, json_body, ApiError, api_handler
    from tfcommon.auth import get_caller, require_developer, require_owner, require_project
    from tfcommon.db  import table, org_pk, user_pk, project_pk, now_iso
    from tfcommon.bugs import STATUSES, can_transition
    from tfcommon.org  import list_members, list_developer_subs
"""

__all__ = ["http", "db", "auth", "bugs", "org"]
