"""Legacy conversation schema migration; invoked during explicit initialization."""
def migrate_chat_threads(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS chat_threads (id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_opened_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,id))')
    for table in ('chat_turns', 'pending_task_batches'):
        columns = {row['name'] for row in conn.execute(f'PRAGMA table_info({table})')}
        if 'thread_id' not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN thread_id TEXT NOT NULL DEFAULT 'legacy'")
        conn.execute(f'CREATE INDEX IF NOT EXISTS idx_{table}_thread ON {table}(user_id,thread_id)')
    conn.execute("INSERT OR IGNORE INTO chat_threads (id,user_id,title,created_at,updated_at) SELECT 'legacy',user_id,'历史对话',MIN(created_at),MAX(created_at) FROM chat_turns WHERE thread_id='legacy' GROUP BY user_id")
    conn.execute("INSERT OR IGNORE INTO chat_threads (id,user_id,title,created_at,updated_at) SELECT 'legacy',user_id,'历史对话',MIN(created_at),MAX(updated_at) FROM pending_task_batches WHERE thread_id='legacy' GROUP BY user_id")
