import { readdirSync, statSync, promises } from "node:fs";
import * as path from "node:path";
import { Context } from "@actions/github/lib/context.js";
import { S3Client } from "@aws-sdk/client-s3";
import { basename } from "node:path";
import { LcovData, parse } from "./lcov.js";
import { OktokitClient, upsertComment } from "./github.js";
import { generateDiffForMonorepo } from "./comment.js";
import {
    downloadFile,
    getFileList,
    renameFile,
    uploadFile,
} from "./storage.js";
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
    repo: Context["repo"],
    base: string,
    prNumber: number | undefined,
    monorepoBasePath: string,
    file?: { name: string },
) {
    return `${repo.owner}/${repo.repo}/${base}/${
        prNumber ? `${prNumber}/` : ""
    }${monorepoBasePath}/${file ? `${file.name}.lcov.info` : ""}`;
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
                try {
                    const stats = statSync(file.path);
                    console.error(
                        `The LCOV file ${JSON.stringify(
                            file,
                        )} cannot be parsed. The file may be generated empty, filesize in bytes: ${
                            stats.size
                        }`,
                    );
                } catch (err) {
                    console.error(
                        `The LCOV file ${JSON.stringify(
                            file,
                        )} cannot be parsed. The file does not exist?`,
                    );
                }

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
    s3Bucket: string,
    repo: Context["repo"],
    monorepoBasePath: string,
    base: string,
    mainBase: string,
) {
    const lcovArray = getLcovFiles(monorepoBasePath);

    const lcovBaseArrayForMonorepo: LvocList = [];
    await Promise.all(
        lcovArray.map(async (file) => {
            try {
                // eslint-disable-next-line no-console
                console.info(
                    "getting base file from",
                    filePath(repo, base, undefined, monorepoBasePath, file),
                );
                const data = await downloadFile(
                    s3Client,
                    s3Bucket,
                    filePath(repo, base, undefined, monorepoBasePath, file),
                );
                if (!data) {
                    throw new Error(
                        `failed to download: ${filePath(
                            repo,
                            base,
                            undefined,
                            monorepoBasePath,
                            file,
                        )}`,
                    );
                }
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
                        s3Bucket,
                        filePath(
                            repo,
                            mainBase,
                            undefined,
                            monorepoBasePath,
                            file,
                        ),
                    );
                    if (!data) {
                        throw new Error(
                            `failed to download: ${filePath(
                                repo,
                                mainBase,
                                undefined,
                                monorepoBasePath,
                                file,
                            )}`,
                        );
                    }
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

export async function setTemporarLvocFilesAsBase(
    s3Client: S3Client,
    s3Bucket: string,
    repo: Context["repo"],
    prNumber: number,
    monorepoBasePath: string,
    base: string,
) {
    // rename them to base
    const files = await getFileList(
        s3Client,
        s3Bucket,
        filePath(repo, base, prNumber, monorepoBasePath),
    );
    await Promise.all(
        files.map(async (file) => {
            if (!file.Key) return;
            // console.log("file", file.name, file.path, rLcove.length);
            await renameFile(
                s3Client,
                s3Bucket,
                filePath(repo, base, prNumber, monorepoBasePath, undefined) +
                    basename(file.Key),
                filePath(repo, base, undefined, monorepoBasePath, undefined) +
                    basename(file.Key),
            );
        }),
    );
    return files.length;
}

export async function uploadTemporaryLvocFiles(
    s3Client: S3Client,
    s3Bucket: string,
    repo: Context["repo"],
    prNumber: number,
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
                s3Bucket,
                filePath(repo, base, prNumber, monorepoBasePath, file),
                rLcove,
            );
        }),
    );

    return lcovFiles.length;
}

export async function generateReport(
    client: OktokitClient,
    s3Client: S3Client | undefined,
    s3Bucket: string | undefined,
    monorepoBasePath: string,
    repo: Context["repo"],
    prNumber: number,
    base: string,
    mainBase = "master",
    threshold = 0.1,
) {
    const [{ lcovArrayForMonorepo }, { lcovBaseArrayForMonorepo }] =
        await Promise.all([
            retrieveLcovFiles(monorepoBasePath),
            (s3Client &&
                s3Bucket &&
                retrieveLcovBaseFiles(
                    s3Client,
                    s3Bucket,
                    repo,
                    monorepoBasePath,
                    base,
                    mainBase,
                )) || { lcovBaseArrayForMonorepo: [] },
        ]);

    const options = {
        // repository: context.payload.repository?.full_name,
        // commit: context.payload.pull_request?.head.sha,
        // prefix: `${process.env.GITHUB_WORKSPACE}/`,
        // head: context.payload.pull_request?.head.ref,
        base,
        folder: monorepoBasePath,
        threshold,
    };

    const diff = generateDiffForMonorepo(
        lcovArrayForMonorepo,
        lcovBaseArrayForMonorepo,
        options,
    );

    await upsertComment(
        client,
        repo,
        prNumber,
        diff.text,
        `<!-- monorepo-code-coverage-assistant--${monorepoBasePath} -->`,
    );

    return {
        count: lcovArrayForMonorepo.length,
        thresholdReached: diff.thresholdReached,
    };
}
