#!/usr/bin/env tsx
/**
 * Test the ungroupAllSpeakers function
 */

import { ungroupAllSpeakers } from './discovery.js';

async function testUngrouping() {
  console.log('🧪 Testing ungroupAllSpeakers function...\n');
  
  try {
    await ungroupAllSpeakers();
    console.log('\n✅ Ungrouping completed');
  } catch (error) {
    console.error('❌ Error during ungrouping:', error);
  }
}

// Run the test
testUngrouping().catch(console.error);