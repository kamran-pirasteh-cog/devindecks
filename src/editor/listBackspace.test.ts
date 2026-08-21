import { describe, expect, it } from 'vitest';
import { backspaceList } from './listBackspace';

describe('backspaceList', () => {
  it('promotes a demoted paragraph before touching its bullet', () => {
    expect(backspaceList({ bullet: 'bullet', level: 2 })).toEqual({ bullet: 'bullet', level: 1 });
    expect(backspaceList({ bullet: 'number', level: 1 })).toEqual({ bullet: 'number', level: 0 });
  });

  it('drops the bullet at the top level', () => {
    expect(backspaceList({ bullet: 'bullet', level: 0 })).toEqual({ bullet: undefined, level: 0 });
    expect(backspaceList({ bullet: 'number' })).toEqual({ bullet: undefined, level: 0 });
  });

  it('promotes an indented paragraph that carries no bullet', () => {
    expect(backspaceList({ level: 1 })).toEqual({ bullet: undefined, level: 0 });
  });

  it('leaves a plain paragraph to the browser, which merges it upward', () => {
    expect(backspaceList({})).toBeNull();
    expect(backspaceList({ bullet: 'none', level: 0 })).toBeNull();
  });
});
