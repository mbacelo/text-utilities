/** Shared fixtures and assertions for the diff tests. */

/** Every ignore option off. */
export const NONE = {
    ignoreCase: false,
    ignoreSpaces: false,
    ignoreLineFeeds: false,
    ignoreEscapeSequences: false
};

/** The tool's default checkbox state: everything checked. */
export const ALL = {
    ignoreCase: true,
    ignoreSpaces: true,
    ignoreLineFeeds: true,
    ignoreEscapeSequences: true
};

/** @param {Object} [overrides] @returns {Object} Options with NONE as the base */
export function opts(overrides) {
    return { ...NONE, ...overrides };
}

/** Mirrors how the worker decides "same" vs "different". */
export function isEqualDiff(parts) {
    return parts.every(part => part.type === 'equal');
}

/** Comma-joined part types, for readable failure messages. */
export function types(parts) {
    return parts.map(part => part.type).join(',');
}

/**
 * Concatenated text of all parts of a given type, for one side.
 * @param {Array<Object>} parts
 * @param {1|2} side
 * @param {string} type
 * @returns {string}
 */
export function textOf(parts, side, type) {
    return parts
        .filter(part => part.type === type)
        .map(part => (type === 'equal' || type === 'changed')
            ? (side === 1 ? part.value1 : part.value2)
            : part.value)
        .join('');
}

/** Rebuild one side's original text from its parts. */
export function reconstruct(parts, side) {
    const skip = side === 1 ? 'insert' : 'delete';
    const take = side === 1 ? 'delete' : 'insert';
    return parts
        .map(part => {
            if (part.type === skip) return '';
            if (part.type === take) return part.value;
            return side === 1 ? part.value1 : part.value2;
        })
        .join('');
}

/** @param {number} count @param {string} [prefix] @returns {string[]} */
export function series(count, prefix = 'line ') {
    return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

// The worked example documented in "diff behavior.txt".
export const SPEC_V1 = [
    'The quick brown fox jumped over the lazy dog.',
    'It was a sunny day, and everything felt peaceful in the meadow.',
    'A small bird was singing on a nearby branch.',
    'The fox ran toward the forest to find something to eat.',
    'This line exists only in Version 1 and should show up as removed.'
].join('\n');

export const SPEC_V2 = [
    'The quick brown fox leaps over the lazy dog.',
    'It was a bright afternoon, and the meadow was quiet.',
    'The fox hurried into the forest to search for food.',
    'A rabbit watched from a distance but made no sound.',
    'This line exists only in Version 2 and should show up as added.'
].join('\n');
