#!/usr/bin/env tsx
/**
 * Analyzes Sonos favorites and presets to generate comprehensive reports
 * Usage: tsx analyze-home-content.ts [api-url] [room-name]
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface Favorite {
  title: string;
  uri: string;
  metadata: string;
}

interface Preset {
  uri: string;
  metadata?: string;
  volume?: number;
  _originalFavorite?: string;
  _legacy?: any;
}

const API_URL = process.argv[2] || 'http://localhost:5005';
const ROOM_NAME = process.argv[3] || 'ShanesOfficeSpeakers';

async function generateContentAnalysis(): Promise<string> {
  let output = '# Content Analysis\n\n';
  output += `Generated: ${new Date().toISOString().split('T')[0]}\n`;
  output += `API: ${API_URL}\n`;
  output += `Room: ${ROOM_NAME}\n\n`;
  
  // Fetch favorites
  const favoritesRes = await fetch(`${API_URL}/${ROOM_NAME}/favorites?detailed=true`);
  const favorites: Favorite[] = await favoritesRes.json();
  
  // Categorize favorites by URI type
  const favoritesByType: Record<string, Favorite[]> = {};
  
  favorites.forEach(fav => {
    const uriType = fav.uri.split(':')[0];
    if (!favoritesByType[uriType]) {
      favoritesByType[uriType] = [];
    }
    favoritesByType[uriType].push(fav);
  });
  
  output += '## Summary of Content Types\n\n';
  output += '### URI Types and Their Purposes:\n\n';
  
  // Generate summary
  const uriTypeDescriptions: Record<string, string> = {
    'x-sonosapi-stream': 'TuneIn radio stations and other streaming services',
    'x-sonosapi-radio': 'Pandora stations and other personalized radio services',
    'x-rincon-playlist': 'Music library playlists and albums',
    'x-file-cifs': 'Direct file references for music library content',
    'x-sonosapi-hls': 'HTTP Live Streaming (Apple Music radio)',
    'x-rincon-cpcontainer': 'Container references for albums/playlists from music services',
    'favorite': 'Legacy preset format that references a favorite by name'
  };
  
  let typeIndex = 1;
  Object.entries(favoritesByType).sort().forEach(([type, items]) => {
    output += `${typeIndex}. **\`${type}:\`** (${items.length} favorites)\n`;
    output += `   - ${uriTypeDescriptions[type] || 'Unknown URI type'}\n`;
    output += `   - Examples: ${items.slice(0, 3).map(i => i.title).join(', ')}\n\n`;
    typeIndex++;
  });
  
  // Fetch presets
  const presetsRes = await fetch(`${API_URL}/presets?detailed=true`);
  const presetsData = await presetsRes.json();
  const presets: Record<string, Preset> = presetsData.all;
  
  // Count presets by type
  const presetsByType: Record<string, number> = {};
  Object.values(presets).forEach(preset => {
    const uriType = preset.uri.split(':')[0];
    presetsByType[uriType] = (presetsByType[uriType] || 0) + 1;
  });
  
  // Services breakdown
  const serviceMap: Record<string, number> = {};
  favorites.forEach((f: any) => {
    const uriType = f.uri.split(':')[0];
    let service = 'Unknown';
    
    if (uriType === 'x-file-cifs' || uriType === 'x-rincon-playlist') {
      service = 'Music Library';
    } else if (f.metadata) {
      const serviceMatch = f.metadata.match(/SA_RINCON(\d+)/);
      if (serviceMatch) {
        service = {
          '60423': 'Pandora',
          '77575': 'TuneIn', 
          '52231': 'Apple Music',
          '236': 'Pandora',
          '303': 'TuneIn',
          '204': 'Apple Music'
        }[serviceMatch[1]] || `Service ${serviceMatch[1]}`;
      }
    }
    
    serviceMap[service] = (serviceMap[service] || 0) + 1;
  });
  
  output += '### Services Breakdown:\n';
  Object.entries(serviceMap).forEach(([service, count]) => {
    output += `- **${service}**: ${count} items\n`;
  });
  
  // Special characteristics
  const multiRoomPresets = Object.values(presets).filter(p => 
    p._legacy?.players && p._legacy.players.length > 1
  ).length;
  
  const naturePatterns = /ocean|rain|thunder|cricket|frog|toad|storm|nature|relax|ambient|sounds|surf/i;
  const natureFavorites = favorites.filter(f => naturePatterns.test(f.title));
  
  output += '\n### Special Characteristics:\n';
  output += `- **Multi-room presets**: ${multiRoomPresets}\n`;
  output += `- **Nature/Ambient sounds**: ${natureFavorites.length}\n`;
  output += `- **Total favorites**: ${favorites.length}\n`;
  output += `- **Total presets**: ${Object.keys(presets).length}\n`;
  
  // Detailed listings
  output += '\n## Detailed Analysis\n\n';
  output += '### Favorites by Type\n\n';
  
  Object.entries(favoritesByType).sort().forEach(([type, items]) => {
    output += `#### ${type} (${items.length} items)\n`;
    items.forEach(item => {
      output += `- ${item.title}`;
      
      // Add extra details based on type
      if (type === 'x-rincon-playlist') {
        const match = item.uri.match(/#(.+)$/);
        if (match) {
          const playlistType = match[1].startsWith('A:') ? 'Album' : 'Playlist';
          output += ` → ${playlistType}: ${decodeURIComponent(match[1])}`;
        }
      } else if (type === 'x-file-cifs') {
        output += ` → Path: ${item.uri.substring(13)}`;
      } else if (type === 'x-sonosapi-radio' || type === 'x-sonosapi-stream') {
        const serviceMatch = item.metadata?.match(/SA_RINCON(\d+)/);
        if (serviceMatch) {
          const serviceName = {
            '60423': 'Pandora',
            '77575': 'TuneIn',
            '52231': 'Apple Music',
            '236': 'Pandora',
            '303': 'TuneIn',
            '204': 'Apple Music'
          }[serviceMatch[1]] || 'Unknown';
          output += ` (${serviceName})`;
        }
      }
      output += '\n';
    });
    output += '\n';
  });
  
  return output;
}

async function generateValidationReport(): Promise<string> {
  let output = '# Preset Validation Results\n\n';
  output += `Generated: ${new Date().toISOString().split('T')[0]}\n`;
  output += `API: ${API_URL}\n\n`;
  
  // Try to fetch startup info for accurate preset validation data
  let startupData: any = null;
  try {
    const startupRes = await fetch(`${API_URL}/debug/startup`);
    if (startupRes.ok) {
      startupData = await startupRes.json();
    }
  } catch (error) {
    console.log('Note: /debug/startup endpoint not available, using preset data only');
  }
  
  // Fetch presets for detailed info
  const presetsRes = await fetch(`${API_URL}/presets?detailed=true`);
  const presetsData = await presetsRes.json();
  const allPresets = presetsData.all || {};
  
  // Use startup data if available, otherwise fall back to preset data
  const stats = startupData?.presets?.stats || {};
  const validPresets = startupData?.presets?.validPresets || presetsData.valid || [];
  const failedPresets = startupData?.presets?.failedPresets || presetsData.failed || [];
  const invalidPresets = startupData?.presets?.invalidPresets || presetsData.invalid || [];
  const parseErrors = startupData?.presets?.parseErrors || [];
  const invalidRooms = startupData?.presets?.invalidRooms || [];
  
  const totalPresets = stats.totalFiles || Object.keys(allPresets).length;
  const validCount = stats.validPresets || validPresets.length;
  const failedCount = stats.failedResolution || failedPresets.length;
  const invalidCount = stats.invalidFormat || invalidPresets.length;
  const parseErrorCount = stats.parseErrors || parseErrors.length;
  const invalidRoomCount = stats.invalidRooms || invalidRooms.length;
  
  output += '## Summary\n\n';
  output += `- **Total presets found**: ${totalPresets}\n`;
  output += `- **Valid presets**: ${validCount} (${totalPresets > 0 ? ((validCount/totalPresets)*100).toFixed(1) : '0.0'}%)\n`;
  output += `- **Failed favorite resolution**: ${failedCount} (${totalPresets > 0 ? ((failedCount/totalPresets)*100).toFixed(1) : '0.0'}%)\n`;
  output += `- **Invalid format**: ${invalidCount}\n`;
  output += `- **Parse errors**: ${parseErrorCount}\n`;
  output += `- **Invalid rooms**: ${invalidRoomCount}\n\n`;
  
  // Valid presets
  output += `## Valid Presets (${validCount})\n\n`;
  output += 'These presets loaded successfully and are ready to use:\n\n';
  const sortedValid = [...validPresets].sort();
  sortedValid.forEach((name, i) => {
    output += `${i + 1}. ${name}\n`;
  });
  
  // Failed presets
  if (failedCount > 0) {
    output += `\n## Failed Presets (${failedCount})\n\n`;
    output += 'These presets failed to resolve because they use the legacy `favorite:` URI format ';
    output += 'and the referenced favorites don\'t exist in the current Sonos system:\n\n';
    
    const sortedFailed = [...failedPresets].sort();
    sortedFailed.forEach((name, i) => {
      const preset = allPresets[name];
      if (preset) {
        output += `### ${i + 1}. ${name}\n`;
        output += `- **URI**: \`${preset.uri}\`\n`;
        output += `- **Issue**: ${preset.uri.replace('favorite:', 'Favorite "')} not found\n`;
        output += `- **Solution**: Create a favorite named "${preset.uri.replace('favorite:', '')}" or update preset to use direct URI\n\n`;
      }
    });
  }
  
  // Special cases analysis
  const presetFavorites = new Set(
    Object.values(allPresets).map((p: any) => p._originalFavorite).filter(Boolean)
  );
  
  // Fetch favorites to find missing ones
  const favoritesRes = await fetch(`${API_URL}/${ROOM_NAME}/favorites?detailed=true`);
  const favorites = await favoritesRes.json();
  
  const missingFromPresets = favorites.filter((f: any) => !presetFavorites.has(f.title));
  
  if (missingFromPresets.length > 0) {
    output += '## Favorites NOT in Presets\n\n';
    output += `Found ${missingFromPresets.length} favorites that don't have corresponding presets:\n\n`;
    missingFromPresets.forEach((f: any) => {
      output += `- ${f.title} (${f.uri.split(':')[0]})\n`;
    });
  }
  
  output += '\n## Recommendations\n\n';
  output += '1. **Update Legacy Presets**: Convert failed presets from `favorite:` format to direct URIs\n';
  output += '2. **Create Missing Presets**: Add presets for favorites that don\'t have them\n';
  output += '3. **Consistent Naming**: Ensure favorite names match exactly (case-sensitive)\n';
  
  return output;
}

async function main() {
  try {
    console.log(`Analyzing Sonos content from ${API_URL}...`);
    
    // Generate both reports
    const [contentAnalysis, validationReport] = await Promise.all([
      generateContentAnalysis(),
      generateValidationReport()
    ]);
    
    // Save to output directory (will be created by shell script)
    const outputDir = process.argv[4] || '.';
    
    writeFileSync(join(outputDir, 'content-analysis.md'), contentAnalysis);
    writeFileSync(join(outputDir, 'preset-validation-results.md'), validationReport);
    
    console.log(`✅ Reports generated in ${outputDir}`);
    console.log('  - content-analysis.md');
    console.log('  - preset-validation-results.md');
  } catch (error) {
    console.error('❌ Error generating reports:', error);
    process.exit(1);
  }
}

main();