import * as process from "node:process";
import { S3Client } from "@aws-sdk/client-s3";
import { generateDiffForMonorepo } from "./comment.js";
import {
    retrieveLcovBaseFiles,
    retrieveLcovFiles,
    uploadLvocFiles,
} from "./app.js";

const main = async () => {
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

    const s3Client = new S3Client(s3Config);

    // eslint-disable-next-line no-console
    console.log("monorepoBasePath", monorepoBasePath);

    // const file = process.argv[2];
    if (process.argv[2] === "upload") {
        await uploadLvocFiles(
            s3Client,
            s3Config.Bucket,
            { owner: "@hokify", repo: "hokify-server" },
            monorepoBasePath,
            base,
        );
        console.log("lvoc files uploaded");
        return;
    }

    if (process.argv[2] === "report") {
        const [{ lcovArrayForMonorepo }, { lcovBaseArrayForMonorepo }] =
            await Promise.all([
                retrieveLcovFiles(monorepoBasePath),
                retrieveLcovBaseFiles(
                    s3Client,
                    s3Config.Bucket,
                    { owner: "@hokify", repo: "hokify-server" },
                    monorepoBasePath,
                    base,
                    "master",
                ),
            ]);

        const options = {
            base: "base...",
            folder: monorepoBasePath.split("/")[1],
        };

        // eslint-disable-next-line no-console
        console.log(
            generateDiffForMonorepo(
                lcovArrayForMonorepo,
                lcovBaseArrayForMonorepo,
                options,
            ),
        );
        return;
    }

    throw new Error('specify "report" or "upload" as first paremter');
};

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.log(err);
    process.exit(1);
});
