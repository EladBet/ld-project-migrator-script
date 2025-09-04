// compare-bulk-json.ts
import { getJson } from "./utils.ts";
import { walk } from "https://deno.land/std/fs/walk.ts";
import * as Colors from "https://deno.land/std/fmt/colors.ts";

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

// Properties to exclude from comparison (known to be different between projects)
const EXCLUDED_PROPERTIES = ["heref", "href", "salt", "sel", "_version", "creationDate", "_id", "maintainerId", "_maintainer", "lastModified", "version", "ref", "_debugEventsUntilDate", "deprecatedDate", "includeInSnippet"];

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

async function bulkCompareDirectories(dir1: string, dir2: string): Promise<{results: ComparisonResult[], detailedDifferences: DetailedDifference[]}> {
  const results: ComparisonResult[] = [];
  const detailedDifferences: DetailedDifference[] = [];
  const files: string[] = [];
  
  // Collect all JSON files from first directory
  for await (const entry of walk(dir1, { exts: [".json"] })) {
    if (entry.isFile) {
      files.push(entry.path);
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
            details: error.message 
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

// Main execution
if (import.meta.main) {
  const dir1 = "source/project/default/flags";
  const dir2 = "source/project/pab-test-migration/flags";
  
  console.log(`Comparing ${dir1} with ${dir2}...`);
  console.log(`Excluding properties: ${EXCLUDED_PROPERTIES.join(', ')}`);
  
  const startTime = Date.now();
  const { results, detailedDifferences } = await bulkCompareDirectories(dir1, dir2);
  const endTime = Date.now();
  
  const summary = generateReport(results);
  
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
        summaryLines.push(`**Pab-test-migration value:** \`${JSON.stringify(d.value2)}\`\n`);
      });
      
      summaryLines.push("---\n");
    });
    
    await Deno.writeTextFile(
      "results/differences-summary.md", 
      summaryLines.join('\n')
    );
    console.log("Human-readable summary saved to results/differences-summary.md");
  } else {
    console.log("No detailed differences to save - all different files had only excluded properties!");
  }
}
