"""Auth HTTP route mappings; persistence belongs to application services."""
from ...application.accounts import register_account


def auth_register_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/auth/register" and method == "POST":
        payload = request.read_json()
        result, created = register_account(payload, find_user=store.user_row,
            find_name=store.user_row_by_name, create=store.create_user)
        request.send_json(result, status=201 if created else 409)
        return True
    return False


def auth_login_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/auth/login" and method == "POST":
        payload = request.read_json()
        result = store.authenticate_user(
            email=payload.get("email", ""),
            password=payload.get("password", ""),
        )
        request.send_json(result)
        return True
    return False
