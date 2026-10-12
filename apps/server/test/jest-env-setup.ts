// ADR-012 (конфиг T3): ORGANIZER_SETUP_TOKEN обязателен — e2e boot'ят настоящий
// ConfigModule из process.env (а bootstrap-smoke отдаёт process.env потомку
// dist/main.js). Тестовый дефолт (>= 32 символов); спекам с собственным значением —
// переопределять в beforeAll явно.
process.env.ORGANIZER_SETUP_TOKEN ??= 'server-e2e-organizer-setup-token!!';
