import { describe, expect, it } from 'vitest';

import { groupMenuOf } from './group-menu-entries.js';
import type { SelectionContext } from './selection.js';

describe('the group menu', () => {
  it('offers nothing until the controller builds it', () => {
    expect(groupMenuOf({} as SelectionContext, [])).toBeNull();
  });
});
