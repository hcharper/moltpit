// Export game engine system
export * from './engine.js';

// Import games to register them
import './chess.js';

// Future games will be imported here:
// import './trivia.js';
// import './poker.js';
// import './debate.js';

import { gameRegistry } from './engine.js';

export { gameRegistry };
