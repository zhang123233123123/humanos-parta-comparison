"""Account use cases; retain existing identity and authentication contracts."""
from collections.abc import Callable
from ..repositories.users import UserRepository
from ..domain.profile import build_default_profile


def public_user(row) -> dict:
    return {key: row[key] for key in ("id", "email", "name", "created_at", "last_login_at", "account_type")}


def register_account(payload: dict, *, find_user: Callable, find_name: Callable,
                     create: Callable) -> tuple[dict, bool]:
    email = str(payload.get("email") or "").strip().lower()
    name = str(payload.get("name") or "").strip()
    existing = find_user(email) if email else None
    if existing:
        return {"error": "email_exists", "message": "This email is already registered.",
                "email": existing["email"], "username": existing["name"], "action": "sign_in"}, False
    existing = find_name(name)
    if existing:
        return {"error": "username_exists", "message": "This username is already in use.",
                "username": existing["name"], "action": "choose_another_username"}, False
    return create(email=email, password=payload.get("password", ""), name=name), True


def user_row(identity: str, *, connect: Callable):
    with connect() as conn:
        return UserRepository(conn).by_identity(identity)


def user_row_by_name(name: str, *, connect: Callable):
    normalized = name.strip()
    if not normalized:
        return None
    with connect() as conn:
        return UserRepository(conn).by_name(normalized)


def account_capabilities(identity: str, *, find_user: Callable) -> dict:
    row = find_user(identity)
    is_test = bool(row and row["account_type"] == "test")
    return {"account_type": "test" if is_test else "normal", "test_clock": is_test, "qa_tools": is_test}


def create_user(email: str, password: str, name: str = "", *, connect: Callable,
                make_id: Callable, make_salt: Callable, now: Callable, hash_password: Callable,
                timezone: Callable, today: Callable, upsert_profile: Callable,
                log_event: Callable, project: Callable) -> dict:
    email = email.strip().lower()
    if not email or "@" not in email:
        raise ValueError("valid email is required")
    if len(password) < 6:
        raise ValueError("password must be at least 6 characters")
    user_id, salt, timestamp = make_id("user"), make_salt(), now()
    with connect() as conn:
        users = UserRepository(conn)
        users.insert(user_id=user_id, email=email, name=name.strip() or email.split("@")[0],
                     password_hash=hash_password(password, salt), salt=salt, timestamp=timestamp)
        row = users.by_id(user_id)
    timezone_name = timezone()
    upsert_profile(build_default_profile(user_id, timezone_name=timezone_name,
        week_of=today(timezone_name)).model_dump())
    log_event(user_id, "user_registered", {"email": email})
    return {"user": project(row), "created": True, "resources": {"profile": "/api/profile"}}


def authenticate_user(email: str, password: str, *, connect: Callable, hash_password: Callable,
                      now: Callable, migrate_identity: Callable, ensure_profile: Callable,
                      log_event: Callable, project: Callable) -> dict:
    email = email.strip().lower()
    with connect() as conn:
        users = UserRepository(conn)
        row = users.by_email(email)
        if not row or hash_password(password, row["salt"]) != row["password_hash"]:
            raise PermissionError("invalid email or password")
        users.record_login(row["id"], now())
        row = users.by_id(row["id"])
    migrate_identity(email, row["id"])
    ensure_profile(row["id"])
    log_event(row["id"], "user_logged_in", {"email": email})
    return {"user": project(row), "resources": {"profile": "/api/profile"}}
