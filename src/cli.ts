import * as process from "node:process";
import { S3Client } from "@aws-sdk/client-s3";
import { getOctokit } from "@actions/github";
import {
    cleanUpNonchangedTemporaryLcovs,
    generateReport,
    retrieveLcovBaseFiles,
    retrieveTemporaryLcovFiles,
    setTemporarLvocFilesAsBase,
    uploadTemporaryLvocFiles,
} from "./app.js";

const context = {
    repo: { owner: "hokify", repo: "hokify-server" },
};
try {
    // eslint-disable-next-line no-console
    console.log("process.argv", process.argv);
    const monorepoBasePath = process.argv[3];
    const base = process.argv[4] || "master";

    const s3Config: {
        credentials: { accessKeyId: string; secretAccessKey: string };
        Bucket: string;
        region: string;
    } = {
        credentials: {
            accessKeyId: "",
            secretAccessKey: "",
        },
        region: "",
        Bucket: "repository-code-coverage",
    };
    const s3Client = (s3Config.region && new S3Client(s3Config)) || undefined;

    // eslint-disable-next-line no-console
    console.log("monorepoBasePath", monorepoBasePath);

    // const file = process.argv[2];
    if (process.argv[2] === "newbase") {
        if (!s3Client) {
            throw new Error("need s3 client for upload");
        }
        await setTemporarLvocFilesAsBase(
            s3Client,
            s3Config.Bucket,
            { owner: "hokify", repo: "hokify-server" },
            6391,
            monorepoBasePath,
            base,
        );
    } else if (process.argv[2] === "upload") {
        if (!s3Client) {
            throw new Error("need s3 client for upload");
        }
        await uploadTemporaryLvocFiles(
            s3Client,
            s3Config.Bucket,
            { owner: "hokify", repo: "hokify-server" },
            1,
            monorepoBasePath,
            base,
        );
        // eslint-disable-next-line no-console
        console.log("lvoc files uploaded");
    } else if (process.argv[2] === "report") {
        // const client = getOctokit(token);

        if (!s3Client || !s3Config) {
            throw new Error("mode 'report' requireds s3 config");
        }

        const prNumber = 6419;
        const [{ lcovArrayForMonorepo }, { lcovBaseArrayForMonorepo }] =
            await Promise.all([
                retrieveTemporaryLcovFiles(
                    s3Client,
                    s3Config.Bucket,
                    context.repo,
                    prNumber,
                    monorepoBasePath,
                    base,
                ),
                retrieveLcovBaseFiles(
                    s3Client,
                    s3Config.Bucket,
                    context.repo,
                    monorepoBasePath,
                    base,
                    "master",
                ),
            ]);

        await cleanUpNonchangedTemporaryLcovs(
            s3Client,
            s3Config.Bucket,
            lcovArrayForMonorepo,
            lcovBaseArrayForMonorepo,
            context.repo,
            prNumber,
            monorepoBasePath,
            base,
        );

        const resultReport = await generateReport(
            getOctokit("token"),
            lcovArrayForMonorepo,
            lcovBaseArrayForMonorepo,
            monorepoBasePath,
            context.repo,
            prNumber,
            base,
        );

        // eslint-disable-next-line no-console
        console.info(
            `generated report for ${resultReport.count} lcov files, ${resultReport.thresholdReached}x thresholds reached`,
        );
    } else {
        throw new Error(
            'specify "report" or "upload" or "newbase" as first paremter',
        );
    }
} catch (err) {
    // eslint-disable-next-line no-console
    console.log(err);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
}
