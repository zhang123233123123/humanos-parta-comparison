"""Session report receipts and independent unfinished portions, owner scoped."""
class SessionReportRepository:
    def __init__(self, connection):
        self.connection = connection

    def replay(self, user_id, request_id):
        return self.connection.execute('SELECT * FROM session_reports WHERE user_id=? AND request_id=?',
                                       (user_id, request_id)).fetchone()

    def insert(self, user_id, session_id, request_id, command_hash, state_id, pending_work_id, timestamp):
        self.connection.execute('INSERT INTO session_reports VALUES (?,?,?,?,?,?,?)',
                               (user_id, session_id, request_id, command_hash, state_id, pending_work_id, timestamp))

    def create_pending(self, pending_id, user_id, session_id, minutes, source, timestamp):
        self.connection.execute('INSERT INTO pending_work (id,user_id,source_session_id,remaining_minutes,source,status,created_at) VALUES (?,?,?,?,?,?,?)',
                               (pending_id, user_id, session_id, minutes, source, 'pending', timestamp))

    def pending(self, user_id):
        return self.connection.execute('''SELECT p.*, s.task_id AS original_task_id, s.week_id,
            t.title, t.deadline_at FROM pending_work p
            JOIN execution_sessions s ON s.id=p.source_session_id AND s.user_id=p.user_id
            JOIN tasks t ON t.id=s.task_id AND t.user_id=p.user_id
            WHERE p.user_id=? AND t.archived_at IS NULL ORDER BY p.created_at, p.id''', (user_id,)).fetchall()

    def mark_scheduled(self, user_id, pending_id, plan_id):
        self.connection.execute("UPDATE pending_work SET status='scheduled',scheduled_plan_id=? WHERE user_id=? AND id=? AND status='pending'",
                                (plan_id, user_id, pending_id))
