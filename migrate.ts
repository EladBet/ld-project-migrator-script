// deno-lint-ignore-file no-explicit-any
import yargs from "https://deno.land/x/yargs@v17.7.2-deno/deno.ts";
import {
  buildPatch,
  buildRules,
  consoleLogger,
  getJson,
  ldAPIPatchRequest,
  ldAPIPostRequest,
  rateLimitRequest,
  ldAPIRequest,
  ldAPIDeprecateFlagRequest,
  delay
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
  projKeySource: string;
  projKeyDest: string;
  apikey: string;
  domain: string;
  startIndex: number;
}

let inputArgs: Arguments = yargs(Deno.args)
  .alias("p", "projKeySource")
  .alias("d", "projKeyDest")
  .alias("k", "apikey")
  .alias("u", "domain")
  .alias("i", "startIndex")
  .describe("i", "Start flag migration from this index (1-based). If provided, segments migration will be skipped")
  .number("i")
  .default("u", "app.launchdarkly.com")
  .default("i", 1).argv;

// Project Data //
const projectJson = await getJson(
  `./source/project/${inputArgs.projKeySource}/project.json`,
);

const envkeys: Array<string> = projectJson.environments.items.map((env: any) => env.key);

const projResp = await fetch(
  ldAPIRequest(
    inputArgs.apikey,
    inputArgs.domain,
    `projects/${inputArgs.projKeyDest}`,
  ),
);

const projectResponseJson = await projResp.json();
if (projResp == null || projectResponseJson.message?.startsWith('Unknown project key')) {
  console.log(Colors.yellow("Failed getting project, run migrate-metadata.ts to create the project"));
  Deno.exit(1);
}
const projRep = projectJson; //as Project

// Skip segment migration if user provided a start index (assuming resuming migration)
// Check if -i was explicitly provided by seeing if it's different from default or if it's > 1
const userProvidedIndex = Deno.args.includes('-i') || Deno.args.includes('--startIndex');
if (!userProvidedIndex) {
  console.log(Colors.green("Starting segment migration..."));
  
  for (const env of projRep.environments.items) {
    const segmentData = await getJson(
      `./source/project/${inputArgs.projKeySource}/segment-${env.key}.json`,
    );
    
    // PHASE 1: Create all segments first (without rules)
    console.log(`Phase 1: Creating segments for environment ${env.key}`);
    for (const segment of segmentData.items) {
      if (segment.unbounded == true) {
        console.log(Colors.yellow(
          `Segment: ${segment.key} in Environment ${env.key} is unbounded, skipping`,
        ));
        continue;
      }

      const newSegment: any = {
        name: segment.name,
        key: segment.key,
      };

      if (segment.tags) newSegment.tags = segment.tags;
      if (segment.description) newSegment.description = segment.description;

      const post = ldAPIPostRequest(
        inputArgs.apikey,
        inputArgs.domain,
        `segments/${inputArgs.projKeyDest}/${env.key}`,
        newSegment,
      )

      const segmentResp = await rateLimitRequest(
        post,
      );

      const segmentStatus = await segmentResp.status;
      consoleLogger(
        segmentStatus,
        `Creating segment ${newSegment.key} status: ${segmentStatus}`,
      );
      if (segmentStatus > 201) {
        console.log(JSON.stringify(newSegment));
      }
    }

    // PHASE 2: Now patch all segments with rules (all segments exist now)
    console.log(`Phase 2: Patching segments with rules for environment ${env.key}`);
    for (const segment of segmentData.items) {
      if (segment.unbounded == true) {
        continue; // Skip unbounded segments
      }

      // Build Segment Patches //
      const sgmtPatches = [];

      if (segment.included?.length > 0) {
        sgmtPatches.push(buildPatch("included", "add", segment.included));
      }
      if (segment.excluded?.length > 0) {
        sgmtPatches.push(buildPatch("excluded", "add", segment.excluded));
      }

      if (segment.rules?.length > 0) {
        console.log(`Copying Segment: ${segment.key} rules`);
        sgmtPatches.push(...buildRules(segment.rules));
      }

      const patchRules = await rateLimitRequest(
        ldAPIPatchRequest(
          inputArgs.apikey,
          inputArgs.domain,
          `segments/${inputArgs.projKeyDest}/${env.key}/${segment.key}`,
          sgmtPatches,
        ),
      );

      const segPatchStatus = patchRules.statusText;
      consoleLogger(
        patchRules.status,
        `Patching segment ${segment.key} status: ${segPatchStatus}`,
      );
    }
  }
  
  console.log(Colors.green("Segment migration completed."));
} else {
  console.log(Colors.yellow(`Skipping segment migration (resuming from flag index ${inputArgs.startIndex}).`));
}

// Flag Data //
console.log(Colors.green("Starting flag migration..."));

const flagList: Array<string> = await getJson(
  `./source/project/${inputArgs.projKeySource}/flags.json`,
);

const flagsDoubleCheck: string[] = [];

// Creating Global Flags //
console.log(`Starting flag migration from index ${inputArgs.startIndex} of ${flagList.length} flags`);

for (const [index, flagkey] of flagList.entries()) {
  // Skip flags before the start index (convert to 0-based indexing)
  if (index + 1 < inputArgs.startIndex) {
    console.log(`Skipping flag ${index + 1}: ${flagkey}`);
    continue;
  }
  await delay(200);
  // Read flag
  console.log(`Reading flag ${index + 1} of ${flagList.length} : ${flagkey}`);

  const flag = await getJson(
    `./source/project/${inputArgs.projKeySource}/flags/${flagkey}.json`,
  );

  const newVariations = flag.variations.map(({ _id, ...rest }) => rest);

  const newFlag: any = {
    key: flag.key,
    name: flag.name,
    variations: newVariations,
    temporary: flag.temporary,
    tags: flag.tags,
    description: flag.description
  };

  if (flag.clientSideAvailability) {
    newFlag.clientSideAvailability = flag.clientSideAvailability;
  } else if (flag.includeInSnippet) {
    newFlag.includeInSnippet = flag.includeInSnippet;
  }
  if (flag.customProperties) {
    newFlag.customProperties = flag.customProperties;
  }

  if (flag.defaults) {
    newFlag.defaults = flag.defaults;
  }

  console.log(
    `\tCreating flag: ${flag.key} in Project: ${inputArgs.projKeyDest}`,
  );
  const flagResp = await rateLimitRequest(
    ldAPIPostRequest(
      inputArgs.apikey,
      inputArgs.domain,
      `flags/${inputArgs.projKeyDest}`,
      newFlag,
    ),
  );
  if (flagResp.status == 200 || flagResp.status == 201) {
    console.log("\tFlag created");
    
    // Check if flag should be deprecated and make deprecation PATCH call
    if (flag.deprecated === true) {
      console.log(`\tFlag ${flag.key} is marked as deprecated, applying deprecation...`);
      
      const deprecateResp = await rateLimitRequest(
        ldAPIDeprecateFlagRequest(
          inputArgs.apikey,
          inputArgs.domain,
          inputArgs.projKeyDest,
          flag.key,
        ),
      );
      
      if (deprecateResp.status == 200 || deprecateResp.status == 201) {
        console.log(`\tFlag ${flag.key} successfully deprecated`);
      } else {
        console.log(`\tError deprecating flag ${flag.key}: ${deprecateResp.status}`);
      }
    }
  } else {
    console.log(`Error for flag ${newFlag.key}: ${flagResp.status}`);
  }

  // Add flag env settings
  for (const env of envkeys) {
    const patchReq: any[] = [];
    const flagEnvData = flag.environments[env];
    const parsedData: Record<string, string> = Object.keys(flagEnvData)
      .filter((key) => !key.includes("salt"))
      .filter((key) => !key.includes("version"))
      .filter((key) => !key.includes("lastModified"))
      .filter((key) => !key.includes("_environmentName"))
      .filter((key) => !key.includes("_site"))
      .filter((key) => !key.includes("_summary"))
      .filter((key) => !key.includes("sel"))
      .filter((key) => !key.includes("access"))
      .filter((key) => !key.includes("_debugEventsUntilDate"))
      .filter((key) => !key.startsWith("_"))
      .filter((key) => !key.startsWith("-"))
      .reduce((cur, key) => {
        return Object.assign(cur, { [key]: flagEnvData[key] });
      }, {});
    

    Object.keys(parsedData)
      .map((key) => {
        if (key == "rules") {
          patchReq.push(...buildRules(parsedData[key], "environments/" + env));  
        } else {
          patchReq.push(
            buildPatch(
              `environments/${env}/${key}`,
              "replace",
              parsedData[key],
            ),
          );
          
        }
      });
      await makePatchCall(flag.key, patchReq, env);
      
      console.log(`\tFinished patching flag ${flagkey} for env ${env}`);
  }

}

// Send one patch per Flag for all Environments //
const envList: string[] = [];
projectJson.environments.items.forEach((env: any) => {
  envList.push(env.key);
});

// The # of patch calls is the # of environments * flags,
// if you need to limit run time, a good place to start is to only patch the critical environments in a shorter list
//const envList: string[] = ["test"];


async function makePatchCall(flagKey, patchReq, env){
  const patchFlagReq = await rateLimitRequest(
    ldAPIPatchRequest(
      inputArgs.apikey,
      inputArgs.domain,
      `flags/${inputArgs.projKeyDest}/${flagKey}`,
      patchReq,
    ),
  );
  const flagPatchStatus = await patchFlagReq.status;
  if (flagPatchStatus > 200){
    flagsDoubleCheck.push(flagKey)
    consoleLogger(
      flagPatchStatus,
      `\tPatching ${flagKey} with environment [${env}] specific configuration, Status: ${flagPatchStatus}`,
    );
  }

  if (flagPatchStatus == 400) {
    console.log(patchFlagReq)
  }
  
  consoleLogger(
    flagPatchStatus,
    `\tPatching ${flagKey} with environment [${env}] specific configuration, Status: ${flagPatchStatus}`,
  );

  return flagsDoubleCheck;
}

if(flagsDoubleCheck.length > 0) {
  console.log("There are a few flags to double check as they have had an error or warning on the patch")
  flagsDoubleCheck.forEach((flag) => {
    console.log(` - ${flag}`)
  });
}
