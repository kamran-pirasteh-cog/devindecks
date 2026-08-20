import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TYPE_ROLES,
  DEFAULT_DESIGN_SYSTEM,
  isBuiltInTypeRole,
  resolveTypeRole,
  typeRoleIds,
  type DesignSystem,
} from './tokens';

const withRole = (id: string, label: string): DesignSystem => ({
  ...DEFAULT_DESIGN_SYSTEM,
  type: {
    ...DEFAULT_DESIGN_SYSTEM.type,
    [id]: { ...DEFAULT_DESIGN_SYSTEM.type.body, label, sizePt: 33 },
  },
});

describe('type roles', () => {
  it('lists the built-ins first, then what an admin added', () => {
    expect(typeRoleIds(withRole('custom.1', 'Pull quote'))).toEqual([
      ...BUILT_IN_TYPE_ROLES,
      'custom.1',
    ]);
  });

  it('keeps built-in order even when the record was built the other way round', () => {
    // A system stored before a built-in existed is backfilled from the
    // defaults, so key order alone would put the newest built-in last.
    const scrambled = {
      ...DEFAULT_DESIGN_SYSTEM,
      type: { 'custom.1': DEFAULT_DESIGN_SYSTEM.type.body, ...DEFAULT_DESIGN_SYSTEM.type },
    };
    expect(typeRoleIds(scrambled)).toEqual([...BUILT_IN_TYPE_ROLES, 'custom.1']);
  });

  it('protects the six the code resolves through by name', () => {
    expect(isBuiltInTypeRole('body')).toBe(true);
    expect(isBuiltInTypeRole('custom.1')).toBe(false);
  });

  it('resolves an added role', () => {
    expect(resolveTypeRole(withRole('custom.1', 'Pull quote'), 'custom.1').sizePt).toBe(33);
  });

  it('falls back to body for a role that was removed, rather than crashing', () => {
    const ds = DEFAULT_DESIGN_SYSTEM;
    expect(resolveTypeRole(ds, 'custom.1')).toBe(ds.type.body);
    expect(resolveTypeRole(ds, undefined)).toBe(ds.type.body);
  });
});
