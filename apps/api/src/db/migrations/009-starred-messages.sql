-- Fase 17: Mensajes guardados por usuario
CREATE TABLE IF NOT EXISTS starred_messages (
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  message_id UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_starred_messages_user ON starred_messages(user_id);
