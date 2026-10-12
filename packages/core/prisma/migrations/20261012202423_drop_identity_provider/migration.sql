-- ADR-012 §2: OAuth-контур удалён, provider-данные больше не существуют.
DROP TABLE identity."IdentityProvider";

-- ADR-012 §2: ровно один живой REGISTERED на инстанс. Прежний частичный индекс
-- "Identity_registered_email_key" построен по lower(email) и при email = NULL
-- единственность НЕ гарантирует (NULL не конфликтует) — bootstrap полагается
-- на этот индекс (гонка двух bootstrap'ов → P2002 → re-read победителя).
CREATE UNIQUE INDEX "Identity_single_registered_key"
  ON identity."Identity"(kind)
  WHERE kind = 'REGISTERED' AND "deletedAt" IS NULL;
