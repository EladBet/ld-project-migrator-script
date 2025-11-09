// deno-lint-ignore-file no-explicit-any
import yargs from "https://deno.land/x/yargs@v17.7.2-deno/deno.ts";
import {
  consoleLogger,
  getJson,
  ldAPIPatchRequest,
  rateLimitRequest,
  delay,
} from "./utils.ts";
import * as Colors from "https://deno.land/std/fmt/colors.ts";

interface Arguments {
  apikey: string;
  role: string;
  domain: string;
  dry: boolean;
}

let inputArgs: Arguments = yargs(Deno.args)
  .alias("k", "apikey")
  .alias("r", "role")
  .alias("u", "domain")
  .boolean("dry")
  .describe("k", "LaunchDarkly API key")
  .describe("r", "Target role (reader or writer)")
  .describe("dry", "Dry run mode - only print changes without applying them")
  .describe("u", "LaunchDarkly domain")
  .default("u", "app.launchdarkly.com")
  .default("dry", false)
  .demandOption(["k", "r"])
  .argv;

// Validate role argument
const validRoles = ["reader", "writer"];
if (!validRoles.includes(inputArgs.role)) {
  console.error(Colors.red(`Error: Role must be either 'reader' or 'writer'. Got: ${inputArgs.role}`));
  Deno.exit(1);
}

console.log(Colors.green(`\n=== Member Role Update Script ===`));
console.log(`Target Role: ${Colors.bold(inputArgs.role)}`);
console.log(`Dry Run: ${Colors.bold(inputArgs.dry ? "YES" : "NO")}`);
console.log(`Domain: ${inputArgs.domain}\n`);

if (inputArgs.dry) {
  console.log(Colors.yellow("DRY RUN MODE: No changes will be made\n"));
}

// Read members list from source folder
const membersData = await getJson("./source/members.json");

if (!membersData || !membersData.items || membersData.items.length === 0) {
  console.log(Colors.yellow("No members found in members.json"));
  Deno.exit(0);
}

const membersToUpdate = membersData.items;
console.log(`Found ${membersToUpdate.length} total member(s)`);

if (membersToUpdate.length === 0) {
  console.log(Colors.yellow("No members need to be updated. Exiting."));
  Deno.exit(0);
}

let updatedCount = 0;
let errorCount = 0;

// Process each member that needs updating
for (const [index, member] of membersToUpdate.entries()) {
  const memberId = member._id;
  const memberEmail = member.email || "unknown";
  const memberName = member.firstName && member.lastName 
    ? `${member.firstName} ${member.lastName}` 
    : memberEmail;

  console.log(Colors.blue(`\n[${index + 1}/${membersToUpdate.length}] Processing member: ${memberId}`));
  console.log(`  Name: ${memberName}`);
  console.log(`  Email: ${memberEmail}`);
  
  if (inputArgs.dry) {
    console.log(Colors.cyan(`  ⇢ Would update: to ${inputArgs.role}`));
    updatedCount++;
    continue;
  }

  await delay(200); // Rate limiting delay
  
  try {
    // Perform the update
    const patchBody = [{
      op: "replace",
      path: "/role",
      value: inputArgs.role,
    }];

    const updateResp = await rateLimitRequest(
      ldAPIPatchRequest(
        inputArgs.apikey,
        inputArgs.domain,
        `members/${memberId}`,
        patchBody,
      ),
      "members",
    );

    if (updateResp.status === 200 || updateResp.status === 201) {
      console.log(Colors.green(`  ✓ Successfully updated: to ${inputArgs.role}`));
      updatedCount++;
    } else {
      console.log(Colors.red(`  ✗ Error updating member: ${updateResp.status}`));
      consoleLogger(updateResp.status, `  Response: ${await updateResp.text()}`);
      errorCount++;
    }

  } catch (error) {
    console.log(Colors.red(`  ✗ Exception: ${error.message}`));
    errorCount++;
  }
}

// Summary
console.log(Colors.green(`\n\n=== Summary ===`));
console.log(`Members Needing Update: ${membersToUpdate.length}`);
console.log(`${inputArgs.dry ? "Would Update" : "Updated"}: ${Colors.green(String(updatedCount))}`);
if (errorCount > 0) {
  console.log(`Errors: ${Colors.red(String(errorCount))}`);
}
console.log();

