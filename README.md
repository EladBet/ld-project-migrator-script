# Project Migrator

### Requirements

- You must have [Deno](https://deno.land/) installed. If you use Homebrew, run `brew install deno`.


### Considerations

- These scripts, `migrate.ts` and `source.ts`, are provided strictly as-is. LaunchDarkly Support cannot help run this.

### Known issues

- Importing LD API TypeScript types causes an import error, so they are commented out
  in various spots.
- Types in general are very loose, which Deno is not happy about. The scripts run as
  JavaScript overall instead of validating the TypeScript first.
- Due to the current API configuration, you cannot have more than 20 environments in a single project.
- Due to considerations around many API requests at once, monitor 400 errors for flag configurations that may not be up to date.

## Things you Should Consider when migrating flags?

- What can you scope down? Do all the flags need to moved over or can we use this as a way to clean up the environment?
- Do all my environments need to go? or maybe just a few?
- Am I able to stop edits in the destination project?  This script does not keep them in sync, so if changes need to be made they should be prior
- Who is going to run it and how? The calls can take a while, with rate limits, so should I run it on an EC2 or the like?
- If I have thousands or even hundreds of updates: what is critical, how will I verify the changes are correct?

## Instructions for use

1. Sourcing data

First, export your source data. The `source.ts` script writes the data to a newly created
`source/project/<source-project-key>` directory.

Here's how to export your source data:

```
deno run --allow-env --allow-read --allow-net --allow-write source.ts -p <SOURCE PROJECT KEY> -k <SOURCE LD API KEY>

```

2. Migrating data

Then, migrate the source data to the destination project. The `migrate.ts` script reads the source data out of the previously created `source/project/<source-project-key>` directory. Then it uses the
`DESTINATION PROJECT` as the project key, and updates the destination project using a series of `POST`s and `PATCH`s.

Here's how to migrate the source data to your destination project:

```
deno run --allow-env --allow-read --allow-net --allow-write migrate.ts -p <SOURCE PROJECT KEY> -k <DESTINATION LD API KEY> -d <DESTINATION PROJECT KEY>

```

**Important note** The script currently doesn't support merging two already existing projects - make sure the destination project doesn't exist before executing the `migrate.ts` script. If you have already created the destination project manually, delete the project before proceeding. 

### Resources migrated by the script
* Environments
* Flags
  * Flag variations
  * Flag prerequisites
  * Flag individual targets
  * Flag attribute-based targeting rules
* Standard User Segments (no Big Segments)

### Pointing to a different instance

Pass in the `-u` argument with the domain of the other instance. By default, these scripts apply to your projects on `app.launchdarkly.com`.

## Deno Tasks - Simplified Workflow

This project includes predefined Deno tasks that simplify the migration workflow. These tasks handle all the necessary permissions and flags automatically.

### Available Tasks

#### 1. `import` - Export Source Project Data
Exports all project data (metadata, environments, flags, and segments) from the source project.

```bash
deno task import -p <SOURCE_PROJECT_KEY> -k <SOURCE_API_KEY>
```

**Example:**
```bash
deno task import -p my-source-project -k api-12345678-1234-1234-1234-123456789abc
```

This creates a `source/project/<SOURCE_PROJECT_KEY>/` directory with all exported data.

#### 2. `migrate-metadata` - Copy Project Structure (Run Once Only)
⚠️ **Important: Run this task ONLY ONCE** - it copies project metadata and environments to the destination.

```bash
deno task migrate-metadata -p <SOURCE_PROJECT_KEY> -k <DESTINATION_API_KEY> -d <DESTINATION_PROJECT_KEY>
```

**Example:**
```bash
deno task migrate-metadata -p my-source-project -k api-87654321-4321-4321-4321-cba987654321 -d my-destination-project
```

**What it does:**
- Creates the destination project
- Copies all environments from source to destination
- Sets up the project structure and metadata
- **Should only be run once per migration**

#### 3. `migrate` - Copy Flags and Segments
Copies all feature flags and user segments from the source project to the destination project.

```bash
deno task migrate -p <SOURCE_PROJECT_KEY> -k <DESTINATION_API_KEY> -d <DESTINATION_PROJECT_KEY>
```

**Example:**
```bash
deno task migrate -p my-source-project -k api-87654321-4321-4321-4321-cba987654321 -d my-destination-project
```

**To resume from a specific flag index or skip segments:**
```bash
deno task migrate -p my-source-project -k api-87654321-4321-4321-4321-cba987654321 -d my-destination-project -i 461
```

**What it does:**
- Copies all feature flags with their configurations
- Copies all user segments
- Preserves targeting rules and prerequisites
- Can be run multiple times if needed
- Use `-i <index>` to skip segments and resume from a specific flag index

#### 4. `cleanup` - Remove Flags and Segments
⚠️ **Danger Zone** - Deletes all flags and segments from a project while preserving the project structure.

```bash
deno task cleanup -p <PROJECT_KEY> -k <API_KEY>
```

**Example:**
```bash
deno task cleanup -p my-project-to-clean -k api-12345678-1234-1234-1234-123456789abc
```

**What it does:**
- Deletes ALL feature flags in the project
- Deletes ALL user segments in the project
- **Preserves** the project itself and environments
- **⚠️ Use with extreme caution - this action is irreversible**

### Complete Migration Workflow

Here's the recommended step-by-step process:

#### Step 1: Export source data
```bash
deno task import -p source-project -k <SOURCE_API_KEY>
```

#### Step 2: Create destination project structure (once only)
```bash
deno task migrate-metadata -p source-project -k <DEST_API_KEY> -d destination-project
```

#### Step 3: Migrate flags and segments
```bash
deno task migrate -p source-project -k <DEST_API_KEY> -d destination-project
```


### In case of an issue that require to migrate all the fresh segments and flags

#### Step 2: Clean up destination project
```bash
deno task cleanup -p destination-project -k <DEST_API_KEY>
```

#### Step 3: Export fresh source data
```bash
deno task import -p source-project -k <SOURCE_API_KEY>
```

#### Step 4: Migrate flags and segments
```bash
deno task migrate -p source-project -k <DEST_API_KEY> -d destination-project
```

### Task Arguments

All tasks support the following common arguments:

- `-p, --projKey` - Project key
- `-k, --apikey` - LaunchDarkly API key  
- `-d, --destProjKey` - Destination project key (for migration tasks)
- `-u, --domain` - LaunchDarkly domain (defaults to `app.launchdarkly.com`)

## Compare Script - Migration Validation

The `compare-bulk-json.ts` script allows you to compare exported project data between source and destination projects to validate successful migration and identify any differences.

### How to Run the Compare Script

```bash
deno task compare -p <SOURCE_PROJECT_KEY> -d <DESTINATION_PROJECT_KEY>
```

**Example - Compare flag configurations:**
```bash
deno task compare -p source-project -d destination-project
```

**Example - Compare segments only:**
```bash
deno task compare -p source-project -d destination-project -s
```

### Compare Script Options

- `-p, --primaryFolder` - Source project key (primary folder to compare from)
- `-d, --destinationFolder` - Destination project key (target folder to compare against) 
- `-s, --segments` - Compare only segment-production.json files instead of all flags (optional)

### What the Compare Script Does

1. **Compares JSON files** between two exported project directories
2. **Excludes known differences** such as IDs, timestamps, and version numbers that are expected to differ
3. **Identifies real configuration differences** that might indicate migration issues
4. **Generates comprehensive reports** with detailed analysis

### Expected Results in the `results/` Folder

After running the compare script, you'll find these files in the `results/` directory:

#### 1. `comparison-results.json`
- Raw comparison results for all files
- Status for each file: `identical`, `different`, `missing`, or `error`
- Machine-readable format for further processing

#### 2. `detailed-differences.json`
- Detailed breakdown of specific property differences
- Shows exact property paths and values that differ
- Used as input for the analysis reports

#### 3. `differences-summary.md`
- Human-readable summary of all differences found
- Organized by file with property-by-property breakdown
- Useful for manual review of specific files

#### 4. `property-analysis.md`
- **Most important report** - Analyzes differences by frequency
- Groups similar differences across multiple files
- Prioritizes production environment examples
- Shows which properties differ most commonly
- Helps identify systematic migration issues

#### 5. `property-analysis.csv`
- Spreadsheet-friendly version of the property analysis
- Can be opened in Excel/Google Sheets for further analysis
- Includes counts, percentages, and example values

### Understanding the Results

**Console Output Summary:**
- Total files compared
- ✓ Identical files (perfect matches)
- ⚠ Different files (have configuration differences)
- ✗ Missing files (exist in source but not destination)
- 💥 Error files (comparison failed)

**Key Things to Look For:**

1. **High number of identical files** = Good migration
2. **Missing files** = Potential migration failures
3. **Common property differences** in analysis = Systematic issues
4. **Environment-specific differences** = Targeting rule problems

### Typical Workflow

1. **After migration**, export both source and destination project data
2. **Run compare script** to validate the migration
3. **Review property-analysis.md** for systematic issues
4. **Check differences-summary.md** for specific file problems
5. **Use CSV file** for spreadsheet analysis if needed

### Excluded Properties

The script automatically excludes these properties that are expected to differ:
- `_id`, `maintainerId`, `version`, `_version`
- `creationDate`, `lastModified`, `lastModifiedDate`
- `salt`, `href`, `_links`, `generation`
- And other system-generated values

This ensures the comparison focuses on actual configuration differences rather than system metadata.

### Error Handling

- Tasks will validate that required source data exists before proceeding
- Rate limiting is automatically handled with exponential backoff
- Clear error messages are provided for common issues
- The cleanup task includes safety checks to prevent accidental data loss
