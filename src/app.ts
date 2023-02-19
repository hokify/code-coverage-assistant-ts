import { readdirSync, statSync, promises } from "node:fs";
import * as path from "node:path";
import { Context } from "@actions/github/lib/context.js";
import { S3Client } from "@aws-sdk/client-s3";
import { LcovData, parse } from "./lcov.js";
import { OktokitClient, upsertComment } from "./github.js";
import { generateDiffForMonorepo } from "./comment.js";
import { downloadFile, uploadFile } from "./storage.js";

/**
 * Find all files inside a dir, recursively.
 * @function getLcovFiles
 * @param  {string} dir Dir path string.
 * @return {string[{<package_name>: <path_to_lcov_file>}]} Array with lcove file names with package names as key.
 */

export type FileList = { name: string; path: string }[];
export type LvocList = { packageName: string; lcov: LcovData }[];
export function getLcovFiles(dir: string, filelist?: FileList) {
    let fileArray = filelist || [];
    readdirSync(dir).forEach((file) => {
        fileArray = statSync(path.join(dir, file)).isDirectory()
            ? getLcovFiles(path.join(dir, file), fileArray)
            : fileArray
                  .filter((f) => f.path.includes("lcov.info"))
                  .concat({
                      name: dir.split("/")[1],
                      path: path.join(dir, file),
                  });
    });

    return fileArray;
}

function filePath(
    base: string,
    monorepoBasePath: string,
    file: { name: string },
) {
    return `${base}/${monorepoBasePath}/${file.name}.lcov.info`;
}

export async function retrieveLcovFiles(monorepoBasePath: string) {
    const lcovArray = getLcovFiles(monorepoBasePath);

    const lcovArrayForMonorepo: LvocList = [];
    for (const file of lcovArray) {
        if (file.path.includes(".info")) {
            try {
                const rLcove = await promises.readFile(file.path, "utf8");
                const data = await parse(rLcove);
                lcovArrayForMonorepo.push({
                    packageName: file.name,
                    lcov: data,
                });
            } catch (error) {
                // eslint-disable-next-line no-console
                console.log(
                    `The LCOV file ${JSON.stringify(
                        file,
                    )} cannot be parsed. Either the file does not exist or it has been generated empty`,
                );
                throw error;
            }
        }
    }

    return {
        lcovArrayForMonorepo,
    };
}

export async function retrieveLcovBaseFiles(
    s3Client: S3Client,
    bucket: string,
    monorepoBasePath: string,
    base: string,
    mainBase: string,
) {
    const lcovArray = getLcovFiles(monorepoBasePath);

    const lcovBaseArrayForMonorepo: LvocList = [];
    await Promise.all(
        lcovArray.map(async (file) => {
            try {
                const data = await downloadFile(
                    s3Client,
                    bucket,
                    filePath(base, monorepoBasePath, file),
                );
                lcovBaseArrayForMonorepo.push({
                    packageName: file.name,
                    lcov: await parse(data),
                });
            } catch (err) {
                // eslint-disable-next-line no-console
                console.log(err);
                try {
                    if (base === mainBase) {
                        throw err;
                    }
                    const data = await downloadFile(
                        s3Client,
                        bucket,
                        filePath(base, monorepoBasePath, file),
                    );
                    lcovBaseArrayForMonorepo.push({
                        packageName: file.name,
                        lcov: await parse(data),
                    });
                } catch (secondTryErr) {
                    console.warn(
                        `no base lcov file found for ${file.name}: ${secondTryErr}`,
                    );
                }
            }
        }),
    );

    return {
        lcovBaseArrayForMonorepo,
    };
}

export async function uploadLvocFiles(
    s3Client: S3Client,
    bucket: string,
    monorepoBasePath: string,
    base: string,
) {
    const lcovFiles = await getLcovFiles(monorepoBasePath);

    // upload them
    await Promise.all(
        lcovFiles.map(async (file) => {
            const rLcove = await promises.readFile(file.path, "utf8");
            // console.log("file", file.name, file.path, rLcove.length);
            await uploadFile(
                s3Client,
                bucket,
                filePath(base, monorepoBasePath, file),
                rLcove,
            );
        }),
    );
}

export async function generateReport(
    client: OktokitClient,
    s3Client: S3Client,
    bucket: string,
    monorepoBasePath: string,
    repo: Context["repo"],
    prNumber: number,
    base: string,
    mainBase = "master",
) {
    const [{ lcovArrayForMonorepo }, { lcovBaseArrayForMonorepo }] =
        await Promise.all([
            retrieveLcovFiles(monorepoBasePath),
            retrieveLcovBaseFiles(
                s3Client,
                bucket,
                monorepoBasePath,
                base,
                mainBase,
            ),
        ]);

    const options = {
        // repository: context.payload.repository?.full_name,
        // commit: context.payload.pull_request?.head.sha,
        // prefix: `${process.env.GITHUB_WORKSPACE}/`,
        // head: context.payload.pull_request?.head.ref,
        base,
        folder: monorepoBasePath.split("/")[1],
    };

    await upsertComment(
        client,
        repo,
        prNumber,
        generateDiffForMonorepo(
            lcovArrayForMonorepo,
            lcovBaseArrayForMonorepo,
            options,
        ),
        `<!-- monorepo-code-coverage-assistant--${
            monorepoBasePath.split("/")[1]
        } -->`,
    );
}
