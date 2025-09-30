// compare-bulk-json.ts
import { getJson } from "./utils.ts";
import { walk } from "https://deno.land/std/fs/walk.ts";
import * as Colors from "https://deno.land/std/fmt/colors.ts";
import yargs from "https://deno.land/x/yargs@v17.7.2-deno/deno.ts";

interface Arguments {
  primaryFolder: string;
  destinationFolder: string;
  segments?: boolean;
}

interface ComparisonResult {
  file: string;
  status: 'identical' | 'different' | 'missing' | 'error';
  details?: string;
}

interface DetailedDifference {
  file: string;
  folder: string;
  differences: Array<{
    path: string;
    value1: any;
    value2: any;
  }>;
}

interface PropertySummary {
  path: string;
  count: number;
  environments: Set<string>;
  examples: Array<{
    file: string;
    value1: any;
    value2: any;
    environment?: string;
  }>;
}

// Properties to exclude from comparison (known to be different between projects)
const EXCLUDED_PROPERTIES = [
  // General exclusions
  "heref", "href", "salt", "sel", "_version", "creationDate", "_id", "maintainerId", "_maintainer", 
  "lastModified", "version", "ref", "_debugEventsUntilDate", "deprecatedDate", "includeInSnippet",
  // Segment-specific exclusions (but keep included/excluded for analysis)
  "lastModifiedDate", "generation", "_links"
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

function findDetailedDifferences(obj1: any, obj2: any, path: string = ""): Array<{path: string, value1: any, value2: any}> {
  const differences: Array<{path: string, value1: any, value2: any}> = [];
  
  // If both are primitive values, compare directly
  if (obj1 === null || obj2 === null || typeof obj1 !== 'object' || typeof obj2 !== 'object') {
    if (obj1 !== obj2) {
      differences.push({
        path: path || "root",
        value1: obj1,
        value2: obj2
      });
    }
    return differences;
  }
  
  // Handle arrays
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    const maxLength = Math.max(obj1.length, obj2.length);
    for (let i = 0; i < maxLength; i++) {
      const currentPath = path ? `${path}[${i}]` : `[${i}]`;
      const val1 = i < obj1.length ? obj1[i] : undefined;
      const val2 = i < obj2.length ? obj2[i] : undefined;
      
      if (val1 !== val2) {
        differences.push(...findDetailedDifferences(val1, val2, currentPath));
      }
    }
    return differences;
  }
  
  // Handle objects
  if (Array.isArray(obj1) !== Array.isArray(obj2)) {
    differences.push({
      path: path || "root",
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
        path: currentPath,
        value1: undefined,
        value2: val2
      });
    } else if (!(key in obj2)) {
      differences.push({
        path: currentPath,
        value1: val1,
        value2: undefined
      });
    } else {
      differences.push(...findDetailedDifferences(val1, val2, currentPath));
    }
  }
  
  return differences;
}

async function compareJsonFiles(file1: string, file2: string): Promise<{isIdentical: boolean, differences?: Array<{path: string, value1: any, value2: any}>}> {
  try {
    const json1 = await getJson(file1);
    const json2 = await getJson(file2);
    
    if (!json1 || !json2) return {isIdentical: false};
    
    // Remove excluded properties before comparison
    const cleanedJson1 = removeExcludedProperties(json1);
    const cleanedJson2 = removeExcludedProperties(json2);
    
    const isIdentical = JSON.stringify(cleanedJson1) === JSON.stringify(cleanedJson2);
    
    if (!isIdentical) {
      const differences = findDetailedDifferences(cleanedJson1, cleanedJson2);
      return {isIdentical: false, differences};
    }
    
    return {isIdentical: true};
  } catch {
    return {isIdentical: false};
  }
}

async function bulkCompareDirectories(dir1: string, dir2: string, segmentsMode = false): Promise<{results: ComparisonResult[], detailedDifferences: DetailedDifference[]}> {
  const results: ComparisonResult[] = [];
  const detailedDifferences: DetailedDifference[] = [];
  const files: string[] = [];
  
  // Collect files based on mode
  if (segmentsMode) {
    // Only collect segment-production.json files
    for await (const entry of walk(dir1, { exts: [".json"] })) {
      if (entry.isFile && entry.name === "segment-production.json") {
        files.push(entry.path);
      }
    }
  } else {
    // Collect all JSON files from flags directory
    for await (const entry of walk(dir1, { exts: [".json"] })) {
      if (entry.isFile) {
        files.push(entry.path);
      }
    }
  }
  
  console.log(`Found ${files.length} JSON files to compare...`);
  
  // Process in batches to avoid overwhelming the system
  const batchSize = 50;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchPromises = batch.map(async (file1) => {
      const relativePath = file1.replace(dir1 + "/", "");
      const file2 = `${dir2}/${relativePath}`;
      
      try {
        // Check if corresponding file exists
        const file2Exists = await Deno.stat(file2).then(() => true).catch(() => false);
        
        if (!file2Exists) {
          return { 
            result: { file: relativePath, status: 'missing' as const },
            detailed: null 
          };
        }
        
        const comparison = await compareJsonFiles(file1, file2);
        const result = { 
          file: relativePath, 
          status: comparison.isIdentical ? 'identical' as const : 'different' as const 
        };
        
        let detailed = null;
        if (!comparison.isIdentical && comparison.differences) {
          const pathParts = relativePath.split('/');
          const folder = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';
          detailed = {
            file: relativePath,
            folder: folder,
            differences: comparison.differences
          };
        }
        
        return { result, detailed };
        
      } catch (error) {
        return { 
          result: { 
            file: relativePath, 
            status: 'error' as const, 
            details: error instanceof Error ? error.message : String(error)
          },
          detailed: null
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(({ result, detailed }) => {
      results.push(result);
      if (detailed) {
        detailedDifferences.push(detailed);
      }
    });
    
    // Progress indicator
    console.log(`Processed ${Math.min(i + batchSize, files.length)}/${files.length} files...`);
  }
  
  return { results, detailedDifferences };
}

function generateReport(results: ComparisonResult[]) {
  const summary = {
    total: results.length,
    identical: results.filter(r => r.status === 'identical').length,
    different: results.filter(r => r.status === 'different').length,
    missing: results.filter(r => r.status === 'missing').length,
    errors: results.filter(r => r.status === 'error').length,
  };
  
  console.log("\n" + Colors.bold("=== COMPARISON SUMMARY ==="));
  console.log(`Total files: ${summary.total}`);
  console.log(Colors.green(`✓ Identical: ${summary.identical}`));
  console.log(Colors.yellow(`⚠ Different: ${summary.different}`));
  console.log(Colors.red(`✗ Missing: ${summary.missing}`));
  console.log(Colors.red(`💥 Errors: ${summary.errors}`));
  
  // Show different files
  const differentFiles = results.filter(r => r.status === 'different');
  if (differentFiles.length > 0) {
    console.log("\n" + Colors.yellow("Different files:"));
    differentFiles.slice(0, 20).forEach(f => console.log(`  - ${f.file}`));
    if (differentFiles.length > 20) {
      console.log(`  ... and ${differentFiles.length - 20} more`);
    }
  }
  
  // Show missing files
  const missingFiles = results.filter(r => r.status === 'missing');
  if (missingFiles.length > 0) {
    console.log("\n" + Colors.red("Missing files:"));
    missingFiles.slice(0, 20).forEach(f => console.log(`  - ${f.file}`));
    if (missingFiles.length > 20) {
      console.log(`  ... and ${missingFiles.length - 20} more`);
    }
  }
  
  return summary;
}

async function analyzeDifferences() {
  try {
    console.log("\n" + Colors.bold("=== ANALYZING DIFFERENCES ==="));
    
    // Read the detailed differences file
    const data = JSON.parse(await Deno.readTextFile("results/detailed-differences.json")) as DetailedDifference[];
    
    // For segment analysis, we need to read the segment file to get segment names
    let segmentData: any = null;
    if (data.length > 0 && data[0].file === "segment-production.json") {
      try {
        // Read the first segment file to get segment names
        const segmentFile = `${dir1.replace('/flags', '')}/segment-production.json`;
        segmentData = JSON.parse(await Deno.readTextFile(segmentFile));
      } catch (error) {
        console.warn(Colors.yellow(`Warning: Could not read segment file for names: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    
    // Group differences by property path
    const pathCounts = new Map<string, PropertySummary>();
    
    // Helper function to get segment name
    const getSegmentName = (segmentIndex: number): string => {
      return segmentData?.items?.[segmentIndex]?.name || `segment-${segmentIndex}`;
    };

    data.forEach(fileDiff => {
      fileDiff.differences.forEach(diff => {
        const path = diff.path;
        
        // Extract environment and base property path for grouping
        let groupKey = path;
        let environment = '';
        
        // Check if this is an environment-specific property
        const envMatch = path.match(/^environments\.([^.]+)\.(.+)$/);
        if (envMatch) {
          environment = envMatch[1];
          const basePath = envMatch[2];
          groupKey = `environments.*${basePath}`;
        }
        
        // Group included/excluded array differences more meaningfully
        const segmentIncludedMatch = path.match(/^items\[(\d+)\]\.included\[\d+\]$/);
        const segmentExcludedMatch = path.match(/^items\[(\d+)\]\.excluded\[\d+\]$/);
        const segmentIncludedListMatch = path.match(/^items\[(\d+)\]\.included$/);
        const segmentExcludedListMatch = path.match(/^items\[(\d+)\]\.excluded$/);
        
        if (segmentIncludedMatch) {
          const segmentIndex = parseInt(segmentIncludedMatch[1]);
          const segmentName = getSegmentName(segmentIndex);
          groupKey = `"${segmentName}" segment - included member changes`;
        } else if (segmentExcludedMatch) {
          const segmentIndex = parseInt(segmentExcludedMatch[1]);
          const segmentName = getSegmentName(segmentIndex);
          groupKey = `"${segmentName}" segment - excluded member changes`;
        } else if (segmentIncludedListMatch) {
          const segmentIndex = parseInt(segmentIncludedListMatch[1]);
          const segmentName = getSegmentName(segmentIndex);
          groupKey = `"${segmentName}" segment - included list changes`;
        } else if (segmentExcludedListMatch) {
          const segmentIndex = parseInt(segmentExcludedListMatch[1]);
          const segmentName = getSegmentName(segmentIndex);
          groupKey = `"${segmentName}" segment - excluded list changes`;
        }
        
        if (!pathCounts.has(groupKey)) {
          pathCounts.set(groupKey, {
            path: groupKey,
            count: 0,
            environments: new Set(),
            examples: []
          });
        }
        
        const summary = pathCounts.get(groupKey)!;
        summary.count++;
        
        if (environment) {
          summary.environments.add(environment);
        }
        
        // Prioritize production examples, then limit to 3 total
        const isProduction = environment === 'production';
        const hasProductionExample = summary.examples.some(ex => ex.environment === 'production');
        
        if (summary.examples.length < 3) {
          summary.examples.push({
            file: fileDiff.file,
            value1: diff.value1,
            value2: diff.value2,
            environment: environment || undefined
          });
        } else if (isProduction && !hasProductionExample) {
          // Replace a non-production example with production example
          const nonProdIndex = summary.examples.findIndex(ex => ex.environment !== 'production');
          if (nonProdIndex !== -1) {
            summary.examples[nonProdIndex] = {
              file: fileDiff.file,
              value1: diff.value1,
              value2: diff.value2,
              environment: environment || undefined
            };
          }
        }
      });
    });
    
    // Sort by frequency (most common first)
    const sortedPaths = Array.from(pathCounts.values())
      .sort((a, b) => b.count - a.count);
    
    // Generate summary report
    console.log(Colors.bold("=== REAL DIFFERENCES SUMMARY ==="));
    console.log(`Total files with differences: ${data.length}`);
    console.log(`Unique property paths with differences: ${sortedPaths.length}\n`);
    
    // Show top differences
    console.log(Colors.bold("Top Properties with Real Differences:"));
    console.log("(Property → Count → Examples)\n");
    
    sortedPaths.forEach((summary, index) => {
      const percentage = ((summary.count / data.length) * 100).toFixed(1);
      
      console.log(Colors.cyan(`${index + 1}. ${summary.path}`));
      console.log(Colors.yellow(`   Occurs in: ${summary.count} files (${percentage}% of different files)`));
      
      // Show environments if this is a grouped environment property
      if (summary.environments.size > 0) {
        const envList = Array.from(summary.environments).sort();
        console.log(Colors.magenta(`   Environments: ${envList.join(', ')}`));
      }
      
      // Show examples (prioritizing production)
      const sortedExamples = summary.examples.sort((a, b) => {
        if (a.environment === 'production' && b.environment !== 'production') return -1;
        if (b.environment === 'production' && a.environment !== 'production') return 1;
        return 0;
      });
      
      sortedExamples.forEach((example, i) => {
        const envLabel = example.environment ? ` (${example.environment})` : '';
        console.log(`   Example ${i + 1}: ${example.file}${envLabel}`);
        const val1 = example.value1 === undefined ? "undefined" : JSON.stringify(example.value1);
        const val2 = example.value2 === undefined ? "undefined" : JSON.stringify(example.value2);
        console.log(`     Default: ${Colors.red(val1)}`);
        console.log(`     Migration: ${Colors.green(val2)}`);
      });
      console.log("");
    });
    
    // Create detailed report file
    const reportLines = ["# Property Differences Analysis\n"];
    reportLines.push(`**Total files with differences:** ${data.length}`);
    reportLines.push(`**Unique properties with differences:** ${sortedPaths.length}\n`);
    reportLines.push("## Summary by Frequency\n");
    
    sortedPaths.forEach((summary, index) => {
      const percentage = ((summary.count / data.length) * 100).toFixed(1);
      reportLines.push(`### ${index + 1}. \`${summary.path}\``);
      reportLines.push(`- **Frequency:** ${summary.count} files (${percentage}%)`);
      
      // Show environments if this is a grouped environment property
      if (summary.environments.size > 0) {
        const envList = Array.from(summary.environments).sort();
        reportLines.push(`- **Environments:** ${envList.join(', ')}`);
      }
      
      reportLines.push(`- **Examples:**`);
      
      // Sort examples to prioritize production
      const sortedExamples = summary.examples.sort((a, b) => {
        if (a.environment === 'production' && b.environment !== 'production') return -1;
        if (b.environment === 'production' && a.environment !== 'production') return 1;
        return 0;
      });
      
      sortedExamples.forEach((example, i) => {
        const envLabel = example.environment ? ` (${example.environment})` : '';
        reportLines.push(`  ${i + 1}. **File:** \`${example.file}\`${envLabel}`);
        reportLines.push(`     - **Default:** \`${JSON.stringify(example.value1)}\``);
        reportLines.push(`     - **Migration:** \`${JSON.stringify(example.value2)}\``);
      });
      reportLines.push("");
    });
    
    await Deno.writeTextFile("results/property-analysis.md", reportLines.join('\n'));
    console.log(Colors.green("Detailed analysis saved to results/property-analysis.md"));
    
    // Generate CSV for spreadsheet analysis
    const csvLines = ["Property Path,Count,Percentage,Environments,Example File,Example Environment,Default Value,Migration Value"];
    sortedPaths.forEach(summary => {
      const percentage = ((summary.count / data.length) * 100).toFixed(1);
      const envList = summary.environments.size > 0 ? Array.from(summary.environments).sort().join(';') : '';
      
      // Use production example if available, otherwise first example
      const productionExample = summary.examples.find(ex => ex.environment === 'production');
      const example = productionExample || summary.examples[0];
      
      const value1Str = JSON.stringify(example.value1) || "undefined";
      const value2Str = JSON.stringify(example.value2) || "undefined";
      const exampleEnv = example.environment || '';
      
      csvLines.push(`"${summary.path}",${summary.count},${percentage}%,"${envList}","${example.file}","${exampleEnv}","${value1Str.replace(/"/g, '""')}","${value2Str.replace(/"/g, '""')}"`);
    });
    
    await Deno.writeTextFile("results/property-analysis.csv", csvLines.join('\n'));
    console.log(Colors.green("CSV analysis saved to results/property-analysis.csv"));
    
  } catch (error) {
    console.error(Colors.red("Error analyzing differences:"), error);
  }
}

const inputArgs: Arguments = yargs(Deno.args)
  .alias("p", "primaryFolder")
  .alias("d", "destinationFolder")
  .alias("s", "segments")
  .describe("p", "Primary folder name (source)")
  .describe("d", "Destination folder name (target)")
  .describe("s", "Compare segment-production.json files instead of flags")
  .boolean("s")
  .parse() as Arguments;

// Construct full paths with prefix and suffix
let dir1: string;
let dir2: string;

if (inputArgs.segments) {
  // Compare segment-production.json files
  dir1 = `source/project/${inputArgs.primaryFolder}`;
  dir2 = `source/project/${inputArgs.destinationFolder}`;
} else {
  // Compare flags directory (default behavior)
  dir1 = `source/project/${inputArgs.primaryFolder}/flags`;
  dir2 = `source/project/${inputArgs.destinationFolder}/flags`;
}

// Function to clear results directory
async function clearResultsDirectory() {
  try {
    // Check if results directory exists
    const resultsDirExists = await Deno.stat("results").then(() => true).catch(() => false);
    
    if (resultsDirExists) {
      console.log("Clearing previous results...");
      // Remove all files in results directory
      for await (const entry of Deno.readDir("results")) {
        if (entry.isFile) {
          await Deno.remove(`results/${entry.name}`);
        }
      }
      console.log("Previous results cleared.");
    } else {
      // Create results directory if it doesn't exist
      await Deno.mkdir("results", { recursive: true });
      console.log("Created results directory.");
    }
  } catch (error) {
    console.warn(Colors.yellow(`Warning: Could not clear results directory: ${error instanceof Error ? error.message : String(error)}`));
  }
}

// Main execution
if (import.meta.main) {
  
  // Clear previous results before starting
  await clearResultsDirectory();
  
  const compareType = inputArgs.segments ? "segment-production.json files" : "flags directory";
  console.log(`Comparing ${compareType} between ${inputArgs.primaryFolder} and ${inputArgs.destinationFolder}...`);
  console.log(`Source: ${dir1}`);
  console.log(`Target: ${dir2}`);
  console.log(`Excluding properties: ${EXCLUDED_PROPERTIES.join(', ')}`);
  
  const startTime = Date.now();
  const { results, detailedDifferences } = await bulkCompareDirectories(dir1, dir2, inputArgs.segments);
  const endTime = Date.now();
  
  generateReport(results);
  
  console.log(`\nComparison completed in ${(endTime - startTime) / 1000}s`);
  
  // Save basic results to file
  await Deno.writeTextFile(
    "results/comparison-results.json", 
    JSON.stringify(results, null, 2)
  );
  console.log("Basic results saved to results/comparison-results.json");
  
  // Save detailed differences to file
  if (detailedDifferences.length > 0) {
    await Deno.writeTextFile(
      "results/detailed-differences.json", 
      JSON.stringify(detailedDifferences, null, 2)
    );
    console.log(`Detailed differences saved to results/detailed-differences.json (${detailedDifferences.length} files with differences)`);
    
    // Generate human-readable summary
    const summaryLines = ["# Detailed Differences Summary\n"];
    detailedDifferences.forEach(diff => {
      summaryLines.push(`## File: ${diff.file}`);
      summaryLines.push(`**Folder:** ${diff.folder || 'root'}`);
      summaryLines.push(`**Differences found:** ${diff.differences.length}\n`);
      
      diff.differences.forEach((d, index) => {
        summaryLines.push(`### Difference ${index + 1}`);
        summaryLines.push(`**Property:** \`${d.path}\``);
        summaryLines.push(`**Default value:** \`${JSON.stringify(d.value1)}\``);
        summaryLines.push(`**Migration value:** \`${JSON.stringify(d.value2)}\`\n`);
      });
      
      summaryLines.push("---\n");
    });
    
    await Deno.writeTextFile(
      "results/differences-summary.md", 
      summaryLines.join('\n')
    );
    console.log("Human-readable summary saved to results/differences-summary.md");
    
    // Automatically run analysis
    await analyzeDifferences();
  } else {
    console.log("No detailed differences to save - all different files had only excluded properties!");
  }
}
