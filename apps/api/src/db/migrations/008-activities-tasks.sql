-- Fase 15: Actividades (eventos con RSVP) y Tareas (múltiples responsables)

CREATE TABLE IF NOT EXISTS activities (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description       TEXT        CHECK (length(description) <= 2000),
  creator_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  conversation_id   UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  duration_minutes  INTEGER,
  location          TEXT        CHECK (length(location) <= 300),
  status            TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_participants (
  activity_id   UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  rsvp_status   TEXT NOT NULL DEFAULT 'pending'
    CHECK (rsvp_status IN ('pending', 'confirmed', 'declined')),
  responded_at  TIMESTAMPTZ,
  PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description       TEXT        CHECK (length(description) <= 2000),
  creator_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  conversation_id   UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  due_date          DATE,
  status            TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  completed_at  TIMESTAMPTZ,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_activities_conv      ON activities(conversation_id);
CREATE INDEX IF NOT EXISTS idx_activities_scheduled ON activities(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tasks_conv           ON tasks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due            ON tasks(due_date);
