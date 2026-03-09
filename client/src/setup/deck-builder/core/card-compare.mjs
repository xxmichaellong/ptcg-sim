export function isDatabaseCard(card = {}) {
  return ['id', 'images'].every((key) => Object.prototype.hasOwnProperty.call(card, key));
}

export function isFormattedDeckCard(card = {}) {
  return ['image'].every((key) => Object.prototype.hasOwnProperty.call(card, key));
}

export function determineCardType(card = {}) {
  if (isDatabaseCard(card)) {
    return 'DatabaseCard';
  }
  if (isFormattedDeckCard(card)) {
    return 'FormattedDeckCard';
  }
  return 'Unknown';
}

function isObject(value) {
  return value != null && typeof value === 'object';
}

export function areCardsEqual(obj1 = {}, obj2 = {}) {
  const obj1Keys = Object.keys(obj1);
  const obj2Keys = Object.keys(obj2);

  for (const key of obj1Keys) {
    if (!obj2Keys.includes(key) && key !== 'image' && key !== 'count') {
      return false;
    }
  }

  for (const key of obj2Keys) {
    if (!obj1Keys.includes(key) && key !== 'image' && key !== 'count') {
      return false;
    }
  }

  for (const key of obj1Keys) {
    if (key === 'image' || key === 'count') {
      continue;
    }

    const val1 = obj1[key];
    const val2 = obj2[key];

    if (isObject(val1) && isObject(val2) && !Array.isArray(val1) && !Array.isArray(val2)) {
      if (!areCardsEqual(val1, val2)) {
        return false;
      }
    } else if (Array.isArray(val1) && Array.isArray(val2)) {
      if (val1.length !== val2.length) {
        return false;
      }
      for (let i = 0; i < val1.length; i += 1) {
        const a = val1[i];
        const b = val2[i];
        if (isObject(a) && isObject(b)) {
          if (!areCardsEqual(a, b)) {
            return false;
          }
        } else if (a !== b) {
          return false;
        }
      }
    } else if (val1 !== val2) {
      return false;
    }
  }

  return true;
}
