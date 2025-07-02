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

// Cache for services lookup
let servicesCache: Record<string, any> | null = null;

async function getServices(): Promise<Record<string, any>> {
  if (!servicesCache) {
    try {
      const res = await fetch(`${API_URL}/services`);
      if (res.ok) {
        servicesCache = await res.json();
      } else {
        console.warn('Could not fetch services from API');
        servicesCache = {};
      }
    } catch (error) {
      console.warn('Error fetching services:', error);
      servicesCache = {};
    }
  }
  return servicesCache;
}

async function generateContentAnalysis(): Promise<string> {
  let output = '# Content Analysis\n\n';
  output += `Generated: ${new Date().toISOString().split('T')[0]}\n`;
  output += `API: ${API_URL}\n`;
  output += `Room: ${ROOM_NAME}\n\n`;
  
  // Fetch favorites
  const favoritesRes = await fetch(`${API_URL}/${ROOM_NAME}/favorites/detailed`);
  const favorites: Favorite[] = await favoritesRes.json();
  
  // Categorize favorites by URI type
  const favoritesByType: Record<string, Favorite[]> = {};
  
  favorites.forEach(fav => {
    if (!fav.uri) {
      console.warn('Favorite missing URI:', fav.title);
      return;
    }
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
    // Well-known URI types
    'x-sonosapi-stream': 'Music service streams (TuneIn, on-demand tracks, curated streams)',
    'x-sonosapi-radio': 'Personalized radio streams (e.g., Pandora stations)',
    'x-rincon-playlist': 'Sonos music library playlists (e.g., imported .m3u files)',
    'x-file-cifs': 'UNC path to music library content on SMB/CIFS shares',
    'x-sonosapi-hls': 'HTTP Live Streaming (Apple Music radio, dynamic streams)',
    'x-rincon-cpcontainer': 'Container references to music service content via SMAPI',
    'favorite': 'Legacy preset format that references a favorite by name',
    
    // Additional URI types
    'file': 'Local filesystem reference (not officially supported, may not work)',
    'x-rincon-mp3radio': 'MP3 Internet radio stream (legacy format)',
    'x-rincon-stream': 'Internal stream (often Line-In or TV audio rebroadcast)',
    'x-sonos-http': 'Direct HTTP stream from arbitrary URL (e.g., nature sounds)',
    'x-sonosapi-hls-static': 'Static HLS content (e.g., Calm app, Sonos Radio)',
    'x-sonos-spotify': 'Spotify tracks played directly'
  };
  
  let typeIndex = 1;
  Object.entries(favoritesByType).sort().forEach(([type, items]) => {
    output += `${typeIndex}. **\`${type}:\`** (${items.length} favorites)\n`;
    output += `   - ${uriTypeDescriptions[type] || 'Unknown URI type'}\n`;
    output += `   - Examples: ${items.slice(0, 3).map(i => i.title).join(', ')}\n\n`;
    typeIndex++;
  });
  
  // Fetch presets
  const presetsRes = await fetch(`${API_URL}/presets/detailed`);
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
  for (const f of favorites) {
    if (!f.uri) {
      console.warn('Favorite missing URI in services breakdown:', f.title);
      continue;
    }
    const uriType = f.uri.split(':')[0];
    let service = 'Unknown';
    
    if (uriType === 'x-file-cifs' || uriType === 'x-rincon-playlist') {
      service = 'Music Library';
    } else if (uriType === 'x-rincon-stream') {
      service = 'Line-In/Internal Stream';
    } else if (uriType === 'x-sonos-http') {
      service = 'HTTP Stream';
    } else if (uriType === 'x-sonosapi-hls-static') {
      service = 'HLS Stream (Calm/Sonos Radio)';
    } else if (uriType === 'x-rincon-mp3radio') {
      service = 'MP3 Radio Stream';
    } else if (uriType === 'file') {
      service = 'Local File (Unsupported)';
    } else if (uriType === 'x-sonos-spotify') {
      service = 'Spotify';
    } else if (uriType === 'x-sonosapi-stream') {
      // x-sonosapi-stream without metadata is typically TuneIn
      service = 'TuneIn';
    } else if (f.metadata) {
      // First check for standard service IDs
      const serviceMatch = f.metadata.match(/SA_RINCON(\d+)(?:_|$)/);
      if (serviceMatch) {
        const serviceId = serviceMatch[1];
        const services = await getServices();
        
        // Check if we have this service in our dynamic list
        if (services[serviceId]) {
          service = services[serviceId].name;
          // Special handling for personalized services
          if (services[serviceId].isPersonalized && services[serviceId].isTuneIn) {
            service = 'TuneIn';
          }
        } else {
          // Fall back to hardcoded mappings for legacy/common services
          // Note: Spotify IDs are handled dynamically through discovered service IDs
          service = {
            '204': 'Sonos Radio',
            '254': 'TuneIn',
            '236': 'Pandora',
            '13': 'Amazon Music',
            '368': 'YouTube Music',
            '7': 'Deezer',
            '166': 'iHeartRadio',
            '15': 'Napster',
            '259': 'Qobuz',
            '160': 'Tidal',
            '38': 'SiriusXM',
            '216': 'SoundCloud',
            '350': 'Audacy',
            '518': 'Bandcamp',
            '550': 'BBC Sounds',
            '248': 'Calm Radio',
            '302': 'Idagio',
            '275': 'Plex',
            '331': 'Datpiff',
            '444': 'Amazon Audible',
            '452': 'Hoopla',
            // Service-specific metadata IDs
            '9223': 'HEARTS of SPACE',
            '51463': 'RadioApp',
            // Legacy mappings
            '60423': 'Pandora',
            '77575': 'TuneIn',
            '52231': 'Apple Music',
            '303': 'TuneIn'
          }[serviceId] || `Service ${serviceId}`;
        }
      } else {
        // Check for extended format (e.g., SA_RINCON85255_X_#Svc85255-0-Token)
        // These are typically TuneIn stations with user-specific service IDs
        const extendedMatch = f.metadata.match(/SA_RINCON(\d{5,})_X_/);
        if (extendedMatch && (uriType === 'x-sonosapi-stream' || uriType === 'x-sonosapi-radio')) {
          service = 'TuneIn';
        }
      }
    }
    
    serviceMap[service] = (serviceMap[service] || 0) + 1;
  }
  
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
  
  for (const [type, items] of Object.entries(favoritesByType).sort()) {
    output += `#### ${type} (${items.length} items)\n`;
    for (const item of items) {
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
      } else if (type === 'x-sonosapi-radio' || type === 'x-sonosapi-stream' || type === 'x-sonosapi-hls-static') {
        const serviceMatch = item.metadata?.match(/SA_RINCON(\d+)/);
        if (serviceMatch) {
          const serviceId = serviceMatch[1];
          const services = await getServices();
          let serviceName = 'Unknown';
          
          // Check if we have this service in our dynamic list
          if (services[serviceId]) {
            serviceName = services[serviceId].name;
            // Special handling for personalized services
            if (services[serviceId].isPersonalized && services[serviceId].isTuneIn) {
              serviceName = 'TuneIn';
            }
          } else {
            // Fall back to hardcoded mappings for legacy/common services
            serviceName = {
              '204': 'Sonos Radio',  // Also Apple Music - differentiated by URI
              '254': 'TuneIn',
              '236': 'Pandora',
              '9': 'Spotify',
              '13': 'Amazon Music',
              '368': 'YouTube Music',
              '7': 'Deezer',
              '166': 'iHeartRadio',
              '15': 'Napster',
              '259': 'Qobuz',
              '160': 'Tidal',
              '38': 'SiriusXM',
              '216': 'SoundCloud',
              '350': 'Audacy',
              '518': 'Bandcamp',
              '550': 'BBC Sounds',
              '248': 'Calm Radio',
              '302': 'Idagio',
              '275': 'Plex',
              '331': 'Datpiff',
              '444': 'Amazon Audible',
              '452': 'Hoopla',
              // Service-specific metadata IDs
              '9223': 'HEARTS of SPACE',
              '51463': 'RadioApp',
              // Legacy mappings
              '60423': 'Pandora',
              '77575': 'TuneIn',
              '52231': 'Apple Music',
              '303': 'TuneIn'
            }[serviceId] || (() => {
              const serviceIdNum = parseInt(serviceId, 10);
              // 5-digit IDs starting with 8 or 9 are typically user-specific TuneIn accounts
              if (serviceIdNum >= 80000 && serviceIdNum <= 99999 && type === 'x-sonosapi-stream') {
                return 'TuneIn';
              }
              return 'Unknown';
            })();
          }
          output += ` (${serviceName})`;
        } else {
          // For x-sonosapi-stream, check for extended format or default to TuneIn
          if (type === 'x-sonosapi-stream') {
            // Check for the extended format SA_RINCON#####_X_#Svc#####-0-Token
            const extendedMatch = item.metadata?.match(/SA_RINCON(\d+)_X_/);
            if (extendedMatch || !item.metadata) {
              // These are typically TuneIn stations
              output += ' (TuneIn)';
            } else {
              // Debug: what's in the metadata?
              console.error(`Stream ${item.title} has metadata but no extended match: ${item.metadata?.substring(0, 100)}`);
            }
          } else if (type === 'x-sonosapi-radio' || type === 'x-sonosapi-hls-static') {
            // Check for the extended format SA_RINCON#####_X_#Svc#####-0-Token
            const extendedMatch = item.metadata?.match(/SA_RINCON(\d+)_X_/);
            if (extendedMatch) {
              // These are typically TuneIn stations with account-specific IDs
              output += ' (TuneIn)';
            }
          }
        }
      }
      output += '\n';
    }
    output += '\n';
  }
  
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
  const presetsRes = await fetch(`${API_URL}/presets/detailed`);
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
  
  // Special cases analysis - create case-insensitive lookup
  const presetFavoritesLower = new Set(
    Object.values(allPresets)
      .map((p: any) => p._originalFavorite)
      .filter(Boolean)
      .map((name: string) => name.toLowerCase())
  );
  
  // Also check preset names themselves for favorites
  const presetNamesLower = new Set(
    Object.keys(allPresets).map(name => name.toLowerCase())
  );
  
  // Fetch favorites to find missing ones
  const favoritesRes = await fetch(`${API_URL}/${ROOM_NAME}/favorites/detailed`);
  const favorites = await favoritesRes.json();
  
  // Check both _originalFavorite and preset names (case-insensitive)
  const missingFromPresets = favorites.filter((f: any) => {
    if (!f.title) {
      console.warn('Favorite missing title:', JSON.stringify(f));
      return false;
    }
    const favLower = f.title.toLowerCase();
    return !presetFavoritesLower.has(favLower) && !presetNamesLower.has(favLower);
  });
  
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
  output += '3. **Note**: Favorite matching is case-insensitive, so "Classical 101" matches "classical 101"\n';
  
  return output;
}

async function generateMusicLibraryAnalysis(): Promise<string> {
  let output = '# Music Library Analysis\n\n';
  output += `Generated: ${new Date().toISOString().split('T')[0]}\n`;
  output += `API: ${API_URL}\n\n`;
  
  try {
    // Get library summary
    const summaryRes = await fetch(`${API_URL}/library/summary`);
    const summary = await summaryRes.json();
    
    if (summary.status === 'not initialized') {
      output += '**Music library not initialized**\n';
      return output;
    }
    
    // Also save the detailed library data as JSON
    try {
      const detailedRes = await fetch(`${API_URL}/library/detailed`);
      const detailed = await detailedRes.json();
      
      // Save to output directory if we have it
      const outputDir = process.argv[4];
      if (outputDir && detailed && !detailed.status) {
        // Strip out the *Lower fields and albumArtURI to reduce file size
        if (detailed.tracks) {
          detailed.tracks = detailed.tracks.map((track: any) => {
            const { titleLower, artistLower, albumLower, albumArtURI, ...cleanTrack } = track;
            return cleanTrack;
          });
        }
        
        const { execSync } = await import('child_process');
        const jsonFile = join(outputDir, 'music-library.json');
        
        // Check if jq is available for pretty printing
        try {
          execSync('which jq', { stdio: 'ignore' });
          // Use jq for pretty printing
          writeFileSync(jsonFile + '.tmp', JSON.stringify(detailed));
          execSync(`jq . "${jsonFile}.tmp" > "${jsonFile}"`, { stdio: 'ignore' });
          execSync(`rm "${jsonFile}.tmp"`, { stdio: 'ignore' });
        } catch {
          // Fall back to JSON.stringify with indentation
          writeFileSync(jsonFile, JSON.stringify(detailed, null, 2));
        }
      }
    } catch (error) {
      console.log('Note: Could not save library cache JSON:', error);
    }
    
    output += '## Overview\n\n';
    output += `- **Total Tracks**: ${summary.totalTracks?.toLocaleString() || 0}\n`;
    output += `- **Total Artists**: ${summary.totalArtists?.toLocaleString() || 0}\n`;
    output += `- **Total Albums**: ${summary.totalAlbums?.toLocaleString() || 0}\n`;
    output += `- **Last Updated**: ${summary.lastUpdated ? new Date(summary.lastUpdated).toLocaleString() : 'Unknown'}\n`;
    output += `- **Status**: ${summary.isIndexing ? 'Indexing in progress' : 'Complete'}\n\n`;
    
    // Calculate stats
    const avgTracksPerArtist = summary.totalArtists > 0 ? (summary.totalTracks / summary.totalArtists).toFixed(1) : '0';
    const avgTracksPerAlbum = summary.totalAlbums > 0 ? (summary.totalTracks / summary.totalAlbums).toFixed(1) : '0';
    
    output += '## Statistics\n\n';
    output += `- **Average tracks per artist**: ${avgTracksPerArtist}\n`;
    output += `- **Average tracks per album**: ${avgTracksPerAlbum}\n\n`;
    
    // Top artists
    if (summary.topArtists && summary.topArtists.length > 0) {
      output += '## Top 10 Artists by Track Count\n\n';
      summary.topArtists.slice(0, 10).forEach((artist: any, i: number) => {
        output += `${i + 1}. **${artist.name}** - ${artist.trackCount} tracks\n`;
      });
      output += '\n';
    }
    
    // Top albums
    if (summary.topAlbums && summary.topAlbums.length > 0) {
      output += '## Top 10 Albums by Track Count\n\n';
      summary.topAlbums.slice(0, 10).forEach((album: any, i: number) => {
        output += `${i + 1}. **${album.name}** - ${album.trackCount} tracks\n`;
      });
    }
    
  } catch (error) {
    output += `**Error fetching library data**: ${error}\n`;
  }
  
  return output;
}

async function main() {
  try {
    console.log(`Analyzing Sonos content from ${API_URL}...`);
    
    // Generate all reports
    const [contentAnalysis, validationReport, libraryAnalysis] = await Promise.all([
      generateContentAnalysis(),
      generateValidationReport(),
      generateMusicLibraryAnalysis()
    ]);
    
    // Save to output directory (will be created by shell script)
    const outputDir = process.argv[4] || '.';
    
    writeFileSync(join(outputDir, 'content-analysis.md'), contentAnalysis);
    writeFileSync(join(outputDir, 'preset-validation-results.md'), validationReport);
    writeFileSync(join(outputDir, 'music-library-analysis.md'), libraryAnalysis);
    
    console.log(`✅ Reports generated in ${outputDir}`);
    console.log('  - content-analysis.md');
    console.log('  - preset-validation-results.md');
    console.log('  - music-library-analysis.md');
  } catch (error) {
    console.error('❌ Error generating reports:', error);
    process.exit(1);
  }
}

main();