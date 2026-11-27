"""Account persistence on a caller-owned transaction."""
import sqlite3


class UserRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def by_identity(self, identity: str):
        return self.connection.execute(
            "SELECT * FROM users WHERE id=? OR lower(email)=lower(?)", (identity, identity)).fetchone()

    def by_name(self, name: str):
        return self.connection.execute("SELECT * FROM users WHERE lower(name)=lower(?)", (name,)).fetchone()

    def by_email(self, email: str):
        return self.connection.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()

    def by_id(self, user_id: str):
        return self.connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()

    def insert(self, *, user_id: str, email: str, name: str, password_hash: str, salt: str, timestamp: int):
        self.connection.execute(
            "INSERT INTO users (id,email,name,password_hash,salt,created_at,last_login_at) VALUES (?,?,?,?,?,?,?)",
            (user_id, email, name, password_hash, salt, timestamp, timestamp))

    def record_login(self, user_id: str, timestamp: int):
        self.connection.execute("UPDATE users SET last_login_at=? WHERE id=?", (timestamp, user_id))
