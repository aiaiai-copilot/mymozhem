-- AlterTable
ALTER TABLE "room"."Room" ADD COLUMN     "appId" TEXT,
ADD COLUMN     "appSettings" JSONB,
ADD COLUMN     "manifestVersion" INTEGER;

-- Рукописная часть (практика REQ-DEV-006): тройка конфигурации атомарна —
-- либо все NULL, либо все NOT NULL (design §2). Единственный сервисный путь записи
-- заменяет тройку целиком; CHECK — страховка от обхода сервиса.
ALTER TABLE room."Room" ADD CONSTRAINT "Room_config_triple"
CHECK (
  ("appId" IS NULL) = ("manifestVersion" IS NULL)
  AND ("appId" IS NULL) = ("appSettings" IS NULL)
);
