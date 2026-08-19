import { describe, expect, it } from 'vitest';
import { isAdminPassword } from './auth';

describe('isAdminPassword', () => {
  it('accepts the admin password', () => {
    expect(isAdminPassword('ccc')).toBe(true);
  });

  it('ignores surrounding whitespace, which a paste tends to bring along', () => {
    expect(isAdminPassword('  ccc\n')).toBe(true);
  });

  it('rejects anything else, case included', () => {
    for (const wrong of ['', 'cc', 'cccc', 'CCC', 'c c c']) {
      expect(isAdminPassword(wrong)).toBe(false);
    }
  });
});
