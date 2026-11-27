export interface ChatThread { id: string; title: string; updated_at: number; last_opened_at: number }
export interface ChatTurn { id: string; user_text: string; assistant_reply: string; created_at: number }
export interface HistoryPage { turns: ChatTurn[]; next_cursor: string | null }
