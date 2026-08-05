const {
  RETENTION_DAYS,
  retentionTimestamps,
  isExpired,
  nextActivityLog,
  buildActivityEntry,
} = require('../src/lib/common');

describe('retention helpers', () => {
  test('retention is 30 days', () => {
    expect(RETENTION_DAYS).toBe(30);
    const fixed = new Date('2026-01-01T00:00:00.000Z');
    const { expiresAt, ttl } = retentionTimestamps(fixed);
    expect(expiresAt).toBe('2026-01-31T00:00:00.000Z');
    expect(ttl).toBe(Math.floor(Date.parse(expiresAt) / 1000));
  });

  test('isExpired respects expiresAt', () => {
    expect(isExpired({ expiresAt: '2000-01-01T00:00:00.000Z' })).toBe(true);
    expect(isExpired({ expiresAt: '2099-01-01T00:00:00.000Z' })).toBe(false);
  });

  test('activity log caps and appends', () => {
    const claims = { sub: '11111111-1111-1111-1111-111111111111', email: 'a@b.co' };
    const entry = buildActivityEntry(claims, 'preview', 'Opened');
    const log = nextActivityLog([], entry);
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe('preview');
  });
});
