// Basic implementation of lodash.get / lodash.set logic

export function getIn(obj: any, path: string): any {
    if (!path) return undefined;
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let result = obj;
    for (const key of keys) {
        if (result === null || result === undefined) return undefined;
        result = result[key];
    }
    return result;
}

export function setIn(obj: any, path: string, value: any): any {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    const lastKey = keys.pop()!;
    let target = obj;

    for (const key of keys) {
        if (target[key] === undefined) {
            // Determine if next key is index or prop
            target[key] = isNaN(Number(keys[keys.indexOf(key) + 1])) ? {} : [];
        }
        target = target[key];
    }

    target[lastKey] = value;
    return obj;
}

export function resolveReferences(data: any, path: string): any {
    // Handling array aggregation access: e.g., "items.price" -> [100, 200]
    // simple "items.0.price" is handled by getIn.
    // This function handles "collection.field" aggregation.

    if (path.includes('.') && !/\d/.test(path)) {
        const [collectionName, fieldName] = path.split('.');
        const collection = data[collectionName];
        if (Array.isArray(collection)) {
            return collection.map(item => item[fieldName]);
        }
    }
    return getIn(data, path);
}
