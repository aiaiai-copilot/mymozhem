// Fail-closed валидация LAN_BASE_URL (дизайн §8.2): только localhost или
// RFC1918-адрес по plain http. Любой другой хост/схема (включая публичный прод)
// — отказ ДО старта тестов. Возвращает origin (без пути/trailing slash).
export function assertLanBaseUrl(raw: string | undefined): string {
  if (!raw) {
    throw new Error('LAN_BASE_URL обязателен (например http://192.168.0.186:3000)');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`LAN_BASE_URL не является URL: ${raw}`);
  }
  if (url.protocol !== 'http:') {
    throw new Error(`LAN_BASE_URL: разрешён только plain http LAN-стенда, получено ${url.protocol}//`);
  }
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return url.origin;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  const isPrivate =
    m !== null &&
    (Number(m[1]) === 10 ||
      (Number(m[1]) === 172 && Number(m[2]) >= 16 && Number(m[2]) <= 31) ||
      (Number(m[1]) === 192 && Number(m[2]) === 168));
  if (!isPrivate) {
    throw new Error(
      `LAN_BASE_URL: хост ${host} не localhost/RFC1918 — прогон e2e по внешнему адресу запрещён`,
    );
  }
  return url.origin;
}
