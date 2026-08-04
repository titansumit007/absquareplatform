const {
  isValidId,
  isValidEmail,
  isValidCognitoUsername,
  parseBoolean,
  sanitizeFileName,
  isAllowedUpload,
} = require('../src/lib/common');

describe('isValidCognitoUsername', () => {
  test('accepts Cognito UUID usernames (prod disable/delete payload)', () => {
    expect(isValidCognitoUsername('b4c874c8-b0d1-702e-42f9-3336e7a85644')).toBe(true);
  });

  test('accepts email usernames for alias-style pools', () => {
    expect(isValidCognitoUsername('chowdharysumit1992@gmail.com')).toBe(true);
  });

  test('rejects empty / garbage', () => {
    expect(isValidCognitoUsername('')).toBe(false);
    expect(isValidCognitoUsername('   ')).toBe(false);
    expect(isValidCognitoUsername(null)).toBe(false);
    expect(isValidCognitoUsername('not-an-id')).toBe(false);
  });
});

describe('parseBoolean', () => {
  test('parses real booleans and string forms', () => {
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean(false)).toBe(false);
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean('yes')).toBe(null);
    expect(parseBoolean(1)).toBe(null);
  });
});

describe('isValidId / isValidEmail', () => {
  test('UUID and email helpers', () => {
    expect(isValidId('b4c874c8-b0d1-702e-42f9-3336e7a85644')).toBe(true);
    expect(isValidId('not-uuid')).toBe(false);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });
});

describe('upload helpers', () => {
  test('sanitizeFileName strips path tricks', () => {
    expect(sanitizeFileName('report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('')).toBe(null);
    expect(sanitizeFileName('../x.pdf')).not.toContain('/');
  });

  test('isAllowedUpload enforces type/extension match', () => {
    expect(isAllowedUpload('a.pdf', 'application/pdf')).toBe(true);
    expect(isAllowedUpload('a.exe', 'application/pdf')).toBe(false);
    expect(isAllowedUpload('a.pdf', 'text/html')).toBe(false);
  });
});
