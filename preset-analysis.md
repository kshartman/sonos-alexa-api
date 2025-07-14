# Preset Analysis Report

## Comparison of Preset Files

### Files in std (35 total)
```
ambient_radio.json
an_african_night.json
archaic_beats.json
baroque_classics.json
baroque_radio.json
blues_acoustic.json
blues_chicago.json
blues_electric.json
blues_radio.json
blues_uk_radio.json
boot_liquor.json
classical_baroque.json
classical_guitar.json
classical_quiet.json
classical_radio.json
crickets_summer_night.json
dark_ambient_radio.json
electronic_radio.json
gangsta_rap_radio.json
hearts_of_space.json
jazz_radio.json
jazz_smooth.json
kera.json
middle_eastern.json
ocean_sounds.json
ocean_waves.json
reggae_music.json
reggae_radio.json
reggae_roots.json
rock_classic.json
rock_hard.json
rock_radio.json
rock_swamp_radio.json
sahara_sunset_radio.json
secret_agent.json
this_weeks_show.json
thundering_rainstorm.json
toad_trills_and_thunder.json
```

### Files from std missing in worf: NONE

### Files from std missing in talon:
- baroque_classics.json
- baroque_radio.json
- jazz_radio.json
- jazz_smooth.json
- rock_swamp_radio.json

### Additional files in worf (not in std):
- dark_ambient_spotify.json
- lounge.json

### Additional files in talon (not in std):
- aardvark_blues_fm.json
- blues_uk_radio.json
- christmas_radio.json
- classical_101.json
- houston_blues_radio.json
- ocean_surf.json
- quiet_music.json
- rain.json
- roots_reggae.json
- lounge.json

## Symbolic Link Analysis

### Worf Symbolic Links (91 total)
The symbolic links in worf create these alias mappings:

#### Ambient/Dark
- "ambient" → ambient_radio.json
- "ambient music" → ambient_radio.json
- "dark ambient" → dark_ambient_radio.json

#### African
- "africa" → an_african_night.json
- "african night" → an_african_night.json

#### Archaic/Ancient
- "ancient beat" → archaic_beats.json
- "ancient beats" → archaic_beats.json
- "archaic beat" → archaic_beats.json

#### Blues
- "acoustic blues" → blues_acoustic.json
- "blues" → blues_chicago.json
- "blues music" → blues_chicago.json
- "chicago blues" → blues_chicago.json
- "classic blues" → blues_chicago.json
- "electric blues" → blues_electric.json
- "blues uk" → blues_uk_radio.json

#### Classical/Baroque
- "baroque" → classical_baroque.json
- "baroque classical" → classical_baroque.json
- "baroque music" → classical_baroque.json
- "classical" → classical_radio.json
- "classical 101" → classical_radio.json
- "classical music" → classical_radio.json
- "quiet classical" → classical_quiet.json
- "quiet classical music" → classical_quiet.json
- "wrr" → classical_radio.json

#### Country
- "boot licker" → boot_liquor.json
- "boot liquor radio" → boot_liquor.json
- "country" → boot_liquor.json
- "country music" → boot_liquor.json
- "shit kicker" → boot_liquor.json
- "shit kicker music" → boot_liquor.json

#### Jazz
- "jazz" → jazz_radio.json
- "jazz music" → jazz_radio.json
- "quiet jazz" → jazz_smooth.json
- "smooth jazz" → jazz_smooth.json

#### Nature Sounds
- "crickets" → crickets_summer_night.json
- "summer crickets" → crickets_summer_night.json
- "frogs" → toad_trills_and_thunder.json
- "toads" → toad_trills_and_thunder.json
- "thunder toads" → toad_trills_and_thunder.json
- "thunder tones" → toad_trills_and_thunder.json
- "thunder tongues" → toad_trills_and_thunder.json
- "ocean souunds" → ocean_sounds.json (note typo)
- "ocean surf" → ocean_sounds.json
- "rain" → thundering_rainstorm.json
- "thunder" → thundering_rainstorm.json
- "thunder storm" → thundering_rainstorm.json
- "thunderstorm" → thundering_rainstorm.json

#### Public Radio
- "kera radio" → kera.json
- "npr" → kera.json
- "npr radio" → kera.json
- "pbs" → kera.json
- "public radio" → kera.json

#### Rock/Electronic
- "classic rock" → rock_classic.json
- "classic rock music" → rock_classic.json
- "electronic" → electronic_radio.json
- "electronic music" → electronic_radio.json
- "gangsta" → gangsta_rap_radio.json
- "gangsta radio" → gangsta_rap_radio.json
- "gangsta rap" → gangsta_rap_radio.json
- "gangster" → gangsta_rap_radio.json
- "gangster radio" → gangsta_rap_radio.json
- "hard rock" → rock_hard.json
- "rock" → rock_radio.json
- "rock music" → rock_radio.json
- "swamp rock" → rock_swamp_radio.json
- "swamp rock radio" → rock_swamp_radio.json

#### Reggae
- "reggae" → reggae_radio.json
- "reggae radio" → reggae_radio.json
- "reggae roots" → reggae_roots.json
- "reggae roots music" → reggae_roots.json
- "roots reggae" → reggae_roots.json
- "roots reggae music" → reggae_roots.json

#### Other
- "hearts of space" → hearts_of_space.json
- "hos" → hearts_of_space.json
- "middle eastern music" → middle_eastern.json
- "music for spys" → secret_agent.json
- "sahara sunset" → sahara_sunset_radio.json
- "secret agent radio" → secret_agent.json
- "spy music" → secret_agent.json
- "spy music radio" → secret_agent.json
- "this week show" → this_weeks_show.json
- "this week's show" → this_weeks_show.json

### Talon Symbolic Links (74 total)
Similar patterns but with some key differences:
- "lounge" → sahara_sunset_radio.json (unique mapping)
- "reggae radio" → roots_reggae.json (different target than worf)
- "wrr" → classical_101.json (different target than worf)
- Missing some aliases that worf has

## Comparison with stdPresetAliases in options.shane.js

The `stdPresetAliases` variable defines these mappings, which should be reflected in the symbolic links:

### Discrepancies Found:

1. **Missing Aliases in File System:**
   - "boot liquor" preset aliases missing "boot liquor" itself as a link
   - "classical guitar music" alias defined but not found as symlink
   - "dark ambient radio" alias defined but only "dark ambient" found
   - Several "jazz" related aliases missing in talon
   - "ocean waves" has no aliases in either system

2. **Different Mappings:**
   - In talon: "lounge" → sahara_sunset_radio.json (not defined in stdPresetAliases)
   - In talon: "reggae radio" → roots_reggae.json (should be reggae_radio.json per stdPresetAliases)

3. **Typos in File System:**
   - "ocean souunds" instead of "ocean sounds" in worf

4. **Additional Aliases Not in stdPresetAliases:**
   - Various shortcuts and variations created as symlinks but not defined in the code

## Recommendations:

1. **Sync std presets to talon:** Add the 5 missing presets to talon
2. **Fix typos:** "ocean souunds" → "ocean sounds"
3. **Standardize mappings:** Ensure "reggae radio" points to same target in both systems
4. **Update stdPresetAliases:** Add missing aliases that exist as symlinks but aren't in the code
5. **Create missing symlinks:** Add aliases defined in stdPresetAliases but missing from file system