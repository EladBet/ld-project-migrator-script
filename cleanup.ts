// deno-lint-ignore-file no-explicit-any
import yargs from "https://deno.land/x/yargs@v17.7.2-deno/deno.ts";
import {
  consoleLogger,
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

const inputArgs: Arguments = yargs(Deno.args)
  .alias("p", "projKey")
  .alias("k", "apikey")
  .alias("u", "domain")
  .default("u", "app.launchdarkly.com")
  .check((argv) => {
    if (argv.projKey === "default") {
      throw new Error("Project key cannot be 'default'. Please specify a different project key.");
    }
    return true;
  })
  .parse() as Arguments;

console.log(Colors.green(`Starting cleanup for project: ${inputArgs.projKey}...`));

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

// PHASE 1: Delete all flags
console.log(`Phase 2: Fetching and deleting flags for project ${inputArgs.projKey}`);

// Fetch flags from API with pagination
const pageSize: number = 20;
let offset: number = 0;
let moreFlags: boolean = true;
const flags: string[] = [];

while (moreFlags) {
  console.log(`Building flag list: ${offset} to ${offset + pageSize}`);

  const flagsResp = await rateLimitRequest(
    ldAPIRequest(
      inputArgs.apikey,
      inputArgs.domain,
      `flags/${inputArgs.projKey}?limit=${pageSize}&offset=${offset}`,
    ),
    "flags",
  );

  if (flagsResp.status > 201) {
    consoleLogger(flagsResp.status, `Error getting flags: ${flagsResp.status}`);
    consoleLogger(flagsResp.status, await flagsResp.text());
    break;
  }

  const flagsData = await flagsResp.json();
  flags.push(...flagsData.items.map((flag: any) => flag.key));

  if (flagsData._links.next) {
    offset += pageSize;
  } else {
    moreFlags = false;
  }
}

console.log(`Found ${flags.length} flags`);

// Delete flags
for (const [index, flagkey] of flags.entries()) {
  console.log(`Deleting flag ${index + 1} of ${flags.length}: ${flagkey}`);

  const flagResp = await rateLimitRequest(
    ldAPIDeleteRequest(
      inputArgs.apikey,
      inputArgs.domain,
      `flags/${inputArgs.projKey}/${flagkey}`
    ),
    "flags",
  );
  
  if (flagResp.status == 200 || flagResp.status == 204) {
    console.log(`\t✓ Flag ${flagkey} deleted`);
  } else {
    console.log(`\t✗ Error deleting flag ${flagkey}: ${flagResp.status}`);
    const errorText = await flagResp.text();
    consoleLogger(flagResp.status, errorText);
  }
}

// PHASE 2: Delete all segments 
for (const env of projRep.environments.items) {
  console.log(`Phase 1: Fetching and deleting segments for environment ${env.key}`);
  
  // Fetch segments from API with pagination
  const segmentPageSize: number = 20;
  let segmentOffset: number = 0;
  let moreSegments: boolean = true;
  const allSegments: any[] = [];

  while (moreSegments) {
    const segmentResp = await rateLimitRequest(
      ldAPIRequest(
        inputArgs.apikey,
        inputArgs.domain,
        `segments/${inputArgs.projKey}/${env.key}?limit=${segmentPageSize}&offset=${segmentOffset}`,
      ),
      "segments",
    );
    
    if (segmentResp.status > 201) {
      consoleLogger(segmentResp.status, `Error getting segments for ${env.key}: ${segmentResp.status}`);
      break;
    }
    
    const segmentData = await segmentResp.json();
    console.log(
      `Building segment list for ${env.key}: ${
        allSegments.length + segmentData.items.length
      } of ${segmentData.totalCount} segments`
    );

    allSegments.push(...segmentData.items);

    if (allSegments.length >= segmentData.totalCount) {
      moreSegments = false;
    } else {
      segmentOffset += segmentPageSize;
    }
  }

  console.log(`Found ${allSegments.length} segments for environment: ${env.key}`);
  
  // Delete segments
  for (const segment of allSegments) {
    if (segment.unbounded == true) {
      console.log(Colors.yellow(
        `Segment: ${segment.key} in Environment ${env.key} is unbounded, skipping`,
      ));
      continue;
    }

    const segmentDeleteResp = await rateLimitRequest(
      ldAPIDeleteRequest(
        inputArgs.apikey,
        inputArgs.domain,
        `segments/${inputArgs.projKey}/${env.key}/${segment.key}`
      ),
      "segments",
    );

    const segmentStatus = segmentDeleteResp.status;
    consoleLogger(
      segmentStatus,
      `Deleting segment ${segment.key} status: ${segmentStatus}`,
    );
  }
};


