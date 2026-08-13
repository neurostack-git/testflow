"""HTTP response shaping and the error contract (LLD §9.6)."""

import json
from decimal import Decimal

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
}

# Fallback machine codes when a raiser does not supply one.
_DEFAULT_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    500: "internal_error",
}


class ApiError(Exception):
    """Raised anywhere in a handler to short-circuit with a specific status.

    `api_handler` converts these into the `{error, code}` contract. Anything
    else that escapes a handler becomes an opaque 500 — internal detail is
    logged, never returned.
    """

    def __init__(self, status: int, message: str, code: str = ""):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code or _DEFAULT_CODES.get(status, "error")


def _json_default(value):
    # DynamoDB returns every number as Decimal; emit ints as ints.
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    raise TypeError(f"Not JSON serialisable: {type(value).__name__}")


def response(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, default=_json_default),
    }


def json_body(event: dict) -> dict:
    try:
        parsed = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        raise ApiError(400, "Malformed JSON body.", "bad_json")
    if not isinstance(parsed, dict):
        raise ApiError(400, "Request body must be a JSON object.", "bad_json")
    return parsed


def required(body: dict, *fields: str) -> tuple:
    """Pull required string fields, trimmed. Raises 400 naming the first missing one."""
    out = []
    for field in fields:
        value = body.get(field)
        value = value.strip() if isinstance(value, str) else value
        if not value:
            raise ApiError(400, f"'{field}' is required.", "missing_field")
        out.append(value)
    return tuple(out)


def api_handler(fn):
    """Wrap a lambda_handler so ApiError maps to the error contract.

    Keeps every handler free of try/except boilerplate and guarantees no
    stack trace or boto error string ever reaches the client.
    """

    def wrapper(event, context):
        try:
            return fn(event, context)
        except ApiError as err:
            return response(err.status, {"error": err.message, "code": err.code})
        except Exception as err:  # noqa: BLE001 — deliberate catch-all boundary
            print(f"Unhandled error in {fn.__module__}: {type(err).__name__}: {err}")
            return response(500, {
                "error": "Something went wrong on our end. Please try again.",
                "code": "internal_error",
            })

    return wrapper


def not_found() -> dict:
    return response(404, {"error": "Not found", "code": "not_found"})
