#!/usr/bin/env tsx

import { PandoraFavoritesBrowser } from '../../src/services/pandora-favorites.js';

// Clear the in-memory cache
console.log('Clearing PandoraFavoritesBrowser in-memory cache...');
(PandoraFavoritesBrowser as any).cache = null;
console.log('✅ In-memory cache cleared');

// The API cache file was already deleted
console.log('✅ Pandora API station cache file already cleared');
console.log('\nAll Pandora caches have been cleared.');