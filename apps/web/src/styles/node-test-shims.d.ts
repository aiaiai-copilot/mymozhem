// apps/web — браузерный пакет без @types/node (tsconfig: types ["vite/client"]),
// но *.spec.ts исполняются vitest в node-окружении (vite.config test.environment)
// и читают CSS с диска. Объявляем нужные node-API локально; если в пакет
// добавят @types/node — этот файл надо удалить.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: URL): string;
}
