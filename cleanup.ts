// deno-lint-ignore-file no-explicit-any
import yargs from "https://deno.land/x/yargs@v17.7.2-deno/deno.ts";
import {
  consoleLogger,
  getJson,
  rateLimitRequest,
  ldAPIRequest,
  ldAPIDeleteRequest
} from "./utils.ts";
import * as Colors from "https://deno.land/std/fmt/colors.ts";

// Uncommented these give an import error due to axios
// import {
//   EnvironmentPost,
//   Project,
//   ProjectPost,
//   FeatureFlagBody
// } from "https://github.com/launchdarkly/api-client-typescript/raw/main/api.ts";

interface Arguments {
  projKey: string;
  apikey: string;
  domain: string;
}

let inputArgs: Arguments = yargs(Deno.args)
  .alias("p", "projKey")
  .alias("k", "apikey")
  .alias("u", "domain")
  .default("u", "app.launchdarkly.com").argv;

// Check if the source project folder exists before starting cleanup
const projectPath = `./source/project/${inputArgs.projKey}`;
try {
  const stat = await Deno.stat(projectPath);
  if (!stat.isDirectory) {
    console.log(Colors.red(`Error: ${projectPath} is not a directory`));
    Deno.exit(1);
  }
} catch (error) {
  if (error instanceof Deno.errors.NotFound) {
    console.log(Colors.red(`Error: Project folder ${projectPath} does not exist`));
    console.log(Colors.yellow(`Please make sure you have exported the project data first using the import task`));
    Deno.exit(1);
  } else {
    console.log(Colors.red(`Error checking project folder: ${(error as Error).message}`));
    Deno.exit(1);
  }
}

console.log(Colors.green(`✓ Project folder ${projectPath} exists, proceeding with cleanup...`));

const projResp = await fetch(
  ldAPIRequest(
    inputArgs.apikey,
    inputArgs.domain,
    `projects/${inputArgs.projKey}?expand=environments`,
  ),
);

const projectResponseJson = await projResp.json();
if (projResp == null || projectResponseJson.message?.startsWith('Unknown project key')) {
  console.log(Colors.yellow("Failed getting project,"));
  Deno.exit(1);
}
const projRep = projectResponseJson; //as Project


for (const env of projRep.environments.items) {
  const segmentData = await getJson(
    `./source/project/${inputArgs.projKey}/segment-${env.key}.json`,
  );
  
  // PHASE 1: Delete all segments 
  console.log(`Phase 1: Deleting segments for environment ${env.key}`);
  for (const segment of segmentData.items) {
    if (segment.unbounded == true) {
      console.log(Colors.yellow(
        `Segment: ${segment.key} in Environment ${env.key} is unbounded, skipping`,
      ));
      continue;
    }

    const segmentResp = await fetch(
        ldAPIDeleteRequest(
          inputArgs.apikey,
          inputArgs.domain,
          `segments/${inputArgs.projKey}/${env.key}/${segment.key}`
        ),
    );

    const segmentStatus = await segmentResp.status;
    consoleLogger(
      segmentStatus,
      `Deleting segment ${segment.key} status: ${segmentStatus}`,
    );
    if (segmentStatus > 201) {
      console.log(segment.name);
    }
  }
};

// Flag Data //
const flagList: Array<string> = await getJson(
  `./source/project/${inputArgs.projKey}/flags.json`,
);

// Deleting Global Flags //
for (const [index, flagkey] of flagList.entries()) {

  // Read flag
  console.log(`Reading flag ${index + 1} of ${flagList.length} : ${flagkey}`);

  const flag = await getJson(
    `./source/project/${inputArgs.projKey}/flags/${flagkey}.json`,
  );

  console.log(
    `\tDeleting flag: ${flag.key} in Project: ${inputArgs.projKey}`,
  );
  const flagResp = await rateLimitRequest(
    ldAPIDeleteRequest(
      inputArgs.apikey,
      inputArgs.domain,
      `flags/${inputArgs.projKey}/${flag.key}`
    ),
  );
  if (flagResp.status == 200 || flagResp.status == 201) {
    console.log("\tFlag Deleted");
  } else {
    console.log(`Error for flag ${flag.key}: ${flagResp.status}`);
  }
}
