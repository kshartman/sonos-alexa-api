#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Priority order for rooms
const ROOM_PRIORITY = [
  ['OfficeSpeakers', 'ShanesOfficeSpeakers'],
  ['KathysOfficeSpeakers'],
  ['BedroomSpeakers']
];

function getPresetFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getPresetFiles(fullPath));
    } else if (item.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function getRoomPriority(roomName) {
  for (let i = 0; i < ROOM_PRIORITY.length; i++) {
    if (ROOM_PRIORITY[i].includes(roomName)) {
      return i;
    }
  }
  return 999; // Low priority for other rooms
}

function reorderPlayers(players) {
  if (!Array.isArray(players) || players.length <= 1) {
    return players;
  }
  
  // Sort by priority (lower number = higher priority)
  return players.sort((a, b) => {
    const priorityA = getRoomPriority(a.roomName);
    const priorityB = getRoomPriority(b.roomName);
    return priorityA - priorityB;
  });
}

function fixPreset(presetPath) {
  try {
    const content = fs.readFileSync(presetPath, 'utf8');
    let preset;
    
    // Try to parse JSON
    try {
      preset = JSON.parse(content);
    } catch (parseError) {
      console.log(`  ❌ JSON parse error in ${presetPath}:`);
      console.log(`     ${parseError.message}`);
      
      // Try to fix common issues
      let fixedContent = content;
      
      // Remove trailing commas
      fixedContent = fixedContent.replace(/,(\s*[}\]])/g, '$1');
      
      // Add missing quotes around keys
      fixedContent = fixedContent.replace(/(\s*)([a-zA-Z_]\w*)(\s*):/g, '$1"$2"$3:');
      
      // Try parsing again
      try {
        preset = JSON.parse(fixedContent);
        console.log(`  ✅ Fixed JSON syntax issues`);
      } catch (e) {
        console.log(`  ❌ Could not auto-fix JSON`);
        return false;
      }
    }
    
    let modified = false;
    
    // Check if preset has players array
    if (preset.players && Array.isArray(preset.players)) {
      const originalOrder = preset.players.map(p => p.roomName).join(', ');
      const reordered = reorderPlayers(preset.players);
      const newOrder = reordered.map(p => p.roomName).join(', ');
      
      if (originalOrder !== newOrder) {
        preset.players = reordered;
        modified = true;
        console.log(`  ✓ Reordered: ${originalOrder} → ${newOrder}`);
      }
    }
    
    // Validate preset structure
    const issues = [];
    
    // Check for required fields
    if (!preset.roomName && !preset.players) {
      issues.push('Missing roomName or players');
    }
    
    // Check players structure
    if (preset.players) {
      for (const player of preset.players) {
        if (!player.roomName) {
          issues.push('Player missing roomName');
        }
        if (player.volume !== undefined && (player.volume < 0 || player.volume > 100)) {
          issues.push(`Invalid volume ${player.volume} for ${player.roomName}`);
        }
      }
    }
    
    // Check playMode
    if (preset.playMode) {
      if (preset.playMode.repeat && !['none', 'all', 'one'].includes(preset.playMode.repeat)) {
        issues.push(`Invalid repeat mode: ${preset.playMode.repeat}`);
      }
    }
    
    // Legacy fields that should be migrated
    if (preset.state) {
      issues.push('Uses legacy "state" field - should be migrated to playMode');
      // Migrate state to playMode
      if (!preset.playMode) {
        preset.playMode = {};
      }
      if (preset.state.repeat !== undefined) preset.playMode.repeat = preset.state.repeat;
      if (preset.state.shuffle !== undefined) preset.playMode.shuffle = preset.state.shuffle;
      if (preset.state.crossfade !== undefined) preset.playMode.crossfade = preset.state.crossfade;
      delete preset.state;
      modified = true;
    }
    
    // Check for duplicate "shuffle", "repeat", "crossfade" at root level when playMode exists
    if (preset.playMode) {
      if (preset.shuffle !== undefined) {
        preset.playMode.shuffle = preset.shuffle;
        delete preset.shuffle;
        modified = true;
        issues.push('Moved shuffle to playMode');
      }
      if (preset.repeat !== undefined) {
        preset.playMode.repeat = preset.repeat;
        delete preset.repeat;
        modified = true;
        issues.push('Moved repeat to playMode');
      }
      if (preset.crossfade !== undefined) {
        preset.playMode.crossfade = preset.crossfade;
        delete preset.crossfade;
        modified = true;
        issues.push('Moved crossfade to playMode');
      }
    }
    
    if (issues.length > 0) {
      console.log(`  ⚠️  Issues found: ${issues.join(', ')}`);
    }
    
    // Write back if modified
    if (modified || issues.length > 0) {
      fs.writeFileSync(presetPath, JSON.stringify(preset, null, 2) + '\n');
      console.log(`  💾 Saved changes`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.log(`  ❌ Error processing ${presetPath}: ${error.message}`);
    return false;
  }
}

// Main execution
const presetsDir = path.resolve(__dirname, '../presets');
console.log(`Scanning presets in ${presetsDir}...\n`);

const presetFiles = getPresetFiles(presetsDir);
console.log(`Found ${presetFiles.length} preset files\n`);

let modifiedCount = 0;
let errorCount = 0;

for (const presetFile of presetFiles) {
  const relativePath = path.relative(presetsDir, presetFile);
  console.log(`Processing ${relativePath}:`);
  
  const result = fixPreset(presetFile);
  if (result === true) {
    modifiedCount++;
  } else if (result === false) {
    // Check if it was an error or just no changes needed
    try {
      JSON.parse(fs.readFileSync(presetFile, 'utf8'));
      console.log(`  ✓ No changes needed`);
    } catch (e) {
      errorCount++;
    }
  }
  console.log('');
}

console.log(`\nSummary:`);
console.log(`  Modified: ${modifiedCount} files`);
console.log(`  Errors: ${errorCount} files`);
console.log(`  Total: ${presetFiles.length} files`);