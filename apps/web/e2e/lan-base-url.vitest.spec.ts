import { describe, expect, it } from 'vitest';
import { assertLanBaseUrl } from './lan-base-url';

// Fail-closed валидация LAN_BASE_URL (дизайн §8.2): только localhost/RFC1918 по
// plain http. Прогон e2e по внешнему адресу запрещён конфигурационно — интент
// «никогда не production» базового playwright.config.ts здесь машинный.
describe('assertLanBaseUrl', () => {
  it.each([
    ['http://192.168.0.186:3000', 'http://192.168.0.186:3000'],
    ['http://10.0.0.5:3000', 'http://10.0.0.5:3000'],
    ['http://172.16.1.1:3000', 'http://172.16.1.1:3000'],
    ['http://172.31.255.254:3000', 'http://172.31.255.254:3000'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'], // origin без trailing slash
  ])('разрешён: %s', (input, expected) => {
    expect(assertLanBaseUrl(input)).toBe(expected);
  });

  it.each([
    ['https://192.168.0.186:3000', 'plain http'], // TLS на LAN-стенде нет
    ['http://8.8.8.8:3000', 'RFC1918'], // публичный IP
    ['http://172.15.0.1:3000', 'RFC1918'], // вне диапазона 172.16–31
    ['http://172.32.0.1:3000', 'RFC1918'],
    ['http://192.167.0.1:3000', 'RFC1918'],
    ['http://mymozhem.example.com', 'RFC1918'], // домен, не IP
    ['not-a-url', 'URL'],
  ])('отказ: %s', (input, marker) => {
    expect(() => assertLanBaseUrl(input)).toThrow(marker);
  });

  it('отсутствующая переменная — отказ с подсказкой формата', () => {
    expect(() => assertLanBaseUrl(undefined)).toThrow('LAN_BASE_URL обязателен');
  });
});
