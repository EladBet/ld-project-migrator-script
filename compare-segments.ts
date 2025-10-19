// compare-segments.ts
import { getJson } from "./utils.ts";
import * as Colors from "https://deno.land/std/fmt/colors.ts";
import yargs from "https://deno.land/x/yargs@v17.7.2-deno/deno.ts";

interface Arguments {
  primaryFolder: string;
  destinationFolder: string;
}

interface Segment {
  name: string;
  key: string;
  description?: string;
  tags?: string[];
  included?: string[];
  excluded?: string[];
  includedContexts?: any[];
  excludedContexts?: any[];
  rules?: any[];
  [key: string]: any;
}

interface SegmentData {
  items: Segment[];
}

interface SegmentDifference {
  segmentName: string;
  segmentKey: string;
  status: 'identical' | 'modified' | 'added' | 'removed';
  differences: Array<{
    property: string;
    value1: any;
    value2: any;
    isArrayCount?: boolean;
  }>;
}

// Properties to exclude from comparison (metadata that's expected to differ)
const EXCLUDED_PROPERTIES = [
  "_id", "_links", "creationDate", "lastModifiedDate", "generation", "version"
];

// Array properties where we only want to show counts
const ARRAY_COUNT_PROPERTIES = [
  "included", "excluded", "includedContexts", "excludedContexts"
];

function removeExcludedProperties(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => removeExcludedProperties(item));
  }
  
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!EXCLUDED_PROPERTIES.includes(key)) {
      cleaned[key] = removeExcludedProperties(value);
    }
  }
  
  return cleaned;
}

function findDifferences(
  obj1: any,
  obj2: any,
  path: string = "",
  parentKey: string = ""
): Array<{ property: string; value1: any; value2: any; isArrayCount?: boolean }> {
  const differences: Array<{ property: string; value1: any; value2: any; isArrayCount?: boolean }> = [];
  
  // If both are primitive values, compare directly
  if (obj1 === null || obj2 === null || typeof obj1 !== 'object' || typeof obj2 !== 'object') {
    if (obj1 !== obj2) {
      differences.push({
        property: path || "root",
        value1: obj1,
        value2: obj2
      });
    }
    return differences;
  }
  
  // Handle arrays - check if this is a count-only property
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    const currentProperty = path.split('.').pop() || path;
    
    if (ARRAY_COUNT_PROPERTIES.includes(currentProperty)) {
      // Only compare counts for these arrays
      if (obj1.length !== obj2.length) {
        differences.push({
          property: path,
          value1: obj1.length,
          value2: obj2.length,
          isArrayCount: true
        });
      }
      return differences;
    }
    
    // For other arrays, do deep comparison
    const maxLength = Math.max(obj1.length, obj2.length);
    for (let i = 0; i < maxLength; i++) {
      const currentPath = path ? `${path}[${i}]` : `[${i}]`;
      const val1 = i < obj1.length ? obj1[i] : undefined;
      const val2 = i < obj2.length ? obj2[i] : undefined;
      
      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        differences.push(...findDifferences(val1, val2, currentPath));
      }
    }
    return differences;
  }
  
  // Handle type mismatch
  if (Array.isArray(obj1) !== Array.isArray(obj2)) {
    differences.push({
      property: path || "root",
      value1: obj1,
      value2: obj2
    });
    return differences;
  }
  
  // Get all keys from both objects
  const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
  
  for (const key of allKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const val1 = obj1[key];
    const val2 = obj2[key];
    
    if (!(key in obj1)) {
      differences.push({
        property: currentPath,
        value1: undefined,
        value2: val2
      });
    } else if (!(key in obj2)) {
      differences.push({
        property: currentPath,
        value1: val1,
        value2: undefined
      });
    } else {
      differences.push(...findDifferences(val1, val2, currentPath, key));
    }
  }
  
  return differences;
}

function compareSegments(segments1: Segment[], segments2: Segment[]): SegmentDifference[] {
  const results: SegmentDifference[] = [];
  
  // Create maps by segment key for easy lookup
  const segmentMap1 = new Map(segments1.map(s => [s.key, s]));
  const segmentMap2 = new Map(segments2.map(s => [s.key, s]));
  
  const allKeys = new Set([...segmentMap1.keys(), ...segmentMap2.keys()]);
  
  for (const key of allKeys) {
    const seg1 = segmentMap1.get(key);
    const seg2 = segmentMap2.get(key);
    
    if (!seg1 && seg2) {
      // Segment only exists in second project (added)
      results.push({
        segmentName: seg2.name,
        segmentKey: key,
        status: 'added',
        differences: []
      });
    } else if (seg1 && !seg2) {
      // Segment only exists in first project (removed)
      results.push({
        segmentName: seg1.name,
        segmentKey: key,
        status: 'removed',
        differences: []
      });
    } else if (seg1 && seg2) {
      // Segment exists in both - compare them
      const cleaned1 = removeExcludedProperties(seg1);
      const cleaned2 = removeExcludedProperties(seg2);
      
      const diffs = findDifferences(cleaned1, cleaned2);
      
      if (diffs.length === 0) {
        results.push({
          segmentName: seg1.name,
          segmentKey: key,
          status: 'identical',
          differences: []
        });
      } else {
        results.push({
          segmentName: seg1.name,
          segmentKey: key,
          status: 'modified',
          differences: diffs
        });
      }
    }
  }
  
  return results;
}

function formatValue(value: any, isArrayCount: boolean = false): string {
  if (isArrayCount) {
    return `${value} items`;
  }
  
  if (value === undefined) {
    return "undefined";
  }
  
  if (value === null) {
    return "null";
  }
  
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (value.length <= 3) {
      return JSON.stringify(value);
    }
    return `[${value.length} items]`;
  }
  
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  
  return String(value);
}

async function generateReport(
  results: SegmentDifference[],
  project1: string,
  project2: string
): Promise<void> {
  const reportLines: string[] = [];
  
  reportLines.push("# Segment Comparison Report\n");
  reportLines.push(`**Projects:** ${project1} vs ${project2}\n`);
  reportLines.push(`**Date:** ${new Date().toISOString()}\n`);
  
  const stats = {
    total: results.length,
    identical: results.filter(r => r.status === 'identical').length,
    modified: results.filter(r => r.status === 'modified').length,
    added: results.filter(r => r.status === 'added').length,
    removed: results.filter(r => r.status === 'removed').length
  };
  
  reportLines.push("## Summary\n");
  reportLines.push(`- **Total Segments:** ${stats.total}`);
  reportLines.push(`- **Identical:** ${stats.identical}`);
  reportLines.push(`- **Modified:** ${stats.modified}`);
  reportLines.push(`- **Added in ${project2}:** ${stats.added}`);
  reportLines.push(`- **Removed from ${project1}:** ${stats.removed}\n`);
  
  reportLines.push("---\n");
  
  // Group by status for better organization
  const modified = results.filter(r => r.status === 'modified');
  const added = results.filter(r => r.status === 'added');
  const removed = results.filter(r => r.status === 'removed');
  
  if (modified.length > 0) {
    reportLines.push("## Modified Segments\n");
    
    for (const result of modified) {
      reportLines.push(`### ${result.segmentName}`);
      reportLines.push(`**Key:** \`${result.segmentKey}\`\n`);
      
      if (result.differences.length > 0) {
        reportLines.push("**Changes:**\n");
        
        for (const diff of result.differences) {
          const val1 = formatValue(diff.value1, diff.isArrayCount);
          const val2 = formatValue(diff.value2, diff.isArrayCount);
          reportLines.push(`- **${diff.property}**: ${val1} → ${val2}`);
        }
        
        reportLines.push("");
      }
    }
  }
  
  if (added.length > 0) {
    reportLines.push("## Added Segments\n");
    
    for (const result of added) {
      reportLines.push(`### ${result.segmentName}`);
      reportLines.push(`**Key:** \`${result.segmentKey}\`\n`);
    }
  }
  
  if (removed.length > 0) {
    reportLines.push("## Removed Segments\n");
    
    for (const result of removed) {
      reportLines.push(`### ${result.segmentName}`);
      reportLines.push(`**Key:** \`${result.segmentKey}\`\n`);
    }
  }
  
  // Create results directory if it doesn't exist
  try {
    await Deno.mkdir("results", { recursive: true });
  } catch {
    // Directory already exists
  }
  
  await Deno.writeTextFile("results/segment-prod-compare.md", reportLines.join('\n'));
  console.log(Colors.green("\nReport saved to results/segment-prod-compare.md"));
}

function printConsoleSummary(results: SegmentDifference[], project1: string, project2: string) {
  console.log("\n" + Colors.bold("=== SEGMENT COMPARISON SUMMARY ==="));
  console.log(`Projects: ${project1} vs ${project2}`);
  
  const stats = {
    total: results.length,
    identical: results.filter(r => r.status === 'identical').length,
    modified: results.filter(r => r.status === 'modified').length,
    added: results.filter(r => r.status === 'added').length,
    removed: results.filter(r => r.status === 'removed').length
  };
  
  console.log(`\nTotal segments: ${stats.total}`);
  console.log(Colors.green(`✓ Identical: ${stats.identical}`));
  console.log(Colors.yellow(`⚠ Modified: ${stats.modified}`));
  console.log(Colors.cyan(`+ Added: ${stats.added}`));
  console.log(Colors.red(`- Removed: ${stats.removed}`));
  
  const modified = results.filter(r => r.status === 'modified');
  if (modified.length > 0) {
    console.log("\n" + Colors.yellow("Modified segments:"));
    modified.slice(0, 10).forEach(r => {
      console.log(`  - ${r.segmentName} (${r.differences.length} differences)`);
    });
    if (modified.length > 10) {
      console.log(`  ... and ${modified.length - 10} more`);
    }
  }
}

// Main execution
if (import.meta.main) {
  const inputArgs: Arguments = yargs(Deno.args)
    .alias("p", "primaryFolder")
    .alias("d", "destinationFolder")
    .describe("p", "Primary folder name (first project)")
    .describe("d", "Destination folder name (second project)")
    .demandOption(["p", "d"])
    .parse() as Arguments;
  
  const file1 = `source/project/${inputArgs.primaryFolder}/segment-production.json`;
  const file2 = `source/project/${inputArgs.destinationFolder}/segment-production.json`;
  
  console.log(Colors.bold("Comparing segment-production.json files..."));
  console.log(`Source: ${file1}`);
  console.log(`Target: ${file2}`);
  console.log(`Excluding properties: ${EXCLUDED_PROPERTIES.join(', ')}`);
  console.log(`Array count properties: ${ARRAY_COUNT_PROPERTIES.join(', ')}\n`);
  
  try {
    const startTime = Date.now();
    
    const data1 = await getJson(file1) as SegmentData;
    const data2 = await getJson(file2) as SegmentData;
    
    if (!data1 || !data2) {
      console.error(Colors.red("Error: Could not read one or both segment files"));
      Deno.exit(1);
    }
    
    if (!data1.items || !data2.items) {
      console.error(Colors.red("Error: Invalid segment file format (missing 'items' array)"));
      Deno.exit(1);
    }
    
    console.log(`Loaded ${data1.items.length} segments from ${inputArgs.primaryFolder}`);
    console.log(`Loaded ${data2.items.length} segments from ${inputArgs.destinationFolder}`);
    
    const results = compareSegments(data1.items, data2.items);
    
    const endTime = Date.now();
    
    printConsoleSummary(results, inputArgs.primaryFolder, inputArgs.destinationFolder);
    
    await generateReport(results, inputArgs.primaryFolder, inputArgs.destinationFolder);
    
    console.log(`\nComparison completed in ${(endTime - startTime) / 1000}s`);
    
  } catch (error) {
    console.error(Colors.red("Error during comparison:"), error);
    Deno.exit(1);
  }
}

