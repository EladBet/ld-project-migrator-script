// analyze-differences.ts
import * as Colors from "https://deno.land/std/fmt/colors.ts";

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
  examples: Array<{
    file: string;
    value1: any;
    value2: any;
  }>;
}

async function analyzeDifferences() {
  try {
    // Read the detailed differences file
    const data = JSON.parse(await Deno.readTextFile("detailed-differences.json")) as DetailedDifference[];
    
    // Group differences by property path
    const pathCounts = new Map<string, PropertySummary>();
    
    data.forEach(fileDiff => {
      fileDiff.differences.forEach(diff => {
        const path = diff.path;
        
        if (!pathCounts.has(path)) {
          pathCounts.set(path, {
            path,
            count: 0,
            examples: []
          });
        }
        
        const summary = pathCounts.get(path)!;
        summary.count++;
        
        // Store up to 3 examples
        if (summary.examples.length < 3) {
          summary.examples.push({
            file: fileDiff.file,
            value1: diff.value1,
            value2: diff.value2
          });
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
      
      // Show examples
      summary.examples.forEach((example, i) => {
        console.log(`   Example ${i + 1}: ${example.file}`);
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
      reportLines.push(`- **Examples:**`);
      
      summary.examples.forEach((example, i) => {
        reportLines.push(`  ${i + 1}. **File:** \`${example.file}\``);
        reportLines.push(`     - **Default:** \`${JSON.stringify(example.value1)}\``);
        reportLines.push(`     - **Migration:** \`${JSON.stringify(example.value2)}\``);
      });
      reportLines.push("");
    });
    
    await Deno.writeTextFile("property-analysis.md", reportLines.join('\n'));
    console.log(Colors.green("Detailed analysis saved to property-analysis.md"));
    
    // Generate CSV for spreadsheet analysis
    const csvLines = ["Property Path,Count,Percentage,Example File,Default Value,Migration Value"];
    sortedPaths.forEach(summary => {
      const percentage = ((summary.count / data.length) * 100).toFixed(1);
      const example = summary.examples[0];
      csvLines.push(`"${summary.path}",${summary.count},${percentage}%,"${example.file}","${JSON.stringify(example.value1).replace(/"/g, '""')}","${JSON.stringify(example.value2).replace(/"/g, '""')}"`);
    });
    
    await Deno.writeTextFile("property-analysis.csv", csvLines.join('\n'));
    console.log(Colors.green("CSV analysis saved to property-analysis.csv"));
    
  } catch (error) {
    console.error(Colors.red("Error analyzing differences:"), error);
  }
}

// Run analysis
if (import.meta.main) {
  await analyzeDifferences();
}
