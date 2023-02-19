import { getInput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { S3Client } from "@aws-sdk/client-s3";
import { generateReport, uploadLvocFiles } from "./app.js";

const token = getInput("github-token");
const monorepoBasePath = getInput("monorepo-base-path");
const s3Config = getInput("s3-config");
const base = context.payload.pull_request?.base.ref;

try {
    if (!s3Config) {
        throw new Error(`No s3 config specified!`);
    }

    const s3ConfigParsed = JSON.parse(s3Config);

    const s3Client = new S3Client(s3ConfigParsed);

    if (!monorepoBasePath) {
        throw new Error(`No monorepo-base-path specified!`);
    }

    if (context.payload.pull_request?.merged) {
        // upload new lcov base files to storage
        await uploadLvocFiles(
            s3Client,
            s3ConfigParsed.Bucket,
            monorepoBasePath,
            base,
        );
    } else {
        // generate diff report
        if (!context.payload.pull_request?.number) {
            throw new Error("no pull request number");
        }

        const client = getOctokit(token);

        await generateReport(
            client,
            s3Client,
            s3ConfigParsed.Bucket,
            monorepoBasePath,
            context.repo,
            context.payload.pull_request.number,
            base,
        );
    }
} catch (err: any) {
    // eslint-disable-next-line no-console
    console.log(err);
    setFailed(err.message);
}
