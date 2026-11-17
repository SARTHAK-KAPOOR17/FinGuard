/**
 * Seedable Pseudo-Random Number Generator (Mulberry32)
 */
class PRNG {
  /**
   * @param {number|string} [seed]
   */
  constructor(seed) {
    this.seedValue = seed !== undefined ? this._hashSeed(seed) : Math.floor(Math.random() * 2147483647);
    this.state = this.seedValue;
  }

  _hashSeed(val) {
    if (typeof val === 'number') {
      return (val >>> 0) || 1;
    }
    const str = String(val);
    let hash = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      hash = Math.imul(hash ^ str.charCodeAt(i), 3432918353);
      hash = (hash << 13) | (hash >>> 19);
    }
    return hash >>> 0;
  }

  /**
   * Generates a pseudo-random float between 0 (inclusive) and 1 (exclusive).
   * @returns {number}
   */
  nextFloat() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generates an integer in [min, max].
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  nextInt(min, max) {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }

  /**
   * Picks a random element from an array.
   * @param {Array} arr
   * @returns {any}
   */
  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /**
   * Generates a reproducible UUID v4 string based on PRNG state.
   * @returns {string}
   */
  nextUUID() {
    const hex = [];
    for (let i = 0; i < 32; i++) {
      hex.push(this.nextInt(0, 15).toString(16));
    }
    // set version to 4
    hex[12] = '4';
    // set variant to RFC4122 (8, 9, a, or b)
    const variantNibbles = ['8', '9', 'a', 'b'];
    hex[16] = variantNibbles[this.nextInt(0, 3)];

    return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`;
  }
}

module.exports = { PRNG };
