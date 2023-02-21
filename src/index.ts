import { getInput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { S3Client } from "@aws-sdk/client-s3";
import {
    cleanUpNonchangedTemporaryLcovs,
    generateReport,
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

    if ((!mode && context.payload.pull_request?.merged) || mode === "merge") {
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

    if (
        (!mode && !context.payload.pull_request?.merged) ||
        mode === "generate"
    ) {
        // generate diff report
        if (!context.payload.pull_request?.number) {
            throw new Error("no pull request number found in context");
        }

        const client = getOctokit(token);

        if (s3Client && s3ConfigParsed) {
            const cntUpload = await uploadTemporaryLvocFiles(
                s3Client,
                s3ConfigParsed.Bucket,
                context.repo,
                context.payload.pull_request.number,
                monorepoBasePath,
                base,
            );

            // eslint-disable-next-line no-console
            console.info(`uploaded ${cntUpload} temporary lcov files`);
        } else if (mode === "generate") {
            throw new Error("mode 'generate' requires to work a s3 config");
        }

        if (mode !== "generate") {
            const [{ lcovArrayForMonorepo }, { lcovBaseArrayForMonorepo }] =
                await Promise.all([
                    retrieveLocalLcovFiles(monorepoBasePath),
                    (s3Client &&
                        s3ConfigParsed &&
                        retrieveLcovBaseFiles(
                            s3Client,
                            s3ConfigParsed.Bucket,
                            context.repo,
                            monorepoBasePath,
                            base,
                            "master",
                        )) || { lcovBaseArrayForMonorepo: [] },
                ]);

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

            if (resultReport.thresholdReached) {
                setFailed(
                    `coverage decreased over threshold for ${resultReport.thresholdReached} packages`,
                );
            }
        }
    }

    if (mode === "report") {
        // generate diff report
        if (!context.payload.pull_request?.number) {
            throw new Error("no pull request number found in context");
        }

        const client = getOctokit(token);

        if (!s3Client || !s3ConfigParsed) {
            throw new Error("mode 'report' requireds s3 config");
        }

        const [{ lcovArrayForMonorepo }, { lcovBaseArrayForMonorepo }] =
            await Promise.all([
                retrieveTemporaryLcovFiles(
                    s3Client,
                    s3ConfigParsed.Bucket,
                    context.repo,
                    context.payload.pull_request.number,
                    monorepoBasePath,
                    base,
                ),
                retrieveLcovBaseFiles(
                    s3Client,
                    s3ConfigParsed.Bucket,
                    context.repo,
                    monorepoBasePath,
                    base,
                    "master",
                ),
            ]);

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

        await cleanUpNonchangedTemporaryLcovs(
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
            `generated report for ${resultReport.count} lcov files, ${resultReport.thresholdReached}x thresholds reached`,
        );

        if (resultReport.thresholdReached) {
            setFailed(
                `coverage decreased over threshold for ${resultReport.thresholdReached} packages`,
            );
        }
    }
} catch (err) {
    console.error(err);
    setFailed(err instanceof Error ? err.message : JSON.stringify(err));
}
