#!/usr/bin/env tsx
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const showDetailed = args.includes('--detailed');

interface TestInfo {
  file: string;
  describes: string[];
  tests: string[];
}

async function extractTestNames(filePath: string): Promise<{ describes: string[], tests: string[] }> {
  const describes: string[] = [];
  const tests: string[] = [];
  
  try {
    const content = await readFile(join(__dirname, filePath), 'utf-8');
    
    // Extract describe blocks
    const describeMatches = content.matchAll(/describe\s*\(\s*['"`]([^'"`]+)['"`]/g);
    for (const match of describeMatches) {
      describes.push(match[1]);
    }
    
    // Extract test/it blocks
    const testMatches = content.matchAll(/(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g);
    for (const match of testMatches) {
      tests.push(match[1]);
    }
  } catch (error) {
    // Error reading file
  }
  
  return { describes, tests };
}

async function findTestFiles(dir: string): Promise<TestInfo[]> {
  const files: TestInfo[] = [];
  try {
    const entries = await readdir(join(__dirname, dir), { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('-tests.ts')) {
        const filePath = `${dir}/${entry.name}`;
        const { describes, tests } = await extractTestNames(filePath);
        files.push({ file: filePath, describes, tests });
      }
    }
  } catch (error) {
    // Directory might not exist
  }
  
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function listTests() {
  console.log('📋 Available test files and test cases:\n');
  
  // Find all test files
  const unitTests = await findTestFiles('unit');
  const integrationTests = await findTestFiles('integration');
  
  const showTests = (tests: TestInfo[], title: string) => {
    if (tests.length > 0) {
      console.log(`${title}:`);
      tests.forEach(({ file, describes, tests }) => {
        console.log(`\n  📁 ${file}`);
        if (describes.length > 0) {
          console.log(`     Suites: ${describes.join(', ')}`);
        }
        if (tests.length > 0) {
          console.log(`     Tests: ${tests.length} test cases`);
          if (showDetailed) {
            // Show all test cases with numbers
            tests.forEach((test, i) => {
              console.log(`       ${i + 1}. "${test}"`);
            });
          } else {
            // Show first few test names as examples
            const examples = tests.slice(0, 3);
            examples.forEach(test => {
              console.log(`       • "${test}"`);
            });
            if (tests.length > 3) {
              console.log(`       ... and ${tests.length - 3} more`);
            }
          }
        }
      });
      console.log('');
    }
  };
  
  showTests(unitTests, 'Unit Tests');
  showTests(integrationTests, 'Integration Tests');
  
  const totalFiles = unitTests.length + integrationTests.length;
  const totalTests = [...unitTests, ...integrationTests].reduce((sum, t) => sum + t.tests.length, 0);
  console.log(`Total: ${totalFiles} test files, ${totalTests} test cases`);
  
  // Show how to run specific tests
  console.log('\n📝 Run specific tests:');
  console.log('\nBy filename:');
  console.log('   npm test -- <filename>');
  console.log('   npm test -- unit/volume-tests.ts');
  console.log('   npm test -- integration/playback-tests.ts');
  console.log('\nBy pattern (matches suite names, test names, or both):');
  console.log('   npm test -- --grep <pattern>');
  console.log('   npm test -- --grep "Absolute Volume"     # matches suite name');
  console.log('   npm test -- --grep "should set volume"   # matches test name');
  console.log('   npm test -- --grep "volume"              # matches anything with "volume"');
  console.log('\nCombine both:');
  console.log('   npm test -- integration/playback-tests.ts --grep "play"');
  
  if (!showDetailed) {
    console.log('\n💡 Use npm run test:list:detailed to see ALL test cases');
  }
}

listTests().catch(console.error);