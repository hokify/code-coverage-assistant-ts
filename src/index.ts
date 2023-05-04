import { getInput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { S3Client } from "@aws-sdk/client-s3";
import {
    cleanUpNonchangedTemporaryLcovs,
    FileList,
    generateReport,
    getLocalLcovFileList,
    retrieveLcovBaseFiles,
    retrieveLocalLcovFiles,
    retrieveTemporaryLcovFiles,
    setTemporarLvocFilesAsBase,
    uploadTemporaryLvocFiles,
} from "./app.js";

const token = getInput("github-token");
const monorepoBasePath = getInput("monorepo-base-path");
const s3Config = getInput("s3-config");
const threshold = getInput("threshold");
const failOnThreshold = !!getInput("fail-on-threshold");
const mode = getInput("mode");
const base = context.payload.pull_request?.base.ref;

try {
    let s3ConfigParsed:
        | {
              credentials: { accessKeyId: string; secretAccessKey: string };
              Bucket: string;
              region: string;
          }
        | undefined;

    try {
        s3ConfigParsed = s3Config && JSON.parse(s3Config);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.log("s3Config", s3Config);
        throw new Error(`failed parsing s3 config json: ${err}`);
    }

    const s3Client = s3ConfigParsed && new S3Client(s3ConfigParsed);

    if (!monorepoBasePath) {
        throw new Error(`No monorepo-base-path specified!`);
    }

    const executeMode: ("collect" | "report" | "merge")[] =
        (mode && [mode]) ||
        (!mode &&
            !context.payload.pull_request?.merged && ["collect", "report"]) ||
        (!mode && context.payload.pull_request?.merged && ["merge"]);

    if (mode && (!s3Client || !s3ConfigParsed)) {
        throw new Error("specifying a mode requires a s3 config");
    }

    // generate diff report
    if (!context.payload.pull_request?.number) {
        throw new Error("no pull request number found in context");
    }

    let lcovFileList: FileList | undefined;

    if (executeMode.includes("collect")) {
        // retrieve file list from local disk
        lcovFileList = getLocalLcovFileList(monorepoBasePath);

        if (s3Client && s3ConfigParsed) {
            const cntUpload = await uploadTemporaryLvocFiles(
                lcovFileList,
                s3Client,
                s3ConfigParsed.Bucket,
                context.repo,
                context.payload.pull_request.number,
                monorepoBasePath,
                base,
            );

            // eslint-disable-next-line no-console
            console.info(`collected ${cntUpload} temporary lcov files`);
        }
    }

    if (executeMode.includes("report")) {
        const client = getOctokit(token);

        const localLcovFiles = lcovFileList
            ? await retrieveLocalLcovFiles(lcovFileList)
            : s3Client &&
              s3ConfigParsed &&
              (await retrieveTemporaryLcovFiles(
                  s3Client,
                  s3ConfigParsed.Bucket,
                  context.repo,
                  context.payload.pull_request.number,
                  monorepoBasePath,
                  base,
              ));

        if (!localLcovFiles) {
            throw new Error("cannot retrieve local file list");
        }

        const { lcovArrayForMonorepo } = localLcovFiles;

        const { lcovBaseArrayForMonorepo } = (s3Client &&
            s3ConfigParsed &&
            (await retrieveLcovBaseFiles(
                localLcovFiles.lcovArrayForMonorepo,
                s3Client,
                s3ConfigParsed.Bucket,
                context.repo,
                monorepoBasePath,
                base,
                "master",
            ))) || { lcovBaseArrayForMonorepo: [] };

        const resultReport = await generateReport(
            client,
            lcovArrayForMonorepo,
            lcovBaseArrayForMonorepo,
            monorepoBasePath,
            context.repo,
            context.payload.pull_request.number,
            base,
            (threshold && parseInt(threshold, 10)) || undefined,
        );

        // eslint-disable-next-line no-console
        console.info(
            `generated report for ${resultReport.count} lcov files, ${resultReport.thresholdReached}x thresholds reached`,
        );

        if (s3Client && s3ConfigParsed) {
            const result = await cleanUpNonchangedTemporaryLcovs(
                s3Client,
                s3ConfigParsed.Bucket,
                lcovArrayForMonorepo,
                lcovBaseArrayForMonorepo,
                context.repo,
                context.payload.pull_request.number,
                monorepoBasePath,
                base,
            );
            // eslint-disable-next-line no-console
            console.info(
                `cleaned ${result} not necessary temporary lcov files`,
            );
        }

        if (resultReport.thresholdReached) {
            const message = `coverage decreased over threshold for ${resultReport.thresholdReached} packages`;
            if (failOnThreshold) {
                setFailed(message);
            } else {
                console.warn(message);
            }
        }
    }

    if (executeMode.includes("merge")) {
        if (!s3Client || !s3ConfigParsed) {
            throw new Error(`No s3 config specified!`);
        }

        if (!context.payload.pull_request) {
            throw new Error("cannot get pull_request context");
        }

        // upload new lcov base files to storage
        const cnt = await setTemporarLvocFilesAsBase(
            s3Client,
            s3ConfigParsed.Bucket,
            context.repo,
            context.payload.pull_request.number,
            monorepoBasePath,
            base,
        );
        // eslint-disable-next-line no-console
        console.info(`updated ${cnt} lcov files as new base`);
    }
} catch (err) {
    console.error(err);
    setFailed(err instanceof Error ? err.message : JSON.stringify(err));
}
