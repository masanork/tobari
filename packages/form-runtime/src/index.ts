import { initRuntime } from './runtime';
import { SearchEngine } from './search';

const search = new SearchEngine();
(window as any).GlobalSearch = search;
(window as any).SearchEngine = search;

// Boot the core runtime
// Note: SearchEngine will be initialized by runtime.ts after structure data is loaded
initRuntime();
